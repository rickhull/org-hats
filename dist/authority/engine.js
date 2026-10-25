// The portable authority engine, in memory — the reference implementation of
// `AuthorityRuntime` (docs/authority_redesign.md § Authority).
//
// Two coordinators mirror the deployed shape: an organization authority
// (actors, principal links, org-side participation) and an operation
// authority (sites, teams, grants, op-side participation, policy, refresh
// records). Between them is an outbox with visible partial states and
// retryable delivery — never a distributed transaction. The engine owns
// ordering, validation, idempotency, audit, and issuance; callers receive
// use cases, not storage.
//
// Determinism: the clock and signer are injected; a fixed clock plus a
// fresh signer gives reproducible behavior (ids, failure kinds, receipts)
// without pinning signature bytes.
import { canonicalJson, epochSeconds, ACCESS_ENVELOPE_FORMAT, ACCESS_ENVELOPE_VERSION, AUTHORITY_INTERFACE_VERSION, actorId, isFailed, operationId, organizationId, siteId, teamId, } from "../contract.js";
import { applyParticipationEvent, readReach, wearableGrants, } from "../model.js";
import { actionsOf } from "../policy.js";
import { counter, sha256Hex, systemClock, webCryptoSigner } from "./internal.js";
const factsOf = (evidence) => evidence.amr === undefined && evidence.authTime === undefined
    ? undefined
    : {
        ...(evidence.amr !== undefined ? { amr: [...evidence.amr] } : {}),
        ...(evidence.authTime !== undefined ? { authTime: evidence.authTime } : {}),
    };
