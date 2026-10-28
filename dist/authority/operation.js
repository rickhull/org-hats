// The operation coordinator: sites, teams, grants, policy, op-side
// participation, refresh records, access requests, and the operation's
// audit.
//
// It owns the session surface — issuance from evidence, refresh, and
// presentation context — and the acts the operation owns: inviting an
// organization, admitting an actor, granting and revoking hats, and
// choosing a primary hat.
//
// It reads the organization map for the two facts a decision needs locally:
// the actor exists and is not disabled. The reference world shares one
// process; the deployed shape projects those facts into the operation
// instead (docs/authority_redesign.md § State ownership).
import { ACCESS_ENVELOPE_FORMAT, ACCESS_ENVELOPE_VERSION, actorId, asJson, canonicalJson, envelopeVersionFailure, isFailed, operationId, organizationId, siteId, teamId, } from "../contract.js";
import { applyParticipationEvent, wearableGrants, } from "../model.js";
import { actionsOf } from "../policy.js";
import { sha256Hex } from "./internal.js";
import { assembleAccessClaims, authenticationFactsOf } from "./claims.js";
import { checkClaim, commitClaim, principalKey, revokeParticipation, revokeRefreshRecords, } from "./state.js";
import { fail, ok } from "./result.js";
export const createOperationCoordinator = (deps) => {
    const { orgs, ops, principalLinks, outbox, clock, signer, nextId, lifetime, configureActions, snapshotOf } = deps;
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
        return assembleAccessClaims({
            snapshot,
            policy: op.policy,
            operationId: op.operationId,
            organizationId,
            actorId,
            configureActions,
            envelopeLifetimeSeconds: lifetime,
            issuedAt: clock.now(),
            ...(auth !== undefined ? { auth } : {}),
        });
    };
    const issue = async (op, organizationId, actorId, auth) => {
        const claims = buildEnvelope(op, organizationId, actorId, auth);
        if ("kind" in claims)
            return { ok: false, failure: claims };
        const signature = await signer.sign(canonicalJson(asJson(claims)));
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
        return { envelope, refresh: { kind: "rotated", handle } };
    };
    // --- the session surface ------------------------------------------------------------
    const accessFromEvidence = async (input) => {
        // the seam: the request carries plain strings, `op.operationId` is
        // the domain id from here down
        const op = ops.get(operationId(input.operationId));
        if (op === undefined)
            return { failure: { kind: "wrong-binding", detail: "unknown operation" } };
        const link = principalLinks.get(principalKey(input.evidence.provider, input.evidence.subject));
        if (link === undefined) {
            return { failure: { kind: "unauthenticated", detail: "no principal link for this evidence" } };
        }
        const result = await issue(op, link.organizationId, link.actorId, authenticationFactsOf(input.evidence));
        return isFailed(result) ? { failure: result.failure } : result;
    };
    const refresh = async (input) => {
        const op = ops.get(operationId(input.operationId));
        if (op === undefined)
            return { failure: { kind: "wrong-binding", detail: "unknown operation" } };
        const hash = await sha256Hex(input.handle);
        const record = op.refreshRecords.find((r) => r.handleHash === hash);
        if (record === undefined)
            return { failure: { kind: "unauthenticated", detail: "unknown refresh handle" } };
        if (record.revoked)
            return { failure: { kind: "unauthenticated", detail: "refresh handle revoked" } };
        if (record.superseded)
            return { failure: { kind: "unauthenticated", detail: "refresh handle superseded" } };
        if (![...principalLinks.values()].some((link) => link.organizationId === record.organizationId && link.actorId === record.actorId)) {
            record.revoked = true;
            return { failure: { kind: "unauthenticated", detail: "actor has no principal link" } };
        }
        // Supersede before issue, deliberately: the handle was consumed by
        // this attempt, and if issuance then fails — the actor disabled, the
        // participation revoked — the old handle must not survive to be
        // refreshed again. One attempt, one handle; fail closed rather than
        // risk two live handles.
        record.superseded = true;
        // the authentication event, not the envelope, survives the chain
        const result = await issue(op, record.organizationId, record.actorId, authenticationFactsOf(record));
        return isFailed(result) ? { failure: result.failure } : result;
    };
    const context = async (input) => {
        const { envelope } = input;
        const versionFailure = envelopeVersionFailure(envelope);
        if (versionFailure !== undefined)
            return { failure: versionFailure };
        if (!(await signer.verify(canonicalJson(asJson(envelope.claims)), envelope.signature))) {
            return { failure: { kind: "invalid-signature" } };
        }
        if (clock.now() >= envelope.claims.exp)
            return { failure: { kind: "expired" } };
        const op = ops.get(operationId(envelope.claims.operationId));
        const snapshot = op !== undefined ? snapshotOf(op.operationId) : undefined;
        if (op === undefined || snapshot === undefined)
            return { failure: { kind: "wrong-binding" } };
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
                return { failure: { kind: "unavailable", detail: `the policy bundle no longer carries the role "${g.role}"` } };
            }
            hats.push({
                role: g.role,
                actions: [...role.actions],
                target: g.target,
                primary: g.primary === true,
                grantId: g.grantId,
            });
        }
        return {
            actor: {
                organizationId: organizationId_,
                actorId: actorId_,
                ...(actor?.displayName !== undefined ? { displayName: actor.displayName } : {}),
            },
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
                        grantId: selected.grantId,
                    },
                }),
            sites: [...envelope.claims.sites],
            ...(envelope.claims.amr !== undefined ? { amr: [...envelope.claims.amr] } : {}),
            ...(envelope.claims.auth_time !== undefined ? { authTime: envelope.claims.auth_time } : {}),
        };
    };
    // --- operation commands -------------------------------------------------------------
    /** request-access needs no administrator: the evidence is the request. */
    const requestAccess = (input) => {
        if (input.kind !== "request-access")
            return fail("invalid-command", "wrong coordinator");
        const op = ops.get(operationId(input.operationId));
        if (op === undefined)
            return fail("wrong-binding", "unknown operation");
        const replay = checkClaim(op.claims, input);
        if (replay !== undefined)
            return replay;
        const link = principalLinks.get(principalKey(input.evidence.provider, input.evidence.subject));
        if (link === undefined)
            return fail("unauthenticated", "no principal link for this evidence");
        commitClaim(op.claims, input);
        const requestId = `ar-${nextId()}`;
        op.accessRequests.push({
            requestId,
            organizationId: link.organizationId,
            actorId: link.actorId,
            ...(input.note !== undefined ? { note: input.note } : {}),
        });
        op.audit.push({
            at: clock.now(),
            by: `${link.organizationId}/${link.actorId}`,
            fact: `access request ${requestId}${input.note !== undefined ? `: ${input.note}` : ""}`,
        });
        return ok(input.idempotencyKey, true);
    };
    const invite = (input, principal) => {
        if (input.kind !== "participation-invite")
            return fail("invalid-command", "wrong coordinator");
        const op = ops.get(operationId(input.operationId));
        const org = orgs.get(organizationId(input.organizationId));
        if (op === undefined)
            return fail("wrong-binding", "unknown operation");
        if (org === undefined)
            return fail("wrong-binding", "unknown organization");
        if (!principal.adminOfOperation)
            return fail("denied", "the caller does not administer this operation");
        const replay = checkClaim(op.claims, input);
        if (replay !== undefined)
            return replay;
        const invitee = organizationId(input.organizationId);
        const invited = applyParticipationEvent(op.participations, invitee, op.operationId, { kind: "invite", by: "operation" });
        if (!invited.ok)
            return fail("denied", invited.problem);
        commitClaim(op.claims, input);
        const invitationId = `inv-${nextId()}`;
        op.invitations.set(invitationId, { organizationId: invitee, status: "invited" });
        op.participations = [...invited.participations];
        outbox.push({
            id: `ob-${nextId()}`, target: invitee,
            kind: "invitation", invitationId, operationId: op.operationId,
            organizationId: invitee,
        });
        op.audit.push({ at: clock.now(), by: `${principal.organizationId}/${principal.actorId}`, fact: `invitation ${invitationId} to ${input.organizationId}` });
        return ok(input.idempotencyKey, true);
    };
    const revokeOperationParticipation = (input, principal) => {
        if (input.kind !== "participation-revoke")
            return fail("invalid-command", "wrong coordinator");
        if (input.by !== "operation")
            return fail("invalid-command", "wrong coordinator");
        const op = ops.get(operationId(input.operationId));
        if (op === undefined)
            return fail("wrong-binding", "unknown operation");
        if (!principal.adminOfOperation)
            return fail("denied", "the caller does not administer this operation");
        const replay = checkClaim(op.claims, input);
        if (replay !== undefined)
            return replay;
        const revoked = revokeParticipation(op, organizationId(input.organizationId), "operation");
        if (!revoked.ok)
            return fail("denied", revoked.problem);
        commitClaim(op.claims, input);
        for (const record of op.refreshRecords) {
            if (record.organizationId === input.organizationId)
                record.revoked = true;
        }
        op.audit.push({ at: clock.now(), by: `${principal.organizationId}/${principal.actorId}`, fact: `participation ${input.organizationId} revoked` });
        return ok(input.idempotencyKey, true);
    };
    const admit = (input, principal) => {
        if (input.kind !== "admit")
            return fail("invalid-command", "wrong coordinator");
        const op = ops.get(operationId(input.operationId));
        if (op === undefined)
            return fail("wrong-binding", "unknown operation");
        if (!principal.adminOfOperation)
            return fail("denied", "the caller does not administer this operation");
        const replay = checkClaim(op.claims, input);
        if (replay !== undefined)
            return replay;
        const actor = orgs.get(organizationId(input.organizationId))?.actors.find((a) => a.actorId === input.actorId);
        if (actor === undefined)
            return fail("invalid-command", "unknown actor");
        commitClaim(op.claims, input);
        op.accessRequests = op.accessRequests.filter((r) => !(r.organizationId === input.organizationId && r.actorId === input.actorId));
        op.audit.push({ at: clock.now(), by: `${principal.organizationId}/${principal.actorId}`, fact: `admitted ${input.organizationId}/${input.actorId}` });
        return ok(input.idempotencyKey, true);
    };
    const grantHat = (input, principal) => {
        if (input.kind !== "grant-hat")
            return fail("invalid-command", "wrong coordinator");
        const op = ops.get(operationId(input.operationId));
        if (op === undefined)
            return fail("wrong-binding", "unknown operation");
        if (!principal.adminOfOperation)
            return fail("denied", "the caller does not administer this operation");
        const replay = checkClaim(op.claims, input);
        if (replay !== undefined)
            return replay;
        if (!actionsOf(op.policy, input.role).found)
            return fail("invalid-command", `unknown role "${input.role}"`);
        // A grant stands on an actor and a participation. Without these
        // two the command commits a grant `invariantProblems` would flag
        // live — "names an unknown actor", "has no participation to stand
        // on" — which is a snapshot the model says cannot exist.
        const granteeOrganization = organizationId(input.organizationId);
        const granteeActor = actorId(input.actorId);
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
        const grantTarget = input.target.kind === "team"
            ? { kind: "team", teamId: teamId(input.target.teamId) }
            : { kind: "site", siteId: siteId(input.target.siteId) };
        if (grantTarget.kind === "team" && !op.teams.some((t) => t.teamId === grantTarget.teamId)) {
            return fail("invalid-command", "unknown team");
        }
        if (grantTarget.kind === "site" && !op.sites.some((s) => s.siteId === grantTarget.siteId)) {
            return fail("invalid-command", "unknown site");
        }
        commitClaim(op.claims, input);
        const grantId = `g-${nextId()}`;
        const grant = {
            grantId,
            operationId: op.operationId,
            organizationId: granteeOrganization,
            actorId: granteeActor,
            role: input.role,
            target: grantTarget,
            ...(input.primary === true ? { primary: true } : {}),
        };
        if (input.primary === true) {
            op.grants = op.grants.map((g) => {
                if (g.organizationId !== granteeOrganization || g.actorId !== granteeActor)
                    return g;
                const { primary: _dropped, ...rest } = g;
                return rest;
            });
        }
        op.grants.push(grant);
        op.audit.push({ at: clock.now(), by: `${principal.organizationId}/${principal.actorId}`, fact: `grant ${grantId} (${input.role}) to ${input.organizationId}/${input.actorId}` });
        return ok(input.idempotencyKey, true);
    };
    const revokeGrant = (input, principal) => {
        if (input.kind !== "revoke-grant")
            return fail("invalid-command", "wrong coordinator");
        const op = ops.get(operationId(input.operationId));
        if (op === undefined)
            return fail("wrong-binding", "unknown operation");
        if (!principal.adminOfOperation)
            return fail("denied", "the caller does not administer this operation");
        const replay = checkClaim(op.claims, input);
        if (replay !== undefined)
            return replay;
        const grant = op.grants.find((g) => g.grantId === input.grantId);
        if (grant === undefined)
            return fail("invalid-command", "unknown grant");
        commitClaim(op.claims, input);
        op.grants = op.grants.map((g) => (g.grantId === input.grantId ? { ...g, revoked: true } : g));
        revokeRefreshRecords(op, grant.organizationId, grant.actorId);
        op.audit.push({ at: clock.now(), by: `${principal.organizationId}/${principal.actorId}`, fact: `grant ${input.grantId} revoked; refresh records revoked` });
        return ok(input.idempotencyKey, true);
    };
    const selectHat = (input, principal) => {
        if (input.kind !== "select-hat")
            return fail("invalid-command", "wrong coordinator");
        const op = ops.get(operationId(input.operationId));
        if (op === undefined)
            return fail("wrong-binding", "unknown operation");
        const selectsOwn = op.grants.some((g) => g.grantId === input.grantId &&
            g.organizationId === principal.organizationId &&
            g.actorId === principal.actorId);
        if (!principal.adminOfOperation && !selectsOwn) {
            return fail("denied", "an actor selects their own hat or an administrator does");
        }
        const replay = checkClaim(op.claims, input);
        if (replay !== undefined)
            return replay;
        const grant = op.grants.find((g) => g.grantId === input.grantId);
        if (grant === undefined)
            return fail("invalid-command", "unknown grant");
        const snapshot = snapshotOf(op.operationId);
        if (snapshot === undefined)
            return fail("wrong-binding", "unknown operation");
        const wearable = wearableGrants(snapshot, grant.organizationId, grant.actorId, op.operationId);
        if (!wearable.some((g) => g.grantId === grant.grantId)) {
            return fail("denied", "the grant is not wearable");
        }
        commitClaim(op.claims, input);
        op.grants = op.grants.map((g) => {
            if (g.grantId === input.grantId)
                return { ...g, primary: true };
            if (g.organizationId === grant.organizationId && g.actorId === grant.actorId) {
                const { primary: _dropped, ...rest } = g;
                return rest;
            }
            return g;
        });
        op.audit.push({ at: clock.now(), by: `${principal.organizationId}/${principal.actorId}`, fact: `primary hat set to grant ${input.grantId}` });
        return ok(input.idempotencyKey, true);
    };
    return {
        accessFromEvidence,
        refresh,
        context,
        requestAccess,
        command(input, principal) {
            switch (input.kind) {
                case "participation-invite": return invite(input, principal);
                case "participation-revoke": return revokeOperationParticipation(input, principal);
                case "admit": return admit(input, principal);
                case "grant-hat": return grantHat(input, principal);
                case "revoke-grant": return revokeGrant(input, principal);
                case "select-hat": return selectHat(input, principal);
                default: return fail("invalid-command", "not an operation command");
            }
        },
    };
};
