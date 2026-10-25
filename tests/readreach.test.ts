// Read reach under both policies — concrete twin cases plus generated
// snapshots proving the structural properties hold for arbitrary grant
// shapes.

import test from "node:test";
import assert from "node:assert/strict";

import { invariantProblems, readReach, type Snapshot } from "../src/model.ts";
import type { PolicyBundle } from "../src/policy.ts";
import { validatePolicyBundle } from "../src/policy.ts";
import { DANA_OKAFOR, FESTIVAL, HARBOR_LOGISTICS, PROFESSIONAL_OPERATION } from "../src/authority/twins.ts";

test("granted-teams: Dana reads Harbor, the org of her reached team", () => {
  const r = readReach(PROFESSIONAL_OPERATION.snapshot, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, DANA_OKAFOR, "op-9f2e6ad4");
  assert.deepEqual(r.readableOrganizationIds, [HARBOR_LOGISTICS]);
  assert.deepEqual(r.readableTeamIds, []);
});

test("granted-teams: a site grant reaches every team's organization at the site", () => {
  // Len's admin hat is site-scoped at West Yard, where Atlas and Harbor keep teams
  const r = readReach(PROFESSIONAL_OPERATION.snapshot, PROFESSIONAL_OPERATION.policy, "org-a53e90f7", "actor-77f2b0e5", "op-9f2e6ad4");
  assert.deepEqual([...r.readableOrganizationIds].sort(), ["org-4c1f9a2e", "org-a53e90f7"]);
});

test("all-participating: festival-wide read, no exceptional teams", () => {
  const r = readReach(FESTIVAL.snapshot, FESTIVAL.policy, HARBOR_LOGISTICS, DANA_OKAFOR, "op-61a8e3f2");
  assert.equal(r.readableOrganizationIds.length, 3);
  assert.deepEqual(r.readableTeamIds, []);
});

// --- generated snapshots --------------------------------------------------------
//
// A tiny deterministic generator (mulberry32): small worlds, every one valid
// by construction, run through readReach and the invariants.

const mulberry32 = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const bundle: PolicyBundle = {
  format: 1,
  id: "policy-generated",
  version: "1",
  actions: ["observe", "review"],
  roles: [
    { title: "field", actions: ["observe"] },
    { title: "lead", actions: ["observe", "review"] },
  ],
  readPolicy: { organizations: "granted-teams" },
};
assert.deepEqual(validatePolicyBundle(bundle), []);

test("generated snapshots: invariants clean, read reach structurally sound", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const rng = mulberry32(seed);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)] as T;

    const orgs = [1, 2, 3].map((i) => ({ organizationId: `org-${i}` }));
    const actors = orgs.flatMap((o) =>
      [1, 2].map((j) => ({ organizationId: o.organizationId, actorId: `actor-${seed}-${j}` })),
    );
    const sites = [1, 2].map((i) => ({ siteId: `site-${i}`, operationId: "op-1", aliases: [] }));
    const teams = sites.flatMap((s) =>
      orgs.slice(0, 1 + Math.floor(rng() * 3)).map((o, i) => ({
        teamId: `${s.siteId}-team-${i}`, siteId: s.siteId, organizationId: o.organizationId,
      })),
    );
    const activeOrgs = orgs.filter(() => rng() > 0.25);
    const participations = activeOrgs.map((o) => ({ organizationId: o.organizationId, operationId: "op-1", status: "active" as const }));
    const eligible = actors.filter((a) => activeOrgs.some((o) => o.organizationId === a.organizationId));
    const grants = eligible.map((a, i) => ({
      grantId: `g-${i}`, operationId: "op-1",
      organizationId: a.organizationId, actorId: a.actorId,
      role: rng() > 0.5 ? "field" : "lead",
      target: rng() > 0.5
        ? { kind: "team" as const, teamId: pick(teams).teamId }
        : { kind: "site" as const, siteId: pick(sites).siteId },
      primary: i === 0,
    }));
    const snapshot: Snapshot = {
      operations: [{ operationId: "op-1" }],
      organizations: orgs, actors, sites, teams, grants, participations,
    };

    assert.deepEqual(invariantProblems(snapshot, bundle), [], `seed ${seed}`);

    for (const actor of eligible) {
      const r = readReach(snapshot, bundle, actor.organizationId, actor.actorId, "op-1");
      // unique orgs, no duplicates
      assert.equal(new Set(r.readableOrganizationIds).size, r.readableOrganizationIds.length);
      // exceptional teams are exactly the reached teams outside the org set;
      // the strong bidirectional form is pinned by tests/generative.test.ts
      for (const teamId of r.readableTeamIds) {
        const team = teams.find((t) => t.teamId === teamId);
        assert.ok(team, `seed ${seed}: exceptional team exists`);
        assert.ok(!r.readableOrganizationIds.includes(team.organizationId));
      }
    }
  }
});
