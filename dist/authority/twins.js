// The synthetic structural twins — public conformance data. They carry the
// structural
// properties of the reference consumer's two design tests without any of its
// names: a persistent multi-site professional operation, and a time-bounded,
// multi-venue festival burst. One organization and one of its actors
// participate in both, which is the structural shape of "the same
// organization actor, different operation-local hats".
//
// A twin is a complete `Snapshot` plus the policy bundle in force, and it
// must pass `invariantProblems` unchanged — the fixtures are data, and the
// invariants judge them like any other state. Invented people and
// organizations only.
// --- the professional operation ------------------------------------------------
//
// Persistent, multi-site, multi-organization: crews that stay for the life
// of the operation, read reach following team-bearing grants.
const professionalPolicy = {
    format: 1,
    id: "policy-meridian",
    version: "2026-10.1",
    actions: ["observe", "review", "resolve", "configure"],
    roles: [
        { title: "field", actions: ["observe"] },
        { title: "reviewer", actions: ["observe", "review", "resolve"] },
        { title: "coordinator", actions: ["review", "resolve"] },
        { title: "admin", actions: ["observe", "review", "resolve", "configure"] },
    ],
    readPolicy: { organizations: "granted-teams" },
};
/** The organization that also joins the festival, and the actor who works
 * both — the cross-operation pair the conformance scenarios exercise. */
export const HARBOR_LOGISTICS = "org-4c1f9a2e";
export const DANA_OKAFOR = "actor-8d3b77c1";
const OP = "op-9f2e6ad4";
const EAST = "site-e4a1c9b3";
const WEST = "site-b8d620fa";
export const PROFESSIONAL_OPERATION = {
    name: "professional",
    policy: professionalPolicy,
    snapshot: {
        operations: [{ operationId: OP, displayName: "Meridian Field Services" }],
        organizations: [
            { id: "org-2b7c41de", displayName: "Northline Electrical" },
            { id: HARBOR_LOGISTICS, displayName: "Harbor Logistics" },
            { id: "org-a53e90f7", displayName: "Atlas Facilities" },
        ],
        actors: [
            { organizationId: "org-2b7c41de", actorId: "actor-11c2f8ab", displayName: "Priya Nandi" },
            { organizationId: "org-2b7c41de", actorId: "actor-6e0d94b2", displayName: "Marco Reyes" },
            { organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR, displayName: "Dana Okafor" },
            { organizationId: HARBOR_LOGISTICS, actorId: "actor-3a91c4d8", displayName: "Sam Whitfield" },
            { organizationId: "org-a53e90f7", actorId: "actor-77f2b0e5", displayName: "Len Chu" },
        ],
        sites: [
            { siteId: EAST, operationId: OP, displayName: "East Hall", aliases: ["east"] },
            { siteId: WEST, operationId: OP, displayName: "West Yard", aliases: ["west"] },
        ],
        teams: [
            { teamId: "team-c7d9e2a1", siteId: EAST, organizationId: "org-2b7c41de", displayName: "Hall build crew" },
            { teamId: "team-f5b3a08d", siteId: EAST, organizationId: "org-2b7c41de", displayName: "Floor operations" },
            { teamId: "team-2e8c64b9", siteId: WEST, organizationId: HARBOR_LOGISTICS, displayName: "Yard crew" },
            { teamId: "team-9a1f73e0", siteId: WEST, organizationId: "org-a53e90f7", displayName: "Facilities desk" },
        ],
        grants: [
            {
                grantId: "g-mer-1", operationId: OP, organizationId: "org-2b7c41de",
                actorId: "actor-11c2f8ab", role: "reviewer",
                target: { kind: "team", teamId: "team-c7d9e2a1" }, primary: true,
            },
            {
                grantId: "g-mer-2", operationId: OP, organizationId: "org-2b7c41de",
                actorId: "actor-6e0d94b2", role: "field",
                target: { kind: "team", teamId: "team-f5b3a08d" }, primary: true,
            },
            {
                grantId: "g-mer-3", operationId: OP, organizationId: HARBOR_LOGISTICS,
                actorId: DANA_OKAFOR, role: "coordinator",
                target: { kind: "team", teamId: "team-2e8c64b9" }, primary: true,
            },
            {
                grantId: "g-mer-4", operationId: OP, organizationId: HARBOR_LOGISTICS,
                actorId: "actor-3a91c4d8", role: "field",
                target: { kind: "team", teamId: "team-2e8c64b9" }, primary: true,
            },
            {
                grantId: "g-mer-5", operationId: OP, organizationId: "org-a53e90f7",
                actorId: "actor-77f2b0e5", role: "admin",
                target: { kind: "site", siteId: WEST }, primary: true,
            },
        ],
        participations: [
            { organizationId: "org-2b7c41de", operationId: OP, status: "active" },
            { organizationId: HARBOR_LOGISTICS, operationId: OP, status: "active" },
            { organizationId: "org-a53e90f7", operationId: OP, status: "active" },
        ],
    },
};
// --- the festival ---------------------------------------------------------------
//
// Time-bounded, multi-venue, a short-lived team burst: one hundred fifty
// tasting booths generated deterministically, plus the standing crews at the
// gate. Read reach is festival-wide under the active policy — the twin that
// exercises `all-participating`.
const festivalPolicy = {
    format: 1,
    id: "policy-riverbend",
    version: "2026-10.1",
    actions: ["observe", "flag", "resolve", "configure"],
    roles: [
        { title: "booth", actions: ["observe", "flag"] },
        { title: "steward", actions: ["flag", "resolve"] },
        { title: "lead", actions: ["observe", "flag", "resolve"] },
        { title: "admin", actions: ["observe", "flag", "resolve", "configure"] },
    ],
    readPolicy: { organizations: "all-participating" },
};
export const FESTIVAL_BOOTH_COUNT = 150;
const FOP = "op-61a8e3f2";
const ROW = "site-5c2f87ad";
const GATE = "site-a9e05c41";
/** Booth teams are data built deterministically — `booth-001` through
 * `booth-150` — so a fixture load always materializes the same burst. */
