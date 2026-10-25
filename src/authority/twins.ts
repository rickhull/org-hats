// The synthetic structural twins — public conformance data. They carry the
// structural
// properties of the reference consumer's two design tests without any of its
// names: a persistent multi-site professional operation, and a time-bounded,
// multi-venue festival burst. One organization and one of its actors
// participate in both, which is the structural shape of "the same
// organization actor, different operation-local hats". The third twin is
// public history instead — the 1948–49 Berlin Airlift, for the coalition
// shape the first two do not carry: a host-nation workforce inside a
// multi-airfield operation, secondment across organizations, and a
// coalition-wide read board under a bounded operation.
//
// A twin is a complete `Snapshot` plus the policy bundle in force, and it
// must pass `invariantProblems` unchanged — the fixtures are data, and the
// invariants judge them like any other state. Invented people and
// organizations only.

import { actorId, organizationId, type Unbranded } from "../contract.ts";
import type { Snapshot } from "../model.ts";
import type { PolicyBundle } from "../policy.ts";

export interface TwinFixture {
  readonly name: "professional" | "festival" | "airlift";
  readonly snapshot: Snapshot;
  readonly policy: PolicyBundle;
}

/** A twin written as plain data, then branded once on the way in.
 *
 * The ids here are hand-written literals whose whole purpose is to show the
 * structure — which organization has a team at which site, which actor wears
 * which hat in two operations. Wrapping each of the two hundred-odd literals
 * in a constructor would bury exactly that. So the conversion happens once,
 * at the boundary where fixture data becomes domain data, the same way each
 * runtime converts once at its command-handler seam.
 *
 * What makes this safe rather than a loophole: these fixtures are judged by
 * `invariantProblems`, which is what actually catches a team id written into
 * an organization field. `tests/twins.test.ts` asserts every twin reports no
 * problems, and the shape above is derived from `Snapshot`, so it cannot
 * drift from it. */
const twin = (fixture: {
  readonly name: TwinFixture["name"];
  readonly policy: PolicyBundle;
  readonly snapshot: Unbranded<Snapshot>;
}): TwinFixture => fixture as TwinFixture;

// --- the professional operation ------------------------------------------------
//
// Persistent, multi-site, multi-organization: crews that stay for the life
// of the operation, read reach following team-bearing grants.