const V = AUTHORITY_INTERFACE_VERSION;
const nextSigningKey = counter();
const failed = (failure) => ({ failure });
const fail = (kind, detail) => ({
    ok: false,
    failure: { kind, ...(detail !== undefined ? { detail } : {}) },
});
const ok = (idempotencyKey, applied) => ({
    ok: true,
    receipt: { idempotencyKey, applied },
});
const defaultHat = (grants, bundle) => {
    const rank = (g) => `${g.primary === true ? 0 : 1}|${g.role}|${g.target.kind === "team" ? g.target.teamId : g.target.siteId}|${g.grantId}`;
    const sorted = [...grants].sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0));
    const chosen = sorted[0];
    if (chosen === undefined)
        return { ok: false, reason: "no-grant" };
    const role = actionsOf(bundle, chosen.role);
    if (!role.found)
        return { ok: false, reason: "unknown-role", role: chosen.role };
    return { ok: true, grant: chosen, actions: role.actions };
};
export const createInMemoryAuthority = async (config = {}) => {
    const clock = config.clock ?? systemClock();
    const signer = config.signer ?? (await webCryptoSigner(`key-${nextSigningKey()}`));
    const lifetime = config.envelopeLifetimeSeconds ?? 900;
    const configureActions = config.configureActions ?? ["configure"];
    const adminRoles = config.adminRoles ?? {};
    const orgAdmins = config.orgAdmins ?? {};
    let transportFailures = config.transportFailures ?? 0;
    const orgs = new Map();
    const ops = new Map();
    const outbox = [];
    const delivered = new Set();
    const nextId = counter();
    const allOrganizations = [];
    const allActors = [];
    for (const fixture of config.fixtures ?? []) {
        const op = fixture.snapshot.operations[0];
        if (op === undefined)
            throw new Error("a twin fixture needs an operation");
        ops.set(op.operationId, {
            operationId: op.operationId,
            ...(op.displayName !== undefined ? { displayName: op.displayName } : {}),
            ...(op.slug !== undefined ? { slug: op.slug } : {}),
            ...(op.bounded !== undefined ? { bounded: op.bounded } : {}),
            policy: fixture.policy,
            sites: fixture.snapshot.sites.map((s) => ({ ...s })),
            teams: fixture.snapshot.teams.map((t) => ({ ...t })),
            grants: fixture.snapshot.grants.map((g) => ({ ...g })),
            participations: fixture.snapshot.participations.map((p) => ({ ...p })),
            invitations: new Map(),
            refreshRecords: [],
            accessRequests: [],
            audit: [{ at: clock.now(), by: "bootstrap", fact: `fixture ${fixture.snapshot.operations[0]?.operationId} loaded` }],
            claims: new Map(),
        });
        for (const organization of fixture.snapshot.organizations) {
            if (!orgs.has(organization.organizationId)) {
                orgs.set(organization.organizationId, {
                    organizationId: organization.organizationId,
                    ...(organization.displayName !== undefined ? { displayName: organization.displayName } : {}),
                    actors: [],
                    principalLinks: new Map(),
                    invitations: new Map(),
                    audit: [{ at: clock.now(), by: "bootstrap", fact: `organization ${organization.organizationId} created` }],
                    claims: new Map(),
                });
                allOrganizations.push({ organizationId: organization.organizationId, ...(organization.displayName !== undefined ? { displayName: organization.displayName } : {}) });
            }
        }
        for (const actor of fixture.snapshot.actors) {
            const org = orgs.get(actor.organizationId);
            if (org !== undefined && !org.actors.some((a) => a.actorId === actor.actorId)) {
                org.actors.push({ ...actor });
                if (!allActors.some((a) => a.organizationId === actor.organizationId && a.actorId === actor.actorId)) {
                    allActors.push({ ...actor });
                }
            }
        }
    }
    for (const link of config.principalLinks ?? []) {
        const org = orgs.get(link.organizationId);
        if (org === undefined || !org.actors.some((a) => a.actorId === link.actorId)) {
            throw new Error(`principal link names an unknown actor: ${link.organizationId}/${link.actorId}`);
        }
        // one identity is never two actors: a (provider, subject) may re-link
        // its own actor, never a different one
        const key = `${link.provider}:${link.subject}`;
        const existing = org.principalLinks.get(key);
        if (existing !== undefined &&
            (existing.organizationId !== link.organizationId || existing.actorId !== link.actorId)) {
            throw new Error(`principal link ${key} already resolves to ${existing.organizationId}/${existing.actorId}, not ${link.organizationId}/${link.actorId}`);
        }
        org.principalLinks.set(key, {
            organizationId: link.organizationId,
            actorId: link.actorId,
        });
    }
    const snapshotOf = (operationId) => {
        const op = ops.get(operationId);
        if (op === undefined)
            return undefined;
        return {
            organizations: allOrganizations,
            actors: allActors,
            operations: [...ops.values()].map((o) => ({
                operationId: o.operationId,
                ...(o.displayName !== undefined ? { displayName: o.displayName } : {}),
                ...(o.slug !== undefined ? { slug: o.slug } : {}),
                ...(o.bounded !== undefined ? { bounded: o.bounded } : {}),
            })),
            sites: op.sites,
            teams: op.teams,
            grants: op.grants,
            participations: op.participations,
        };
    };
    // --- outbox delivery ------------------------------------------------------------
    const deliverPending = async () => {
        let count = 0;
        for (const message of [...outbox]) {
            if (transportFailures > 0) {
                transportFailures -= 1;
                continue; // the attempt failed; the message stays pending and retryable
            }
            if (delivered.has(message.id))
                continue;
            if (message.kind === "invitation" && message.invitationId !== undefined && message.operationId !== undefined) {
                // the outbox address is a plain string because a message routes to
                // either coordinator; `kind` says which, so the conversion is here
                const org = orgs.get(organizationId(message.target));
                if (org !== undefined && !org.invitations.has(message.invitationId)) {
                    org.invitations.set(message.invitationId, { operationId: message.operationId, status: "pending" });
                }
            }
            if (message.kind === "acceptance" && message.invitationId !== undefined) {
                const op = ops.get(operationId(message.target));
                const invitation = op?.invitations.get(message.invitationId);
                if (op !== undefined && invitation !== undefined && invitation.status === "invited") {
                    // Two events, in the model's order: the organization accepted, and
                    // the operation activates. Jumping straight to `active` is what let
                    // an acceptance delivered after a revoke flip `revoked` back —
                    // `transitionParticipation` refuses both steps from `revoked`, so
                    // the delivery is now a no-op against a terminal state.
                    const accepted = applyParticipationEvent(op.participations, invitation.organizationId, op.operationId, { kind: "accept", by: "organization" });
                    if (!accepted.ok) {
                        op.audit.push({ at: clock.now(), by: "outbox", fact: `acceptance for ${invitation.organizationId} not applied: ${accepted.problem}` });
                    }
                    else {
                        const activated = applyParticipationEvent(accepted.participations, invitation.organizationId, op.operationId, { kind: "activate", by: "operation" });
                        if (!activated.ok) {
                            op.audit.push({ at: clock.now(), by: "outbox", fact: `activation for ${invitation.organizationId} not applied: ${activated.problem}` });
                        }
                        else {
                            invitation.status = "accepted";
                            op.participations = [...activated.participations];
                            op.audit.push({ at: clock.now(), by: "outbox", fact: `participation ${invitation.organizationId} active (canonical)` });
                        }
                    }
                }
            }
            if (message.kind === "actor-disabled" && message.operationId !== undefined) {
                const op = ops.get(operationId(message.target));
                if (op !== undefined) {
                    for (const record of op.refreshRecords) {
                        if (record.organizationId === message.organizationId && record.actorId === message.actorId) {
                            record.revoked = true;
                        }
                    }
                }
            }
            delivered.add(message.id);
            outbox.splice(outbox.indexOf(message), 1);
            count += 1;
        }
        return count;
    };
    // --- helpers ----------------------------------------------------------------------
    const checkVersion = (v) => v !== V ? { kind: "wrong-interface-version" } : undefined;
    const payloadHash = (command) => {
        const { idempotencyKey: _k, authorization: _a, ...rest } = command;
        return canonicalJson(rest);
    };
    /** A retry claims its earlier result; the same key with a different
     * payload is a misuse, not a retry. Checking is pure — the claim is
     * committed with the mutation it guards, so a denied command never
     * poisons its key. */
    const checkClaim = (claims, command) => {
        const existing = claims.get(command.idempotencyKey);
        if (existing === undefined)
            return undefined;
        if (existing.payloadHash !== payloadHash(command)) {
            return fail("invalid-command", "idempotency key reused with a different payload");
        }
        return ok(command.idempotencyKey, false);
    };
    const commitClaim = (claims, command) => {
        claims.set(command.idempotencyKey, { payloadHash: payloadHash(command), receiptApplied: true });
    };
    const resolvePrincipal = async (authorization, boundTo) => {
        if (authorization.kind === "fresh-evidence") {
            const link = [...orgs.values()]
                .flatMap((o) => [...o.principalLinks.entries()].map(([k, v]) => ({ k, v })))
                .find(({ k }) => k === `${authorization.evidence.provider}:${authorization.evidence.subject}`);
            if (link === undefined)
                return { kind: "unauthenticated", detail: "no principal link for this evidence" };
            const org = orgs.get(link.v.organizationId);
            const actor = org?.actors.find((a) => a.actorId === link.v.actorId);
            if (org === undefined || actor === undefined)
                return { kind: "unauthenticated" };
            if (actor.disabled)
                return { kind: "not-admitted", detail: "actor disabled" };
            return {
                organizationId: link.v.organizationId,
                actorId: link.v.actorId,
                adminOfOperation: false,
                adminOfOrganization: (orgAdmins[link.v.organizationId] ?? []).includes(link.v.actorId),
            };
        }
        const claims = authorization.envelope.claims;
        if (authorization.envelope.format !== ACCESS_ENVELOPE_FORMAT)
            return { kind: "invalid-signature" };
        if (!(await signer.verify(canonicalJson(claims), authorization.envelope.signature))) {
            return { kind: "invalid-signature" };
        }
        if (clock.now() >= claims.exp)
            return { kind: "expired" };
        if (boundTo !== undefined && claims.operationId !== boundTo)
            return { kind: "wrong-binding" };
        // No declared admin role means no role administers this operation —
        // a visible denial. Falling back to a hardcoded `["admin"]` applied a
        // title this file's own charter says is configuration, and silently
        // granted administration to whoever happened to hold it. Cloudflare's
        // coordinator already reads an undeclared set as empty; this matches it.
        // The command-handler seam: envelope claims carry plain strings, and
        // this is where they become domain ids.
        const claimedOperation = operationId(claims.operationId);
        const claimedOrganization = organizationId(claims.actor.organizationId);
        const claimedActor = actorId(claims.actor.actorId);
        const roles = adminRoles[claimedOperation] ?? [];
        const adminHat = claims.hat.actions.some((a) => configureActions.includes(a)) || roles.includes(claims.hat.role);
        return {
            organizationId: claimedOrganization,
            actorId: claimedActor,
            adminOfOperation: adminHat,
            adminOfOrganization: (orgAdmins[claimedOrganization] ?? []).includes(claimedActor),
        };
    };
    /** Revoke one organization's participation through the state machine.
     *
     * Revoking twice is a safe retry rather than a failure: the state the
     * caller asked for is the state that holds, and a retry under a fresh
     * idempotency key must not read as an error. "Not participating" is a
     * different thing and stays a denial. Whether a repeat is idempotent is
     * the adapter's policy; that `revoked` never moves back is the model's,
     * and `applyParticipationEvent` is what enforces it. */
    const revokeParticipation = (op, organizationId, by) => {
        const current = op.participations.find((p) => p.organizationId === organizationId && p.operationId === op.operationId);
        if (current === undefined)
            return { ok: false, problem: "the organization is not participating" };
        if (current.status === "revoked")
            return { ok: true };
        const revoked = applyParticipationEvent(op.participations, organizationId, op.operationId, {
            kind: "revoke",
            by,
        });
        if (!revoked.ok)
            return revoked;
        op.participations = [...revoked.participations];
        return { ok: true };
    };
    const revokeRefreshRecords = (op, organizationId, actorId) => {
        for (const record of op.refreshRecords) {
            if (record.organizationId === organizationId && record.actorId === actorId)
                record.revoked = true;
        }
    };
    // --- issuance -----------------------------------------------------------------------
    const buildEnvelope = (op, organizationId, actorId, auth) => {
        const org = orgs.get(organizationId);
        const actor = org?.actors.find((a) => a.actorId === actorId);
        if (org === undefined || actor === undefined)
            return { kind: "unauthenticated" };
        if (actor.disabled)
            return { kind: "not-admitted", detail: "actor disabled" };
        const snapshot = snapshotOf(op.operationId);
        if (snapshot === undefined)
            return { kind: "wrong-binding" };
        const wearable = wearableGrants(snapshot, organizationId, actorId, op.operationId);
        if (wearable.length === 0)
            return { kind: "not-admitted" };
        const hat = defaultHat(wearable, op.policy);
        if (!hat.ok) {
            // an inconsistency between the grants and the active bundle is not a
            // statement about this actor: fail closed, and say which role
            return hat.reason === "unknown-role"
                ? { kind: "unavailable", detail: `the policy bundle no longer carries the role "${hat.role}"` }
                : { kind: "not-admitted" };
        }
        const hatTeamIds = new Set();
        const hatSiteIds = new Set();
        if (hat.grant.target.kind === "site") {
            hatSiteIds.add(hat.grant.target.siteId);
            for (const team of op.teams)
                if (team.siteId === hat.grant.target.siteId)
                    hatTeamIds.add(team.teamId);
        }
        else {
            hatTeamIds.add(hat.grant.target.teamId);
        }
        const siteIds = new Set();
        const memberTeams = new Set();
        for (const grant of wearable) {
            if (grant.target.kind === "site") {
                siteIds.add(grant.target.siteId);
                for (const team of op.teams)
                    if (team.siteId === grant.target.siteId)
                        memberTeams.add(team.teamId);
            }
            else {
                const teamId = grant.target.teamId;
                memberTeams.add(teamId);
                const siteId = op.teams.find((t) => t.teamId === teamId)?.siteId;
                if (siteId !== undefined)
                    siteIds.add(siteId);
            }
        }
        const sites = op.sites
            .filter((s) => siteIds.has(s.siteId))
            .map((s) => ({ siteId: s.siteId, aliases: [...s.aliases] }));
        const reach = readReach(snapshot, op.policy, organizationId, actorId, op.operationId);
        const carriesConfigure = (g) => {
            const role = actionsOf(op.policy, g.role);
            return role.found && role.actions.some((a) => configureActions.includes(a));
        };
        const siteIdOfGrant = (g) => {
            if (g.target.kind === "site")
                return g.target.siteId;
            const teamId = g.target.teamId;
            return op.teams.find((t) => t.teamId === teamId)?.siteId;
        };
        const configurableSiteIds = op.sites
            .filter((site) => wearable.some((g) => carriesConfigure(g) && siteIdOfGrant(g) === site.siteId))
            .map((s) => s.siteId);
        const iat = clock.now();
        return {
            v: ACCESS_ENVELOPE_VERSION,
            interfaceVersion: V,
            operationId: op.operationId,
            actor: { organizationId, actorId },
            hat: {
                role: hat.grant.role,
                actions: [...hat.actions],
                teamIds: [...hatTeamIds],
                siteIds: [...hatSiteIds],
            },
            memberTeamIds: [...memberTeams],
            sites,
            readableOrganizationIds: reach.readableOrganizationIds,
            readableTeamIds: reach.readableTeamIds,
            configurableSiteIds,
            iat,
            exp: iat + lifetime,
            ...(auth?.amr !== undefined ? { amr: [...auth.amr] } : {}),
            ...(auth?.authTime !== undefined ? { auth_time: auth.authTime } : {}),
        };
    };
    const issue = async (op, organizationId, actorId, auth) => {
        const claims = buildEnvelope(op, organizationId, actorId, auth);
        if ("kind" in claims)
            return { ok: false, failure: claims };
        const signature = await signer.sign(canonicalJson(claims));
        const envelope = {
            format: ACCESS_ENVELOPE_FORMAT,
            v: ACCESS_ENVELOPE_VERSION,
            keyId: signer.keyId,
            claims,
            signature,
        };
        const handle = `rh-${nextId()}`;
        op.refreshRecords.push({
            handleHash: await sha256Hex(handle),
            operationId: op.operationId,
            organizationId,
            actorId,
            ...(auth?.amr !== undefined ? { amr: [...auth.amr] } : {}),
            ...(auth?.authTime !== undefined ? { authTime: auth.authTime } : {}),
            revoked: false,
            superseded: false,
        });
        const refresh = { kind: "rotated", handle };
        return { envelope, refresh };
    };
    // --- the runtime ----------------------------------------------------------------------
    const runtime = {
        async accessFromEvidence(input) {
            await deliverPending();
            const versionFail = checkVersion(input.interfaceVersion);
            if (versionFail !== undefined)
                return failed(versionFail);
            // the seam: the request carries plain strings, `op.operationId` is
            // the domain id from here down
            const op = ops.get(operationId(input.operationId));
            if (op === undefined)
                return failed({ kind: "wrong-binding", detail: "unknown operation" });
            const link = [...orgs.values()]
                .flatMap((o) => [...o.principalLinks.entries()].map(([k, v]) => ({ k, v })))
                .find(({ k }) => k === `${input.evidence.provider}:${input.evidence.subject}`);
            if (link === undefined)
                return failed({ kind: "unauthenticated", detail: "no principal link for this evidence" });
            const result = await issue(op, link.v.organizationId, link.v.actorId, factsOf(input.evidence));
            if (isFailed(result))
                return failed(result.failure);
            return result;
        },
        async refresh(input) {
            await deliverPending();
            const versionFail = checkVersion(input.interfaceVersion);
            if (versionFail !== undefined)
                return failed(versionFail);
            const op = ops.get(operationId(input.operationId));
            if (op === undefined)
                return failed({ kind: "wrong-binding", detail: "unknown operation" });
            const hash = await sha256Hex(input.handle);
            const record = op.refreshRecords.find((r) => r.handleHash === hash);
            if (record === undefined)
                return failed({ kind: "unauthenticated", detail: "unknown refresh handle" });
            if (record.revoked)
                return failed({ kind: "unauthenticated", detail: "refresh handle revoked" });
            if (record.superseded)
                return failed({ kind: "unauthenticated", detail: "refresh handle superseded" });
            record.superseded = true;
            // the authentication event, not the envelope, survives the chain
            const result = await issue(op, record.organizationId, record.actorId, record.amr === undefined && record.authTime === undefined
                ? undefined
                : {
                    ...(record.amr !== undefined ? { amr: [...record.amr] } : {}),
                    ...(record.authTime !== undefined ? { authTime: record.authTime } : {}),
                });
            if (isFailed(result))
                return failed(result.failure);
            return result;
        },
        async context(input) {
            await deliverPending();
            const versionFail = checkVersion(input.interfaceVersion);
            if (versionFail !== undefined)
                return failed(versionFail);
            const { envelope } = input;
            if (envelope.format !== ACCESS_ENVELOPE_FORMAT)
                return failed({ kind: "invalid-signature" });
            if (!(await signer.verify(canonicalJson(envelope.claims), envelope.signature))) {
                return failed({ kind: "invalid-signature" });
            }
            if (clock.now() >= envelope.claims.exp)
                return failed({ kind: "expired" });
            const op = ops.get(operationId(envelope.claims.operationId));
            const snapshot = op !== undefined ? snapshotOf(op.operationId) : undefined;
            if (op === undefined || snapshot === undefined)
                return failed({ kind: "wrong-binding" });
            // the same seam, on the context path
            const organizationId_ = organizationId(envelope.claims.actor.organizationId);
            const actorId_ = actorId(envelope.claims.actor.actorId);
            const wearable = wearableGrants(snapshot, organizationId_, actorId_, op.operationId);
            const actor = orgs.get(organizationId_)?.actors.find((a) => a.actorId === actorId_);
            const orgName = orgs.get(organizationId_)?.displayName;
            const participation = snapshot.participations.find((p) => p.organizationId === organizationId_);
            // the grant the envelope's hat was selected from: its own target, not
            // the expanded reach the claims carry
            const selected = wearable.find((g) => g.role === envelope.claims.hat.role);
            // Presentation still may not invent an action list. A grant naming a
            // role the bundle dropped makes the context unanswerable, not empty.
            const hats = [];
            for (const g of wearable) {
                const role = actionsOf(op.policy, g.role);
                if (!role.found) {
                    return failed({ kind: "unavailable", detail: `the policy bundle no longer carries the role "${g.role}"` });
                }
                hats.push({
                    role: g.role,
                    actions: [...role.actions],
                    target: g.target,
                    primary: g.primary === true,
                });
            }
            return {
                actor: { organizationId: organizationId_, actorId: actorId_, ...(actor?.displayName !== undefined ? { displayName: actor.displayName } : {}) },
                ...(orgName !== undefined ? { organizationDisplayName: orgName } : {}),
                operationId: op.operationId,
                ...(op.displayName !== undefined ? { operationDisplayName: op.displayName } : {}),
                participation: participation?.status ?? "revoked",
                wearableHats: hats,
                // absent when no wearable grant matches the envelope's hat: the
                // context cannot name a target it does not hold
                ...(selected === undefined
                    ? {}
                    : {
                        selectedHat: {
                            role: envelope.claims.hat.role,
                            actions: [...envelope.claims.hat.actions],
                            target: selected.target,
                            primary: selected.primary === true,
                        },
                    }),
                sites: [...envelope.claims.sites],
                ...(envelope.claims.amr !== undefined ? { amr: [...envelope.claims.amr] } : {}),
                ...(envelope.claims.auth_time !== undefined ? { authTime: envelope.claims.auth_time } : {}),
            };
        },
        async command(inputCommand) {
            await deliverPending();
            const versionFail = checkVersion(inputCommand.interfaceVersion);
            if (versionFail !== undefined)
                return fail(versionFail.kind);
            // request-access needs no administrator: the evidence is the request
            if (inputCommand.kind === "request-access") {
                const op = ops.get(operationId(inputCommand.operationId));
                if (op === undefined)
                    return fail("wrong-binding", "unknown operation");
                const replay = checkClaim(op.claims, inputCommand);
                if (replay !== undefined)
                    return replay;
                const link = [...orgs.values()]
                    .flatMap((o) => [...o.principalLinks.entries()].map(([k, v]) => ({ k, v })))
                    .find(({ k }) => k === `${inputCommand.evidence.provider}:${inputCommand.evidence.subject}`);
                if (link === undefined)
                    return fail("unauthenticated", "no principal link for this evidence");
                commitClaim(op.claims, inputCommand);
                const requestId = `ar-${nextId()}`;
                op.accessRequests.push({ requestId, organizationId: link.v.organizationId, actorId: link.v.actorId });
                op.audit.push({ at: clock.now(), by: `${link.v.organizationId}/${link.v.actorId}`, fact: `access request ${requestId}` });
                return ok(inputCommand.idempotencyKey, true);
            }
            // which operation this command binds to, if any: `disable-actor` is
            // organization-scoped and binds to none
            const boundOperation = inputCommand.kind === "disable-actor"
                ? undefined
                : "operationId" in inputCommand
                    ? operationId(inputCommand.operationId)
                    : undefined;
            const principalOrFailure = await resolvePrincipal(inputCommand.authorization, boundOperation);
            if ("kind" in principalOrFailure)
                return fail(principalOrFailure.kind, principalOrFailure.detail);
            switch (inputCommand.kind) {
                case "participation-invite": {
                    const op = ops.get(operationId(inputCommand.operationId));
                    const org = orgs.get(organizationId(inputCommand.organizationId));
                    if (op === undefined)
                        return fail("wrong-binding", "unknown operation");
                    if (org === undefined)
                        return fail("wrong-binding", "unknown organization");
                    if (!principalOrFailure.adminOfOperation)
                        return fail("denied", "the caller does not administer this operation");
                    const replay = checkClaim(op.claims, inputCommand);
                    if (replay !== undefined)
                        return replay;
                    const invitee = organizationId(inputCommand.organizationId);
                    const invited = applyParticipationEvent(op.participations, invitee, op.operationId, { kind: "invite", by: "operation" });
                    if (!invited.ok)
                        return fail("denied", invited.problem);
                    commitClaim(op.claims, inputCommand);
                    const invitationId = `inv-${nextId()}`;
                    op.invitations.set(invitationId, { organizationId: invitee, status: "invited" });
                    op.participations = [...invited.participations];
                    outbox.push({
                        id: `ob-${nextId()}`, to: "org", target: invitee,
                        kind: "invitation", invitationId, operationId: op.operationId,
                        organizationId: invitee,
                    });
                    op.audit.push({ at: clock.now(), by: `${principalOrFailure.organizationId}/${principalOrFailure.actorId}`, fact: `invitation ${invitationId} to ${inputCommand.organizationId}` });
                    return ok(inputCommand.idempotencyKey, true);
                }
                case "participation-accept": {
                    const org = orgs.get(principalOrFailure.organizationId);
                    if (org === undefined)
                        return fail("wrong-binding");
                    if (!principalOrFailure.adminOfOrganization)
                        return fail("denied", "the caller does not administer this organization");
                    const replay = checkClaim(org.claims, inputCommand);
                    if (replay !== undefined)
                        return replay;
                    const found = [...org.invitations.entries()].find(([, invitation]) => invitation.operationId === inputCommand.operationId);
                    const invitationId = found?.[0];
                    const invitation = found?.[1];
                    if (invitationId === undefined || invitation === undefined)
                        return fail("denied", "no such invitation");
                    if (invitation.status !== "pending")
                        return fail("denied", `invitation already ${invitation.status}`);
                    commitClaim(org.claims, inputCommand);
                    invitation.status = "accepted";
                    const op = ops.get(invitation.operationId);
                    if (op !== undefined) {
                        outbox.push({
                            id: `ob-${nextId()}`, to: "op", target: invitation.operationId,
                            kind: "acceptance", invitationId,
                            operationId: invitation.operationId, organizationId: org.organizationId,
                        });
                    }
                    org.audit.push({ at: clock.now(), by: `${org.organizationId}/${principalOrFailure.actorId}`, fact: `invitation ${invitationId} accepted` });
                    return ok(inputCommand.idempotencyKey, true);
                }
                case "participation-revoke": {
                    if (inputCommand.by === "operation") {
                        const op = ops.get(operationId(inputCommand.operationId));
                        if (op === undefined)
                            return fail("wrong-binding", "unknown operation");
                        if (!principalOrFailure.adminOfOperation)
                            return fail("denied", "the caller does not administer this operation");
                        const replay = checkClaim(op.claims, inputCommand);
                        if (replay !== undefined)
                            return replay;
                        const revoked = revokeParticipation(op, organizationId(inputCommand.organizationId), "operation");
                        if (!revoked.ok)
                            return fail("denied", revoked.problem);
                        commitClaim(op.claims, inputCommand);
                        for (const record of op.refreshRecords) {
                            if (record.organizationId === inputCommand.organizationId)
                                record.revoked = true;
                        }
                        op.audit.push({ at: clock.now(), by: `${principalOrFailure.organizationId}/${principalOrFailure.actorId}`, fact: `participation ${inputCommand.organizationId} revoked` });
                        return ok(inputCommand.idempotencyKey, true);
                    }
                    const org = orgs.get(organizationId(inputCommand.organizationId));
                    if (org === undefined)
                        return fail("wrong-binding", "unknown organization");
                    if (!principalOrFailure.adminOfOrganization)
                        return fail("denied", "the caller does not administer this organization");
                    const replay = checkClaim(org.claims, inputCommand);
                    if (replay !== undefined)
                        return replay;
                    const op = ops.get(operationId(inputCommand.operationId));
                    if (op === undefined)
                        return fail("wrong-binding", "unknown operation");
                    const revoked = revokeParticipation(op, organizationId(inputCommand.organizationId), "organization");
                    if (!revoked.ok)
                        return fail("denied", revoked.problem);
                    commitClaim(org.claims, inputCommand);
                    for (const record of op.refreshRecords) {
                        if (record.organizationId === inputCommand.organizationId)
                            record.revoked = true;
                    }
                    org.audit.push({ at: clock.now(), by: `${org.organizationId}/${principalOrFailure.actorId}`, fact: `participation in ${inputCommand.operationId} revoked` });
                    return ok(inputCommand.idempotencyKey, true);
                }
                case "admit": {
                    const op = ops.get(operationId(inputCommand.operationId));
                    if (op === undefined)
                        return fail("wrong-binding", "unknown operation");
                    if (!principalOrFailure.adminOfOperation)
                        return fail("denied", "the caller does not administer this operation");
                    const replay = checkClaim(op.claims, inputCommand);
                    if (replay !== undefined)
                        return replay;
                    const actor = orgs.get(organizationId(inputCommand.organizationId))?.actors.find((a) => a.actorId === inputCommand.actorId);
                    if (actor === undefined)
                        return fail("invalid-command", "unknown actor");
                    commitClaim(op.claims, inputCommand);
                    op.accessRequests = op.accessRequests.filter((r) => !(r.organizationId === inputCommand.organizationId && r.actorId === inputCommand.actorId));
                    op.audit.push({ at: clock.now(), by: `${principalOrFailure.organizationId}/${principalOrFailure.actorId}`, fact: `admitted ${inputCommand.organizationId}/${inputCommand.actorId}` });
                    return ok(inputCommand.idempotencyKey, true);
                }
                case "grant-hat": {
                    const op = ops.get(operationId(inputCommand.operationId));
                    if (op === undefined)
                        return fail("wrong-binding", "unknown operation");
                    if (!principalOrFailure.adminOfOperation)
                        return fail("denied", "the caller does not administer this operation");
                    const replay = checkClaim(op.claims, inputCommand);
                    if (replay !== undefined)
                        return replay;
                    if (!actionsOf(op.policy, inputCommand.role).found)
                        return fail("invalid-command", `unknown role "${inputCommand.role}"`);
                    // A grant stands on an actor and a participation. Without these
                    // two the command commits a grant `invariantProblems` would flag
                    // live — "names an unknown actor", "has no participation to stand
                    // on" — which is a snapshot the model says cannot exist.
                    const granteeOrganization = organizationId(inputCommand.organizationId);
                    const granteeActor = actorId(inputCommand.actorId);
                    const grantee = orgs.get(granteeOrganization)?.actors.find((a) => a.actorId === granteeActor);
                    if (grantee === undefined)
                        return fail("invalid-command", "unknown actor");
                    if (!op.participations.some((p) => p.organizationId === granteeOrganization && p.status === "active")) {
                        return fail("denied", "the organization does not actively participate in this operation");
                    }
                    // What remains is existence. "Exactly one target" is no longer a
                    // check: `GrantTarget` is a two-arm union, so neither-and-both are
                    // unrepresentable, and the four guards this replaced — one pair
                    // per runtime — are gone with them.
                    const grantTarget = inputCommand.target.kind === "team"
                        ? { kind: "team", teamId: teamId(inputCommand.target.teamId) }
                        : { kind: "site", siteId: siteId(inputCommand.target.siteId) };
                    if (grantTarget.kind === "team" && !op.teams.some((t) => t.teamId === grantTarget.teamId)) {
                        return fail("invalid-command", "unknown team");
                    }
                    if (grantTarget.kind === "site" && !op.sites.some((s) => s.siteId === grantTarget.siteId)) {
                        return fail("invalid-command", "unknown site");
                    }
                    commitClaim(op.claims, inputCommand);
                    const grantId = `g-${nextId()}`;
                    const grant = {
                        grantId,
                        operationId: op.operationId,
                        organizationId: granteeOrganization,
                        actorId: granteeActor,
                        role: inputCommand.role,
                        target: grantTarget,
                        ...(inputCommand.primary === true ? { primary: true } : {}),
                    };
                    if (inputCommand.primary === true) {
                        op.grants = op.grants.map((g) => {
                            if (g.organizationId !== granteeOrganization || g.actorId !== granteeActor)
                                return g;
                            const { primary: _dropped, ...rest } = g;
                            return rest;
                        });
                    }
                    op.grants.push(grant);
                    op.audit.push({ at: clock.now(), by: `${principalOrFailure.organizationId}/${principalOrFailure.actorId}`, fact: `grant ${grantId} (${inputCommand.role}) to ${inputCommand.organizationId}/${inputCommand.actorId}` });
                    return ok(inputCommand.idempotencyKey, true);
                }
                case "revoke-grant": {
                    const op = ops.get(operationId(inputCommand.operationId));
                    if (op === undefined)
                        return fail("wrong-binding", "unknown operation");
                    if (!principalOrFailure.adminOfOperation)
                        return fail("denied", "the caller does not administer this operation");
                    const replay = checkClaim(op.claims, inputCommand);
                    if (replay !== undefined)
                        return replay;
                    const grant = op.grants.find((g) => g.grantId === inputCommand.grantId);
                    if (grant === undefined)
                        return fail("invalid-command", "unknown grant");
                    commitClaim(op.claims, inputCommand);
                    op.grants = op.grants.map((g) => (g.grantId === inputCommand.grantId ? { ...g, revoked: true } : g));
                    revokeRefreshRecords(op, grant.organizationId, grant.actorId);
                    op.audit.push({ at: clock.now(), by: `${principalOrFailure.organizationId}/${principalOrFailure.actorId}`, fact: `grant ${inputCommand.grantId} revoked; refresh records revoked` });
                    return ok(inputCommand.idempotencyKey, true);
                }
                case "select-hat": {
                    const op = ops.get(operationId(inputCommand.operationId));
                    if (op === undefined)
                        return fail("wrong-binding", "unknown operation");
                    if (!principalOrFailure.adminOfOperation && !(principalOrFailure.organizationId !== undefined &&
                        principalOrFailure.actorId !== undefined &&
                        op.grants.some((g) => g.grantId === inputCommand.grantId && g.organizationId === principalOrFailure.organizationId && g.actorId === principalOrFailure.actorId))) {
                        return fail("denied", "an actor selects their own hat or an administrator does");
                    }
                    const replay = checkClaim(op.claims, inputCommand);
                    if (replay !== undefined)
                        return replay;
                    const grant = op.grants.find((g) => g.grantId === inputCommand.grantId);
                    if (grant === undefined)
                        return fail("invalid-command", "unknown grant");
                    commitClaim(op.claims, inputCommand);
                    op.grants = op.grants.map((g) => {
                        if (g.grantId === inputCommand.grantId)
                            return { ...g, primary: true };
                        if (g.organizationId === grant.organizationId && g.actorId === grant.actorId) {
                            const { primary: _dropped, ...rest } = g;
                            return rest;
                        }
                        return g;
                    });
                    op.audit.push({ at: clock.now(), by: `${principalOrFailure.organizationId}/${principalOrFailure.actorId}`, fact: `primary hat set to grant ${inputCommand.grantId}` });
                    return ok(inputCommand.idempotencyKey, true);
                }
                case "disable-actor": {
                    const org = orgs.get(organizationId(inputCommand.organizationId));
                    if (org === undefined)
                        return fail("wrong-binding", "unknown organization");
                    if (!principalOrFailure.adminOfOrganization)
                        return fail("denied", "the caller does not administer this organization");
                    const replay = checkClaim(org.claims, inputCommand);
                    if (replay !== undefined)
                        return replay;
                    const actor = org.actors.find((a) => a.actorId === inputCommand.actorId);
                    if (actor === undefined)
                        return fail("invalid-command", "unknown actor");
                    commitClaim(org.claims, inputCommand);
                    actor.disabled = true;
                    for (const op of ops.values()) {
                        outbox.push({
                            id: `ob-${nextId()}`, to: "op", target: op.operationId, operationId: op.operationId,
                            kind: "actor-disabled", organizationId: org.organizationId, actorId: actorId(inputCommand.actorId),
                        });
                    }
                    org.audit.push({ at: clock.now(), by: `${org.organizationId}/${principalOrFailure.actorId}`, fact: `actor ${inputCommand.actorId} disabled` });
                    return ok(inputCommand.idempotencyKey, true);
                }
                default: {
                    // The exhaustiveness witness: this arm is `never` when every
                    // command kind has a case, so adding one fails the build here
                    // instead of silently routing to invalid-command. The failure —
                    // not a throw — stays: a caller that bypasses the types (an
                    // untyped host, a structurally stale version) still gets the
                    // closed taxonomy, never an exception.
                    inputCommand;
                    return fail("invalid-command", "unknown command kind");
                }
            }
        },
    };
    return {
        runtime,
        verificationKey: async () => ({
            keyId: signer.keyId,
            algorithm: signer.algorithm,
            publicKey: await signer.publicKey(),
        }),
        drainOutbox: deliverPending,
        pendingOutbox: () => outbox.length,
        snapshotOf,
        invitationsOf: (organizationId) => new Map([...(orgs.get(organizationId)?.invitations.entries() ?? [])].map(([invitationId, invitation]) => [invitationId, { operationId: invitation.operationId, status: invitation.status }])),
    };
};
