// Assertions and runtime helpers shared by the conformance families. They
// call the public surface only; the families hold the cases.
import { AUTHORITY_INTERFACE_VERSION, isFailed, } from "../contract.js";
import { verify } from "../access/verify.js";
import { CONFORMANCE_PRINCIPALS, INVITEE_ORG, MERIDIAN, NORTH_TEAM, } from "./world.js";
export const assert = (condition, message) => {
    if (!condition)
        throw new Error(message);
};
export const equal = (actual, expected, message) => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
};
export const deepEqual = (actual, expected, message) => {
    const left = JSON.stringify(actual);
    const right = JSON.stringify(expected);
    if (left !== right)
        throw new Error(`${message}: expected ${right}, got ${left}`);
};
export const expectFailure = (result, kind, message) => {
    if (!isFailed(result))
        throw new Error(`${message}: expected ${kind}, got success`);
    equal(result.failure.kind, kind, message);
};
export const command = (world, body, authorization, key) => world.runtime.command({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    idempotencyKey: key,
    authorization,
    ...body,
});
export const envelopeAuth = (envelope) => ({
    kind: "access-envelope",
    envelope,
});
export const freshAuth = (entry, operationId) => ({
    kind: "fresh-evidence",
    evidence: entry.evidence,
    operationId,
});
export const issue = async (world, entry, operationId) => {
    const result = await world.runtime.accessFromEvidence({
        interfaceVersion: AUTHORITY_INTERFACE_VERSION,
        operationId,
        evidence: entry.evidence,
    });
    if (isFailed(result)) {
        throw new Error(`issuance for ${entry.label} at ${operationId}: ${result.failure.kind}`);
    }
    return result;
};
export const requestActivation = async (world, entry, actor) => {
    const result = await world.runtime.activationRequest({
        interfaceVersion: AUTHORITY_INTERFACE_VERSION,
        organizationId: entry.organizationId,
        actorId: actor,
        evidence: entry.evidence,
    });
    if (isFailed(result)) {
        throw new Error(`activation request for ${entry.label}: ${result.failure.kind}`);
    }
    return result;
};
export const acceptActivation = (world, secret, evidence) => world.runtime.activationAccept({ interfaceVersion: AUTHORITY_INTERFACE_VERSION, secret, evidence });
export const verifyOk = async (world, envelope, context) => {
    const result = await verify(envelope, world.keys, context);
    if (isFailed(result))
        throw new Error(`verification: ${result.failure.kind}`);
    return result;
};
/** Invite, accept, and grant the invitee's first hat; returns the operation
 * administrator's envelope for the rest of the case. */
export const admitInvitee = async (world) => {
    const invitee = CONFORMANCE_PRINCIPALS.inviteeLead;
    const admin = await issue(world, CONFORMANCE_PRINCIPALS.len, MERIDIAN);
    const invite = await command(world, { kind: "participation-invite", operationId: MERIDIAN, organizationId: INVITEE_ORG }, envelopeAuth(admin.envelope), "conf-invite");
    assert(invite.ok, `invite failed: ${invite.ok ? "" : invite.failure.kind}`);
    const accept = await command(world, { kind: "participation-accept", operationId: MERIDIAN }, freshAuth(invitee, MERIDIAN), "conf-accept");
    assert(accept.ok, `accept failed: ${accept.ok ? "" : accept.failure.kind}`);
    // the acceptance is delivered on the next runtime call; the grant then
    // admits the invitee with a wearable hat
    const grant = await command(world, {
        kind: "grant-hat",
        operationId: MERIDIAN,
        organizationId: INVITEE_ORG,
        actorId: invitee.actorId,
        role: "field",
        target: { kind: "team", teamId: NORTH_TEAM },
    }, envelopeAuth(admin.envelope), "conf-invitee-grant");
    assert(grant.ok, `grant failed: ${grant.ok ? "" : grant.failure.kind}`);
    return admin;
};