const boothTeams = () => {
    const teams = [];
    for (let i = 1; i <= FESTIVAL_BOOTH_COUNT; i++) {
        const n = String(i).padStart(3, "0");
        teams.push({
            teamId: `team-booth-${n}`,
            siteId: ROW,
            organizationId: "org-d94b1c6e",
            displayName: `Tasting booth ${n}`,
        });
    }
    return teams;
};
export const FESTIVAL = {
    name: "festival",
    policy: festivalPolicy,
    snapshot: {
        operations: [{ operationId: FOP, displayName: "Riverbend Fest", bounded: true }],
        organizations: [
            { id: "org-d94b1c6e", displayName: "Ciders Guild" },
            { id: "org-08f7a2b5", displayName: "Park Stewards" },
            { id: HARBOR_LOGISTICS, displayName: "Harbor Logistics" },
        ],
        actors: [
            { organizationId: "org-d94b1c6e", actorId: "actor-40e9d1a7", displayName: "Iris Bell" },
            { organizationId: "org-d94b1c6e", actorId: "actor-92c4f6b0", displayName: "Theo Marsh" },
            { organizationId: "org-08f7a2b5", actorId: "actor-b17d39e8", displayName: "Rosa Quill" },
            { organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR, displayName: "Dana Okafor" },
        ],
        sites: [
            { siteId: ROW, operationId: FOP, displayName: "Tasting Row", aliases: ["tasting", "row"] },
            { siteId: GATE, operationId: FOP, displayName: "Park Gate", aliases: ["gate"] },
        ],
        teams: [
            { teamId: "team-3f8b52d6", siteId: GATE, organizationId: "org-08f7a2b5", displayName: "Gate crew" },
            { teamId: "team-7c2e91a4", siteId: GATE, organizationId: "org-08f7a2b5", displayName: "Safety" },
            ...boothTeams(),
        ],
        grants: [
            {
                grantId: "g-fest-1", operationId: FOP, organizationId: "org-d94b1c6e",
                actorId: "actor-40e9d1a7", role: "lead",
                target: { kind: "site", siteId: ROW }, primary: true,
            },
            {
                grantId: "g-fest-2", operationId: FOP, organizationId: "org-d94b1c6e",
                actorId: "actor-92c4f6b0", role: "booth",
                target: { kind: "team", teamId: "team-booth-001" }, primary: true,
            },
            {
                grantId: "g-fest-3", operationId: FOP, organizationId: "org-08f7a2b5",
                actorId: "actor-b17d39e8", role: "steward",
                target: { kind: "team", teamId: "team-3f8b52d6" }, primary: true,
            },
            {
                grantId: "g-fest-4", operationId: FOP, organizationId: HARBOR_LOGISTICS,
                actorId: DANA_OKAFOR, role: "admin",
                target: { kind: "site", siteId: GATE }, primary: true,
            },
        ],
        participations: [
            { organizationId: "org-d94b1c6e", operationId: FOP, status: "active" },
            { organizationId: "org-08f7a2b5", operationId: FOP, status: "active" },
            { organizationId: HARBOR_LOGISTICS, operationId: FOP, status: "active" },
        ],
    },
};
export const TWINS = [PROFESSIONAL_OPERATION, FESTIVAL];
