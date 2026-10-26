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
import { principalKey, revokeParticipation, checkClaim, commitClaim, } from "./state.js";
import { fail, ok } from "./result.js";
export const createOrganizationCoordinator = (deps) => {
    const { orgs, ops, principalLinks, outbox, clock, signer, nextId, adminRoles, orgAdmins, configureActions } = deps;
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
        for (const op of ops.values()) {
            outbox.push({
                id: `ob-${nextId()}`, target: op.operationId, operationId: op.operationId,
                kind: "actor-disabled", organizationId: org.organizationId, actorId: actorId(input.actorId),
            });
        }
        org.audit.push({ at: clock.now(), by: `${org.organizationId}/${principal.actorId}`, fact: `actor ${input.actorId} disabled` });
        return ok(input.idempotencyKey, true);
    };
    return {
        resolvePrincipal,
        command(input, principal) {
            switch (input.kind) {
                case "participation-accept": return acceptParticipation(input, principal);
                case "participation-revoke": return revokeOrganizationParticipation(input, principal);
                case "disable-actor": return disableActor(input, principal);
                default: return fail("invalid-command", "not an organization command");
            }
        },
    };
};
