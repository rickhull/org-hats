// The participation conformance family.
import { CONFORMANCE_PRINCIPALS, INVITEE_ORG, MERIDIAN, NORTH_TEAM } from "./world.js";
import { admitInvitee, assert, command, envelopeAuth, equal, expectFailure, freshAuth, issue, verifyOk } from "./helpers.js";
import { runtimeCase } from "./case.js";
import { AUTHORITY_INTERFACE_VERSION, operationId, organizationId, teamId } from "../contract.js";
export const PARTICIPATION_CASES = [
    runtimeCase("OH-PART-01", "invite, accept, admit: an invited organization receives a hat", async (world) => {
        await admitInvitee(world);
        const issued = await issue(world, CONFORMANCE_PRINCIPALS.inviteeLead, MERIDIAN);
        equal(issued.envelope.claims.hat.role, "field", "invitee hat");
        equal(issued.envelope.claims.hat.teamIds.length, 1, "invitee team reach");
        await verifyOk(world, issued.envelope, {
            now: issued.envelope.claims.iat + 1,
            expectedOperationId: MERIDIAN,
        });
    }),
    runtimeCase("OH-PART-02", "revoke is terminal: new issuance stops, the live envelope survives", async (world) => {
        const admin = await admitInvitee(world);
        const invitee = CONFORMANCE_PRINCIPALS.inviteeLead;
        const live = await issue(world, invitee, MERIDIAN);
        const revoke = await command(world, { kind: "participation-revoke", operationId: MERIDIAN, organizationId: INVITEE_ORG, by: "operation" }, envelopeAuth(admin.envelope), "conf-revoke");
        assert(revoke.ok, `revoke failed: ${revoke.ok ? "" : revoke.failure.kind}`);
        const stillLive = await verifyOk(world, live.envelope, {
            now: live.envelope.claims.iat + 1,
            expectedOperationId: MERIDIAN,
        });
        equal(stillLive.access.mayAct("observe", { kind: "team", teamId: NORTH_TEAM }), true, "live envelope survives revocation");
        const after = await world.runtime.accessFromEvidence({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            operationId: MERIDIAN,
            evidence: invitee.evidence,
        });
        expectFailure(after, "not-admitted", "revoked participation cannot be issued");
        const acceptAgain = await command(world, { kind: "participation-accept", operationId: MERIDIAN }, freshAuth(invitee, MERIDIAN), "conf-accept-again");
        expectFailure(acceptAgain, "denied", "an accepted invitation is terminal");
    }),
];
