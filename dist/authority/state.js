// The two coordinators' state shapes and the pure helpers they share.
//
// The in-memory engine is one process, so the organization coordinator and
// the operation coordinator hold their facts in two maps but can read each
// other for the checks the reference world does locally. The types make the
// ownership explicit: actors, principal links, invitations, and org audits
// are organization-side; sites, teams, grants, policy, refresh records,
// access requests, and op audits are operation-side. Participation is the
// one fact both sides carry, by design — the two halves meet at the model's
// transition function.
//
// Everything here is pure: no clock, signer, or storage. The coordinators
// supply those.
import { canonicalJson, } from "../contract.js";
import { applyParticipationEvent, } from "../model.js";
import { fail, ok } from "./result.js";
/** The principal-link key: the (provider, subject) pair encoded as JSON, so
 * no split of the two strings can collide with another — ":" concatenation
 * made `"a:b"/"c"` and `"a"/"b:c"` the same link. */
export const principalKey = (provider, subject) => JSON.stringify([provider, subject]);
/** Assemble one operation's view. Every list is copied: the snapshot is a
 * caller's to hold and mutate, and a shared array would make engine state
 * the caller's to corrupt. `readonly` on the type says the same thing; this
 * is the runtime half. */
export const snapshotOf = (ops, orgs, operationId) => {
    const op = ops.get(operationId);
    if (op === undefined)
        return undefined;
    return {
        organizations: [...orgs.values()].map((org) => ({
            organizationId: org.organizationId,
            ...(org.displayName !== undefined ? { displayName: org.displayName } : {}),
        })),
        actors: [...orgs.values()].flatMap((org) => org.actors.map((actor) => ({ ...actor }))),
        operations: [...ops.values()].map((o) => ({
            operationId: o.operationId,
            ...(o.displayName !== undefined ? { displayName: o.displayName } : {}),
            ...(o.slug !== undefined ? { slug: o.slug } : {}),
            ...(o.bounded !== undefined ? { bounded: o.bounded } : {}),
        })),
        sites: [...op.sites],
        teams: op.teams
            .filter((team) => team.status === "active")
            .map((team) => ({
            teamId: team.teamId,
            siteId: team.siteId,
            organizationId: team.organizationId,
            ...(team.displayName !== undefined ? { displayName: team.displayName } : {}),
        })),
        grants: [...op.grants],
        participations: [...op.participations],
    };
};
export const payloadHash = (command) => {
    const { idempotencyKey: _k, authorization: _a, ...rest } = command;
    return canonicalJson(rest);
};
/** A retry claims its earlier result; the same key with a different payload
 * is a misuse, not a retry. Checking is pure — the claim is committed with
 * the mutation it guards, so a denied command never poisons its key. */
export const checkClaim = (claims, command) => {
    const existing = claims.get(command.idempotencyKey);
    if (existing === undefined)
        return undefined;
    if (existing.payloadHash !== payloadHash(command)) {
        return fail("invalid-command", "idempotency key reused with a different payload");
    }
    return ok(command.idempotencyKey, false);
};
export const commitClaim = (claims, command) => {
    claims.set(command.idempotencyKey, { payloadHash: payloadHash(command), receiptApplied: true });
};
/** Revoke one organization's participation through the state machine.
 *
 * Revoking twice is a safe retry rather than a failure: the state the caller
 * asked for is the state that holds, and a retry under a fresh idempotency
 * key must not read as an error. "Not participating" is a different thing
 * and stays a denial. Whether a repeat is idempotent is the adapter's
 * policy; that `revoked` never moves back is the model's, and
 * `applyParticipationEvent` is what enforces it. */
export const revokeParticipation = (op, organizationId, by) => {
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
export const revokeRefreshRecords = (op, organizationId, actorId) => {
    for (const record of op.refreshRecords) {
        if (record.organizationId === organizationId && record.actorId === actorId)
            record.revoked = true;
    }
};
