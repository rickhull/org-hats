// The model conformance family.
import { ATLAS_ORG, BOOTH_001, CIDERS_ORG, DANA_OKAFOR, FESTIVAL, FESTIVAL_BOOTH_COUNT, FESTIVAL_OP, GATE, GATE_CREW, HARBOR_LOGISTICS, HARBOR_TEAM, LEN, MERIDIAN, NOBODY, NORTH_FLOOR, NORTH_ORG, NORTH_TEAM, PARK_ORG, PRIYA, PROFESSIONAL_OPERATION, ROW, SAM } from "./world.js";
import { assert, deepEqual, equal } from "./helpers.js";
import { modelCase } from "./case.js";
import { decide, grantReaches, invariantProblems, readReach } from "../model.js";
import { actorId, operationId, organizationId, siteId, teamId } from "../contract.js";
const professional = PROFESSIONAL_OPERATION.snapshot;
const festival = FESTIVAL.snapshot;
export const MODEL_CASES = [
    modelCase("OH-MODEL-01", "the professional twin is multi-organization and multi-site", () => {
        equal(professional.organizations.length, 3, "organizations");
        equal(professional.sites.length, 2, "sites");
        equal(professional.teams.length, 4, "teams");
        equal(professional.participations.length, 3, "participations");
        deepEqual(invariantProblems(professional, PROFESSIONAL_OPERATION.policy), [], "invariants");
    }),
    modelCase("OH-MODEL-02", "the festival is a bounded booth burst", () => {
        equal(festival.operations[0]?.bounded, true, "bounded operation");
        const booths = festival.teams.filter((team) => team.teamId.startsWith("team-booth-"));
        equal(booths.length, FESTIVAL_BOOTH_COUNT, "booth count");
        assert(booths.every((team) => team.siteId === ROW && team.organizationId === CIDERS_ORG), "every booth is at the tasting row under the ciders guild");
        deepEqual(invariantProblems(festival, FESTIVAL.policy), [], "invariants");
    }),
    modelCase("OH-MODEL-03", "a site grant reaches the site and every team at it, never another site", () => {
        const grant = festival.grants.find((candidate) => candidate.grantId === "g-fest-1");
        assert(grant !== undefined, "Iris's site grant exists");
        assert(grantReaches(festival, grant, { kind: "site", siteId: ROW }), "site target");
        assert(grantReaches(festival, grant, { kind: "team", teamId: BOOTH_001 }), "booth target");
        assert(!grantReaches(festival, grant, { kind: "team", teamId: GATE_CREW }), "gate team is outside");
        assert(!grantReaches(festival, grant, { kind: "site", siteId: GATE }), "gate site is outside");
    }),
    modelCase("OH-MODEL-04", "nothing reaches a whole operation", () => {
        for (const fixture of [PROFESSIONAL_OPERATION, FESTIVAL]) {
            for (const grant of fixture.snapshot.grants) {
                assert(!grantReaches(fixture.snapshot, grant, { kind: "operation" }), `${fixture.name}: ${grant.grantId}`);
            }
        }
    }),
    modelCase("OH-MODEL-05", "allow: the worn role carries the action and the grant reaches the target", () => {
        const decision = decide(professional, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, DANA_OKAFOR, MERIDIAN, "review", { kind: "team", teamId: HARBOR_TEAM });
        assert(decision.allowed, "expected allow");
        equal(decision.hat?.role, "coordinator", "worn role");
    }),
    modelCase("OH-MODEL-06", "deny/action-not-carried: the worn role does not carry the action", () => {
        const decision = decide(professional, PROFESSIONAL_OPERATION.policy, NORTH_ORG, PRIYA, MERIDIAN, "configure", { kind: "team", teamId: NORTH_TEAM });
        assert(!decision.allowed, "expected deny");
        equal(decision.reason, "action-not-carried", "denial reason");
    }),
    modelCase("OH-MODEL-07", "deny/out-of-reach: no grant reaches the target", () => {
        const decision = decide(professional, PROFESSIONAL_OPERATION.policy, NORTH_ORG, PRIYA, MERIDIAN, "review", { kind: "team", teamId: HARBOR_TEAM });
        assert(!decision.allowed, "expected deny");
        equal(decision.reason, "out-of-reach", "denial reason");
    }),
    modelCase("OH-MODEL-08", "deny/not-admitted: unknown, disabled, or non-participating actors", () => {
        const unknown = decide(professional, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, NOBODY, MERIDIAN, "observe", { kind: "team", teamId: HARBOR_TEAM });
        assert(!unknown.allowed && unknown.reason === "not-admitted", "unknown actor");
        const disabledSnapshot = {
            ...professional,
            actors: professional.actors.map((actor) => actor.actorId === SAM ? { ...actor, disabled: true } : actor),
        };
        const disabled = decide(disabledSnapshot, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, SAM, MERIDIAN, "observe", { kind: "team", teamId: HARBOR_TEAM });
        assert(!disabled.allowed && disabled.reason === "not-admitted", "disabled actor");
        const nonParticipating = {
            ...professional,
            participations: professional.participations.filter((participation) => participation.organizationId !== NORTH_ORG),
        };
        const noParticipation = decide(nonParticipating, PROFESSIONAL_OPERATION.policy, NORTH_ORG, PRIYA, MERIDIAN, "review", { kind: "team", teamId: NORTH_TEAM });
        assert(!noParticipation.allowed && noParticipation.reason === "not-admitted", "non-participating organization");
    }),
    modelCase("OH-MODEL-09", "fallback: a primary that does not reach the target stands aside", () => {
        const snapshot = {
            ...professional,
            grants: [
                ...professional.grants,
                {
                    grantId: "g-conformance-fallback",
                    operationId: MERIDIAN,
                    organizationId: NORTH_ORG,
                    actorId: PRIYA,
                    role: "admin",
                    target: { kind: "team", teamId: NORTH_FLOOR },
                },
            ],
        };
        const decision = decide(snapshot, PROFESSIONAL_OPERATION.policy, NORTH_ORG, PRIYA, MERIDIAN, "configure", { kind: "team", teamId: NORTH_FLOOR });
        assert(decision.allowed, "expected fallback allow");
        equal(decision.hat?.grantId, "g-conformance-fallback", "fallback grant");
    }),
    modelCase("OH-MODEL-10", "read reach: granted-teams follows the actor's reached teams", () => {
        const reach = readReach(professional, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, DANA_OKAFOR, MERIDIAN);
        deepEqual(reach.readableOrganizationIds, [HARBOR_LOGISTICS], "readable organizations");
        deepEqual(reach.readableTeamIds, [], "exceptional teams");
    }),
    modelCase("OH-MODEL-11", "read reach: all-participating spans the operation", () => {
        const reach = readReach(festival, FESTIVAL.policy, HARBOR_LOGISTICS, DANA_OKAFOR, FESTIVAL_OP);
        deepEqual([...reach.readableOrganizationIds].sort(), [PARK_ORG, HARBOR_LOGISTICS, CIDERS_ORG].sort(), "readable organizations");
        deepEqual(reach.readableTeamIds, [], "exceptional teams");
    }),
    modelCase("OH-MODEL-12", "read reach: a site grant reads every organization with a team at the site", () => {
        const reach = readReach(professional, PROFESSIONAL_OPERATION.policy, ATLAS_ORG, LEN, MERIDIAN);
        deepEqual([...reach.readableOrganizationIds].sort(), [HARBOR_LOGISTICS, ATLAS_ORG].sort(), "readable organizations");
    }),
];
