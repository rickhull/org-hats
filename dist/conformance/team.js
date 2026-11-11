// The team conformance family.
import { CONFORMANCE_PRINCIPALS, EAST, HARBOR_LOGISTICS, MERIDIAN, SAM } from "./world.js";
import { assert, command, envelopeAuth, expectFailure, freshAuth, issue, verifyOk } from "./helpers.js";
import { runtimeCase } from "./case.js";
import { AUTHORITY_INTERFACE_VERSION, actorId, isFailed, operationId, organizationId, siteId, teamId } from "../contract.js";
export const TEAM_CASES = [
    runtimeCase("OH-TEAM-01", "an organization requests and the operation admits a team; grants can target it", async (world) => {
        const dana = CONFORMANCE_PRINCIPALS.dana;
        const len = CONFORMANCE_PRINCIPALS.len;
        const body = {
            kind: "request-team",
            operationId: MERIDIAN,
            organizationId: HARBOR_LOGISTICS,
            teamId: "team-conformance-lifecycle",
            siteId: EAST,
            longName: "Conformance Crew",
        };
        const requested = await command(world, body, freshAuth(dana, MERIDIAN), "team-01-request");
        assert(requested.ok, "the organization requests the team");
        const early = await command(world, {
            kind: "grant-hat",
            operationId: MERIDIAN,
            organizationId: HARBOR_LOGISTICS,
            actorId: SAM,
            role: "field",
            target: { kind: "team", teamId: "team-conformance-lifecycle" },
        }, envelopeAuth((await issue(world, len, MERIDIAN)).envelope), "team-01-early-grant");
        expectFailure(early, "invalid-command", "a pending team is not a grant target");
        const admitted = await command(world, { kind: "admit-team", operationId: MERIDIAN, teamId: "team-conformance-lifecycle" }, envelopeAuth((await issue(world, len, MERIDIAN)).envelope), "team-01-admit");
        assert(admitted.ok, "the operation admits the team");
        const grant = await command(world, {
            kind: "grant-hat",
            operationId: MERIDIAN,
            organizationId: HARBOR_LOGISTICS,
            actorId: SAM,
            role: "field",
            target: { kind: "team", teamId: "team-conformance-lifecycle" },
        }, envelopeAuth((await issue(world, len, MERIDIAN)).envelope), "team-01-grant");
        assert(grant.ok, "the admitted team is a grant target");
        const sam = await issue(world, CONFORMANCE_PRINCIPALS.sam, MERIDIAN);
        const context = await world.runtime.context({ interfaceVersion: AUTHORITY_INTERFACE_VERSION, envelope: sam.envelope });
        if (isFailed(context))
            throw new Error(`team context: ${context.failure.kind}`);
        assert(context.wearableHats.some((hat) => hat.target.kind === "team" && hat.target.teamId === "team-conformance-lifecycle"), "the worn hat names the new team");
    }),
    runtimeCase("OH-TEAM-02", "retirement revokes the team's grants and refresh, and keeps the envelope window", async (world) => {
        const dana = CONFORMANCE_PRINCIPALS.dana;
        const len = CONFORMANCE_PRINCIPALS.len;
        const teamId = "team-conformance-retire";
        assert((await command(world, { kind: "request-team", operationId: MERIDIAN, organizationId: HARBOR_LOGISTICS, teamId, siteId: EAST }, freshAuth(dana, MERIDIAN), "team-02-request")).ok, "request");
        assert((await command(world, { kind: "admit-team", operationId: MERIDIAN, teamId }, envelopeAuth((await issue(world, len, MERIDIAN)).envelope), "team-02-admit")).ok, "admit");
        assert((await command(world, {
            kind: "grant-hat",
            operationId: MERIDIAN,
            organizationId: HARBOR_LOGISTICS,
            actorId: SAM,
            role: "field",
            target: { kind: "team", teamId },
        }, envelopeAuth((await issue(world, len, MERIDIAN)).envelope), "team-02-grant")).ok, "grant");
        const sam = await issue(world, CONFORMANCE_PRINCIPALS.sam, MERIDIAN);
        const retired = await command(world, { kind: "retire-team", operationId: MERIDIAN, teamId }, freshAuth(dana, MERIDIAN), "team-02-retire");
        assert(retired.ok, "the owning organization retires the team");
        const dead = await world.runtime.refresh({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            operationId: MERIDIAN,
            handle: sam.refresh.kind === "rotated" ? sam.refresh.handle : "",
        });
        expectFailure(dead, "unauthenticated", "the grant's refresh chain dies");
        await verifyOk(world, sam.envelope, {
            now: sam.envelope.claims.iat + 1,
            expectedOperationId: MERIDIAN,
        });
        const reuse = await command(world, { kind: "request-team", operationId: MERIDIAN, organizationId: HARBOR_LOGISTICS, teamId, siteId: EAST }, freshAuth(dana, MERIDIAN), "team-02-reuse");
        expectFailure(reuse, "invalid-command", "a retired id is never reused");
    }),
    runtimeCase("OH-TEAM-03", "the team authorization split holds", async (world) => {
        const dana = CONFORMANCE_PRINCIPALS.dana;
        const nonAdmin = await command(world, { kind: "request-team", operationId: MERIDIAN, organizationId: HARBOR_LOGISTICS, teamId: "team-conformance-auth", siteId: EAST }, freshAuth(CONFORMANCE_PRINCIPALS.sam, MERIDIAN), "team-03-non-admin");
        expectFailure(nonAdmin, "denied", "a non-administrator cannot request a team");
        assert((await command(world, { kind: "request-team", operationId: MERIDIAN, organizationId: HARBOR_LOGISTICS, teamId: "team-conformance-auth", siteId: EAST }, freshAuth(dana, MERIDIAN), "team-03-request")).ok, "request");
        const ownerFresh = await command(world, { kind: "admit-team", operationId: MERIDIAN, teamId: "team-conformance-auth" }, freshAuth(dana, MERIDIAN), "team-03-admit-owner");
        expectFailure(ownerFresh, "denied", "organization standing is not operation standing");
        assert((await command(world, { kind: "admit-team", operationId: MERIDIAN, teamId: "team-conformance-auth" }, envelopeAuth((await issue(world, CONFORMANCE_PRINCIPALS.len, MERIDIAN)).envelope), "team-03-admit-admin")).ok, "an operation administrator admits");
        const ownerEnvelope = await command(world, { kind: "retire-team", operationId: MERIDIAN, teamId: "team-conformance-auth" }, envelopeAuth((await issue(world, dana, MERIDIAN)).envelope), "team-03-retire-envelope");
        expectFailure(ownerEnvelope, "denied", "owner retirement requires fresh evidence");
        assert((await command(world, { kind: "retire-team", operationId: MERIDIAN, teamId: "team-conformance-auth" }, envelopeAuth((await issue(world, CONFORMANCE_PRINCIPALS.len, MERIDIAN)).envelope), "team-03-retire-admin")).ok, "an operation administrator retires the team");
    }),
];
