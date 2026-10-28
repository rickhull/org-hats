// The organization coordinator: actors, verified-principal links,
// org-side participation, invitations, and the organization's audit.
//
// It handles the acts the organization owns — accepting or revoking its
// participation and disabling its own actors — and it resolves a caller's
// evidence or envelope into the durable `(organizationId, actorId)` pair
// plus the administration flags both coordinators gate on.
//
// The coordinator reads the operation map for the participation state a
// revoke must move; that read is the reference world's, not a distributed
// one. The deployed shape projects the facts it needs instead.
import { actorId, asJson, canonicalJson, envelopeVersionFailure, operationId, organizationId, } from "../contract.js";
import { sha256Hex } from "./internal.js";
import { principalKey, revokeParticipation, checkClaim, commitClaim, } from "./state.js";
import { fail, ok } from "./result.js";
export const createOrganizationCoordinator = (deps) => {
    const { orgs, ops, principalLinks, outbox, clock, signer, nextId, adminRoles, orgAdmins, configureActions, activationLifetime, activationSecret, } = deps;
    const unusableActivation = () => ({
        failure: { kind: "unauthenticated", detail: "activation is not usable" },
    });
    const linksTo = (organization, actor) => [...principalLinks.entries()]
        .filter(([, link]) => link.organizationId === organization && link.actorId === actor)
        .map(([key]) => key);
    const revokeActiveRequests = (org, target) => {
        const at = clock.now();
        for (const request of org.activationRequests) {
            if (request.actorId === target && request.consumedAt === undefined &&
                request.revokedAt === undefined && clock.now() < request.expiresAt)
                request.revokedAt = at;
        }
    };
    const resolvePrincipal = async (authorization, boundTo) => {
        if (authorization.kind === "fresh-evidence") {
            const link = principalLinks.get(principalKey(authorization.evidence.provider, authorization.evidence.subject));
            if (link === undefined)
                return { kind: "unauthenticated", detail: "no principal link for this evidence" };
            const org = orgs.get(link.organizationId);
            const actor = org?.actors.find((a) => a.actorId === link.actorId);
            if (org === undefined || actor === undefined)
                return { kind: "unauthenticated" };
            if (actor.disabled)
                return { kind: "not-admitted", detail: "actor disabled" };
            return {
                organizationId: link.organizationId,
                actorId: link.actorId,
                adminOfOperation: false,
                adminOfOrganization: (orgAdmins[link.organizationId] ?? []).includes(link.actorId),
            };
        }
        const claims = authorization.envelope.claims;
        const versionFailure = envelopeVersionFailure(authorization.envelope);
        if (versionFailure !== undefined)
            return versionFailure;
        if (!(await signer.verify(canonicalJson(asJson(claims)), authorization.envelope.signature))) {
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
    const acceptParticipation = (input, principal) => {
        if (input.kind !== "participation-accept")
            return fail("invalid-command", "wrong coordinator");
        const org = orgs.get(principal.organizationId);
        if (org === undefined)
            return fail("wrong-binding");
        if (!principal.adminOfOrganization)
            return fail("denied", "the caller does not administer this organization");
        const replay = checkClaim(org.claims, input);
        if (replay !== undefined)
            return replay;
        const found = [...org.invitations.entries()].find(([, invitation]) => invitation.operationId === input.operationId);
        const invitationId = found?.[0];
        const invitation = found?.[1];
        if (invitationId === undefined || invitation === undefined)
            return fail("denied", "no such invitation");
        if (invitation.status !== "pending")
            return fail("denied", `invitation already ${invitation.status}`);
        commitClaim(org.claims, input);
        invitation.status = "accepted";
        const op = ops.get(invitation.operationId);
        if (op !== undefined) {
            outbox.push({
                id: `ob-${nextId()}`, target: invitation.operationId,
                kind: "acceptance", invitationId,
                operationId: invitation.operationId, organizationId: org.organizationId,
            });
        }
        org.audit.push({ at: clock.now(), by: `${org.organizationId}/${principal.actorId}`, fact: `invitation ${invitationId} accepted` });
        return ok(input.idempotencyKey, true);
    };
    const revokeOrganizationParticipation = (input, principal) => {
        if (input.kind !== "participation-revoke")
            return fail("invalid-command", "wrong coordinator");
        if (input.by !== "organization")
            return fail("invalid-command", "wrong coordinator");
        const org = orgs.get(organizationId(input.organizationId));
        if (org === undefined)
            return fail("wrong-binding", "unknown organization");
        if (!principal.adminOfOrganization)
            return fail("denied", "the caller does not administer this organization");
        const replay = checkClaim(org.claims, input);
        if (replay !== undefined)
            return replay;
        const op = ops.get(operationId(input.operationId));
        if (op === undefined)
            return fail("wrong-binding", "unknown operation");
        const revoked = revokeParticipation(op, organizationId(input.organizationId), "organization");
        if (!revoked.ok)
            return fail("denied", revoked.problem);
        commitClaim(org.claims, input);
        for (const record of op.refreshRecords) {
            if (record.organizationId === input.organizationId)
                record.revoked = true;
        }
        org.audit.push({ at: clock.now(), by: `${org.organizationId}/${principal.actorId}`, fact: `participation in ${input.operationId} revoked` });
        return ok(input.idempotencyKey, true);
    };
    const disableActor = (input, principal) => {
        if (input.kind !== "disable-actor")
            return fail("invalid-command", "wrong coordinator");
        const org = orgs.get(organizationId(input.organizationId));
        if (org === undefined)
            return fail("wrong-binding", "unknown organization");
        if (!principal.adminOfOrganization)
            return fail("denied", "the caller does not administer this organization");
        const replay = checkClaim(org.claims, input);
        if (replay !== undefined)
            return replay;
        const actor = org.actors.find((a) => a.actorId === input.actorId);
        if (actor === undefined)
            return fail("invalid-command", "unknown actor");
        commitClaim(org.claims, input);
        actor.disabled = true;
        revokeActiveRequests(org, actor.actorId);
        for (const op of ops.values()) {
            outbox.push({
                id: `ob-${nextId()}`, target: op.operationId, operationId: op.operationId,
                kind: "actor-disabled", organizationId: org.organizationId, actorId: actorId(input.actorId),
            });
        }
        org.audit.push({ at: clock.now(), by: `${org.organizationId}/${principal.actorId}`, fact: `actor ${input.actorId} disabled` });
        return ok(input.idempotencyKey, true);
    };
    const revokeActivation = (input, principal) => {
        if (input.kind !== "revoke-activation")
            return fail("invalid-command", "wrong coordinator");
        const org = orgs.get(organizationId(input.organizationId));
        if (org === undefined)
            return fail("wrong-binding", "unknown organization");
        if (input.authorization.kind !== "fresh-evidence") {
            return fail("denied", "activation recovery requires fresh evidence");
        }
        if (principal.organizationId !== org.organizationId)
            return fail("wrong-binding");
        if (!principal.adminOfOrganization)
            return fail("denied", "the caller does not administer this organization");
        const replay = checkClaim(org.claims, input);
        if (replay !== undefined)
            return replay;
        const target = org.actors.find((candidate) => candidate.actorId === input.actorId);
        if (target === undefined)
            return fail("invalid-command", "unknown actor");
        revokeActiveRequests(org, target.actorId);
        commitClaim(org.claims, input);
        org.audit.push({
            at: clock.now(),
            by: `${org.organizationId}/${principal.actorId}`,
            fact: `activation for actor ${target.actorId} revoked`,
        });
        return ok(input.idempotencyKey, true);
    };
    const unlinkPrincipal = (input, principal) => {
        if (input.kind !== "unlink-principal")
            return fail("invalid-command", "wrong coordinator");
        const org = orgs.get(organizationId(input.organizationId));
        if (org === undefined)
            return fail("wrong-binding", "unknown organization");
        if (input.authorization.kind !== "fresh-evidence") {
            return fail("denied", "principal recovery requires fresh evidence");
        }
        if (principal.organizationId !== org.organizationId)
            return fail("wrong-binding");
        if (!principal.adminOfOrganization)
            return fail("denied", "the caller does not administer this organization");
        const replay = checkClaim(org.claims, input);
        if (replay !== undefined)
            return replay;
        const target = org.actors.find((candidate) => candidate.actorId === input.actorId);
        if (target === undefined)
            return fail("invalid-command", "unknown actor");
        for (const key of linksTo(org.organizationId, target.actorId))
            principalLinks.delete(key);
        revokeActiveRequests(org, target.actorId);
        for (const op of ops.values()) {
            outbox.push({
                id: `ob-${nextId()}`,
                target: op.operationId,
                operationId: op.operationId,
                kind: "actor-unlinked",
                organizationId: org.organizationId,
                actorId: target.actorId,
            });
        }
        commitClaim(org.claims, input);
        org.audit.push({
            at: clock.now(),
            by: `${org.organizationId}/${principal.actorId}`,
            fact: `principal links for actor ${target.actorId} removed`,
        });
        return ok(input.idempotencyKey, true);
    };
    const activationRequest = async (input) => {
        const principal = await resolvePrincipal({ kind: "fresh-evidence", evidence: input.evidence, operationId: "" });
        if ("kind" in principal)
            return { failure: principal };
        const org = orgs.get(organizationId(input.organizationId));
        if (org === undefined || principal.organizationId !== org.organizationId) {
            return { failure: { kind: "wrong-binding" } };
        }
        if (!principal.adminOfOrganization) {
            return { failure: { kind: "denied", detail: "the caller does not administer this organization" } };
        }
        const target = org.actors.find((candidate) => candidate.actorId === input.actorId);
        if (target === undefined)
            return { failure: { kind: "invalid-command", detail: "unknown actor" } };
        if (target.disabled)
            return { failure: { kind: "not-admitted", detail: "actor disabled" } };
        if (linksTo(org.organizationId, target.actorId).length > 0) {
            return { failure: { kind: "denied", detail: "actor already has a principal link" } };
        }
        const secret = activationSecret();
        const secretHash = await sha256Hex(secret);
        revokeActiveRequests(org, target.actorId);
        const issuedAt = clock.now();
        const request = {
            requestId: `activation-${nextId()}`,
            organizationId: org.organizationId,
            actorId: target.actorId,
            secretHash,
            issuedAt,
            expiresAt: (issuedAt + activationLifetime),
        };
        org.activationRequests.push(request);
        org.audit.push({ at: issuedAt, by: `${org.organizationId}/${principal.actorId}`, fact: `activation for actor ${target.actorId} issued` });
        return { requestId: request.requestId, secret, expiresAt: request.expiresAt };
    };
    const requestForSecret = async (secret) => {
        const secretHash = await sha256Hex(secret);
        for (const org of orgs.values()) {
            const request = org.activationRequests.find((candidate) => candidate.secretHash === secretHash);
            if (request !== undefined)
                return { org, request };
        }
        return undefined;
    };
    const activationInspect = async (input) => {
        const found = await requestForSecret(input.secret);
        if (found === undefined || found.request.consumedAt !== undefined ||
            found.request.revokedAt !== undefined || clock.now() >= found.request.expiresAt)
            return unusableActivation();
        return { usable: true };
    };
    const activationAccept = async (input) => {
        const found = await requestForSecret(input.secret);
        if (found === undefined)
            return unusableActivation();
        const { org, request } = found;
        const key = principalKey(input.evidence.provider, input.evidence.subject);
        const existing = principalLinks.get(key);
        if (request.consumedAt !== undefined) {
            return existing?.organizationId === org.organizationId && existing.actorId === request.actorId
                ? { applied: false, actor: { organizationId: org.organizationId, actorId: request.actorId } }
                : unusableActivation();
        }
        if (request.revokedAt !== undefined || clock.now() >= request.expiresAt)
            return unusableActivation();
        const target = org.actors.find((candidate) => candidate.actorId === request.actorId);
        if (target === undefined || target.disabled)
            return unusableActivation();
        if (existing !== undefined && (existing.organizationId !== org.organizationId || existing.actorId !== target.actorId)) {
            return { failure: { kind: "denied", detail: "the principal is already linked to another actor" } };
        }
        const targetLinks = linksTo(org.organizationId, target.actorId);
        if (targetLinks.length > 0)
            return unusableActivation();
        principalLinks.set(key, { organizationId: org.organizationId, actorId: target.actorId });
        request.consumedAt = clock.now();
        org.audit.push({ at: request.consumedAt, by: "activation", fact: `activation for actor ${target.actorId} accepted` });
        return { applied: true, actor: { organizationId: org.organizationId, actorId: target.actorId } };
    };
    return {
        resolvePrincipal,
        activationRequest,
        activationInspect,
        activationAccept,
        command(input, principal) {
            switch (input.kind) {
                case "participation-accept": return acceptParticipation(input, principal);
                case "participation-revoke": return revokeOrganizationParticipation(input, principal);
                case "disable-actor": return disableActor(input, principal);
                case "unlink-principal": return unlinkPrincipal(input, principal);
                case "revoke-activation": return revokeActivation(input, principal);
                default: return fail("invalid-command", "not an organization command");
            }
        },
    };
};
