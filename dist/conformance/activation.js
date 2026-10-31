// The activation conformance family.
import { CONFORMANCE_PRINCIPALS, HOME_OP, IDP, INVITEE_ACTOR, INVITEE_ORG, INVITEE_UNCLAIMED } from "./world.js";
import { acceptActivation, assert, command, deepEqual, equal, expectFailure, freshAuth, requestActivation } from "./helpers.js";
import { runtimeCase } from "./case.js";
import { AUTHORITY_INTERFACE_VERSION, actorId, isFailed, operationId, organizationId } from "../contract.js";
export const ACTIVATION_CASES = [
    runtimeCase("OH-ACT-01", "an unclaimed actor is claimed once and its subject then issues", async (world) => {
        const issued = await requestActivation(world, CONFORMANCE_PRINCIPALS.inviteeAdmin, INVITEE_UNCLAIMED);
        const inspected = await world.runtime.activationInspect({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            secret: issued.secret,
        });
        deepEqual(inspected, { usable: true }, "inspection discloses only usability");
        const newcomer = { provider: IDP, subject: "invitee-newcomer" };
        const accepted = await acceptActivation(world, issued.secret, newcomer);
        if (isFailed(accepted))
            throw new Error(`accept: ${accepted.failure.kind}`);
        equal(accepted.applied, true, "the first acceptance applies");
        deepEqual(accepted.actor, { organizationId: INVITEE_ORG, actorId: INVITEE_UNCLAIMED }, "the secret selected the target actor");
        const replay = await acceptActivation(world, issued.secret, newcomer);
        if (isFailed(replay))
            throw new Error(`replay: ${replay.failure.kind}`);
        equal(replay.applied, false, "the same subject replays as success");
        deepEqual(replay.actor, accepted.actor, "the replay names the same actor");
        const other = await acceptActivation(world, issued.secret, { provider: IDP, subject: "invitee-other" });
        expectFailure(other, "unauthenticated", "a different subject cannot reuse the spent secret");
        const access = await world.runtime.accessFromEvidence({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            operationId: HOME_OP,
            evidence: newcomer,
        });
        // claiming grants no admission: the link resolves, so this is
        // not-admitted (no hat), never the unauthenticated of an unlinked subject
        expectFailure(access, "not-admitted", "the claimed subject resolves but wears no hat");
    }),
    runtimeCase("OH-ACT-02", "every unusable secret reports the same failure", async (world) => {
        const unknown = "AAAAAAAAAAAAAAAAAAAAAA";
        const inspection = await world.runtime.activationInspect({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            secret: unknown,
        });
        expectFailure(inspection, "unauthenticated", "unknown secret inspection");
        const acceptance = await acceptActivation(world, unknown, { provider: IDP, subject: "invitee-nobody" });
        expectFailure(acceptance, "unauthenticated", "unknown secret acceptance");
        if (isFailed(inspection) && isFailed(acceptance)) {
            equal(acceptance.failure.detail, inspection.failure.detail, "one public detail across both calls");
        }
    }),
    runtimeCase("OH-ACT-03", "a subject linked elsewhere is refused without consuming the claim", async (world) => {
        const issued = await requestActivation(world, CONFORMANCE_PRINCIPALS.inviteeAdmin, INVITEE_UNCLAIMED);
        const refused = await acceptActivation(world, issued.secret, CONFORMANCE_PRINCIPALS.dana.evidence);
        expectFailure(refused, "denied", "a subject owned by another actor");
        const stillUsable = await world.runtime.activationInspect({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            secret: issued.secret,
        });
        deepEqual(stillUsable, { usable: true }, "the refusal does not consume the request");
    }),
    runtimeCase("OH-ACT-04", "unlink ends issuance and a fresh subject can take the actor", async (world) => {
        const lead = CONFORMANCE_PRINCIPALS.inviteeLead;
        const unlink = await command(world, { kind: "unlink-principal", organizationId: INVITEE_ORG, actorId: INVITEE_ACTOR }, freshAuth(CONFORMANCE_PRINCIPALS.inviteeAdmin, HOME_OP), "act-04-unlink");
        assert(unlink.ok, `unlink: ${unlink.ok ? "" : unlink.failure.kind}`);
        const stopped = await world.runtime.accessFromEvidence({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            operationId: HOME_OP,
            evidence: lead.evidence,
        });
        expectFailure(stopped, "unauthenticated", "the released subject no longer issues");
        const issued = await requestActivation(world, CONFORMANCE_PRINCIPALS.inviteeAdmin, INVITEE_ACTOR);
        const replacement = { provider: IDP, subject: "invitee-lead-restored" };
        const accepted = await acceptActivation(world, issued.secret, replacement);
        if (isFailed(accepted))
            throw new Error(`replacement accept: ${accepted.failure.kind}`);
        equal(accepted.applied, true, "a replacement subject is bound");
        const access = await world.runtime.accessFromEvidence({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            operationId: HOME_OP,
            evidence: replacement,
        });
        expectFailure(access, "not-admitted", "the replacement subject resolves; no hat is invented");
    }),
];