const professionalPolicy: PolicyBundle = {
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
export const HARBOR_LOGISTICS = organizationId("org-4c1f9a2e");
export const DANA_OKAFOR = actorId("actor-8d3b77c1");

const OP = "op-9f2e6ad4";
const EAST = "site-e4a1c9b3";
const WEST = "site-b8d620fa";

export const PROFESSIONAL_OPERATION: TwinFixture = twin({
  name: "professional",
  policy: professionalPolicy,
  snapshot: {
    operations: [{ operationId: OP, displayName: "Meridian Field Services" }],
    organizations: [
      { organizationId: "org-2b7c41de", displayName: "Northline Electrical" },
      { organizationId: HARBOR_LOGISTICS, displayName: "Harbor Logistics" },
      { organizationId: "org-a53e90f7", displayName: "Atlas Facilities" },
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
});

// --- the festival ---------------------------------------------------------------
//
// Time-bounded, multi-venue, a short-lived team burst: one hundred fifty
// tasting booths generated deterministically, plus the standing crews at the
// gate. Read reach is festival-wide under the active policy — the twin that
// exercises `all-participating`.

const festivalPolicy: PolicyBundle = {
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
  const teams: {
    teamId: string;
    siteId: string;
    organizationId: string;
    displayName: string;
  }[] = [];
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

export const FESTIVAL: TwinFixture = twin({
  name: "festival",
  policy: festivalPolicy,
  snapshot: {
    operations: [{ operationId: FOP, displayName: "Riverbend Fest", bounded: true }],
    organizations: [
      { organizationId: "org-d94b1c6e", displayName: "Ciders Guild" },
      { organizationId: "org-08f7a2b5", displayName: "Park Stewards" },
      { organizationId: HARBOR_LOGISTICS, displayName: "Harbor Logistics" },
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
});

// --- the airlift ------------------------------------------------------------------
//
// Bounded, multi-airfield, four organizations: two wings, the contract
// carriers, and the host-nation ground handlers whose shifts work every
// Berlin airfield. Whether the three Berlin airfields are one site or three
// is the modelling judgement: they are three, because admission and reach
// are per airfield — a foreman at Tempelhof has nothing at Gatow. Read reach
// is the coalition tonnage board: every participating organization under
// `all-participating`. The exchange officer carries the crossed grant — a
// Plane Fare duty officer on a Ground Handling shift, the structural shape
// of secondment.

const airliftPolicy: PolicyBundle = {
  format: 1,
  id: "policy-vittles",
  version: "2026-10.1",
  actions: ["haul", "load", "dispatch", "service", "configure"],
  roles: [
    { title: "aircrew", actions: ["haul"] },
    { title: "loadmaster", actions: ["load"] },
    { title: "dispatcher", actions: ["dispatch"] },
    { title: "line mechanic", actions: ["service"] },
    { title: "duty officer", actions: ["dispatch", "configure"] },
  ],
  readPolicy: { organizations: "all-participating" },
};

const AOP = "op-4b8d2e67";
const RHEIN_MAIN = "site-71c9d4e2";
const FASSBERG = "site-38b6f0a9";
const TEMPELHOF = "site-c5d2a8f7";
const GATOW = "site-94a7c1e0";
const TEGEL = "site-e3f8b2c6";

export const AIRLIFT: TwinFixture = twin({
  name: "airlift",
  policy: airliftPolicy,
  snapshot: {
    operations: [{ operationId: AOP, displayName: "Berlin Airlift", bounded: true }],
    organizations: [
      { organizationId: "org-6f1a93c4", displayName: "Vittles Airlift Wing" },
      { organizationId: "org-2d7eb58a", displayName: "Plane Fare Air Group" },
      { organizationId: "org-9c4b17f3", displayName: "Rhein Contract Carriers" },
      { organizationId: "org-58e3a2d1", displayName: "Ground Handling Services Berlin" },
    ],
    actors: [
      { organizationId: "org-6f1a93c4", actorId: "actor-4f7c2a19", displayName: "Charles Whitfield" },
      { organizationId: "org-6f1a93c4", actorId: "actor-8b3d5e72", displayName: "Eleanor Voss" },
      { organizationId: "org-6f1a93c4", actorId: "actor-2c9f6b84", displayName: "Walter Merrin" },
      { organizationId: "org-6f1a93c4", actorId: "actor-5c2e8b97", displayName: "Henrik Tauber" },
      { organizationId: "org-2d7eb58a", actorId: "actor-6e8a1d43", displayName: "Arthur Pemberton" },
      { organizationId: "org-2d7eb58a", actorId: "actor-d54b9f26", displayName: "Mildred Carrow" },
      { organizationId: "org-2d7eb58a", actorId: "actor-91f3c7e8", displayName: "Duncan Reeve" },
      { organizationId: "org-9c4b17f3", actorId: "actor-73a5e2b0", displayName: "James Corrigan" },
      { organizationId: "org-58e3a2d1", actorId: "actor-b86d4f31", displayName: "Jürgen Brandt" },
      { organizationId: "org-58e3a2d1", actorId: "actor-42e9c0a7", displayName: "Ingrid Falk" },
      { organizationId: "org-58e3a2d1", actorId: "actor-f17b3d64", displayName: "Werner Holst" },
      { organizationId: "org-58e3a2d1", actorId: "actor-a93c8e50", displayName: "Clara Weiss" },
    ],
    sites: [
      { siteId: RHEIN_MAIN, operationId: AOP, displayName: "Rhein-Main Airfield", aliases: ["rhein-main"] },
      { siteId: FASSBERG, operationId: AOP, displayName: "Fassberg Station", aliases: ["fassberg"] },
      { siteId: TEMPELHOF, operationId: AOP, displayName: "Tempelhof Airfield", aliases: ["tempelhof"] },
      { siteId: GATOW, operationId: AOP, displayName: "Gatow Airfield", aliases: ["gatow"] },
      { siteId: TEGEL, operationId: AOP, displayName: "Tegel Strip", aliases: ["tegel"] },
    ],
    teams: [
      { teamId: "team-a41f8c73", siteId: RHEIN_MAIN, organizationId: "org-6f1a93c4", displayName: "Loading rack one" },
      { teamId: "team-b79e2d50", siteId: RHEIN_MAIN, organizationId: "org-6f1a93c4", displayName: "Line maintenance" },
      { teamId: "team-d62c9f14", siteId: RHEIN_MAIN, organizationId: "org-9c4b17f3", displayName: "Charter cell" },
      { teamId: "team-f83a5b61", siteId: RHEIN_MAIN, organizationId: "org-6f1a93c4", displayName: "Raisin bomber crew" },
      { teamId: "team-1e94c7a8", siteId: FASSBERG, organizationId: "org-2d7eb58a", displayName: "Fassberg dispatch" },
      { teamId: "team-3c6f0d92", siteId: FASSBERG, organizationId: "org-2d7eb58a", displayName: "Havel boat crew" },
      { teamId: "team-5a2b8e37", siteId: TEMPELHOF, organizationId: "org-58e3a2d1", displayName: "Ground shift one" },
      { teamId: "team-7f9d4c15", siteId: TEMPELHOF, organizationId: "org-58e3a2d1", displayName: "Ground shift two" },
      { teamId: "team-9b3e6a82", siteId: TEMPELHOF, organizationId: "org-6f1a93c4", displayName: "Tempelhof ops desk" },
      { teamId: "team-c84b1f69", siteId: GATOW, organizationId: "org-58e3a2d1", displayName: "Gatow handling shift" },
      { teamId: "team-e27a5c03", siteId: GATOW, organizationId: "org-2d7eb58a", displayName: "Gatow tower watch" },
      { teamId: "team-6d1f9b74", siteId: TEGEL, organizationId: "org-58e3a2d1", displayName: "Tegel strip detail" },
    ],
    grants: [
      {
        grantId: "g-lift-1", operationId: AOP, organizationId: "org-6f1a93c4",
        actorId: "actor-4f7c2a19", role: "duty officer",
        target: { kind: "site", siteId: TEMPELHOF }, primary: true,
      },
      {
        grantId: "g-lift-2", operationId: AOP, organizationId: "org-6f1a93c4",
        actorId: "actor-8b3d5e72", role: "duty officer",
        target: { kind: "site", siteId: RHEIN_MAIN }, primary: true,
      },
      {
        grantId: "g-lift-3", operationId: AOP, organizationId: "org-6f1a93c4",
        actorId: "actor-2c9f6b84", role: "aircrew",
        target: { kind: "team", teamId: "team-f83a5b61" }, primary: true,
      },
      {
        grantId: "g-lift-4", operationId: AOP, organizationId: "org-6f1a93c4",
        actorId: "actor-5c2e8b97", role: "line mechanic",
        target: { kind: "team", teamId: "team-b79e2d50" }, primary: true,
      },
      {
        grantId: "g-lift-5", operationId: AOP, organizationId: "org-2d7eb58a",
        actorId: "actor-6e8a1d43", role: "dispatcher",
        target: { kind: "team", teamId: "team-1e94c7a8" }, primary: true,
      },
      {
        grantId: "g-lift-6", operationId: AOP, organizationId: "org-2d7eb58a",
        actorId: "actor-d54b9f26", role: "dispatcher",
        target: { kind: "team", teamId: "team-e27a5c03" }, primary: true,
      },
      {
        // the exchange officer: a Plane Fare duty officer seconded onto a
        // Ground Handling shift — the crossed grant
        grantId: "g-lift-7", operationId: AOP, organizationId: "org-2d7eb58a",
        actorId: "actor-91f3c7e8", role: "duty officer",
        target: { kind: "team", teamId: "team-5a2b8e37" }, primary: true,
      },
      {
        grantId: "g-lift-8", operationId: AOP, organizationId: "org-9c4b17f3",
        actorId: "actor-73a5e2b0", role: "aircrew",
        target: { kind: "team", teamId: "team-d62c9f14" }, primary: true,
      },
      {
        grantId: "g-lift-9", operationId: AOP, organizationId: "org-58e3a2d1",
        actorId: "actor-b86d4f31", role: "loadmaster",
        target: { kind: "site", siteId: TEMPELHOF }, primary: true,
      },
      {
        grantId: "g-lift-10", operationId: AOP, organizationId: "org-58e3a2d1",
        actorId: "actor-42e9c0a7", role: "loadmaster",
        target: { kind: "team", teamId: "team-7f9d4c15" }, primary: true,
      },
      {
        grantId: "g-lift-11", operationId: AOP, organizationId: "org-58e3a2d1",
        actorId: "actor-f17b3d64", role: "loadmaster",
        target: { kind: "team", teamId: "team-c84b1f69" }, primary: true,
      },
      {
        grantId: "g-lift-12", operationId: AOP, organizationId: "org-58e3a2d1",
        actorId: "actor-a93c8e50", role: "loadmaster",
        target: { kind: "team", teamId: "team-6d1f9b74" }, primary: true,
      },
    ],
    participations: [
      { organizationId: "org-6f1a93c4", operationId: AOP, status: "active" },
      { organizationId: "org-2d7eb58a", operationId: AOP, status: "active" },
      { organizationId: "org-9c4b17f3", operationId: AOP, status: "active" },
      { organizationId: "org-58e3a2d1", operationId: AOP, status: "active" },
    ],
  },
});

export const TWINS: readonly TwinFixture[] = [PROFESSIONAL_OPERATION, FESTIVAL, AIRLIFT];
