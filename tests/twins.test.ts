// The synthetic twins carry the structural properties the conformance
// inventory exercises — multi-organization participation, site independence,
// the team burst, and one organization actor joining a second operation.

import test from "node:test";
import assert from "node:assert/strict";

import { invariantProblems } from "../src/model.ts";
import {
  AIRLIFT,
  DANA_OKAFOR,
  FESTIVAL,
  FESTIVAL_BOOTH_COUNT,
  HARBOR_LOGISTICS,
  PROFESSIONAL_OPERATION,
  TWINS,
} from "../src/authority/twins.ts";

test("the professional operation is multi-organization and multi-site", () => {
  const s = PROFESSIONAL_OPERATION.snapshot;
  assert.ok(s.organizations.length >= 3);
  assert.equal(s.sites.length, 2);
  assert.equal(s.operations[0]?.bounded, undefined);
});

test("site independence is structural: every team belongs to exactly one site", () => {
  for (const { snapshot } of TWINS) {
    const siteOf = new Map(snapshot.teams.map((t) => [t.teamId, t.siteId]));
    assert.equal(siteOf.size, snapshot.teams.length); // team ids unique
    for (const site of snapshot.sites) {
      assert.ok([...siteOf.values()].includes(site.siteId));
    }
  }
});

test("the airlift is a bounded multi-airfield coalition", () => {
  const s = AIRLIFT.snapshot;
  assert.equal(s.operations[0]?.bounded, true);
  assert.ok(s.organizations.length >= 4);
  assert.equal(s.sites.length, 5);
  // the host-nation workforce keeps teams at several airfields — one
  // organization, several sites
  const ghsSites = new Set(
    s.teams.filter((t) => t.organizationId === "org-58e3a2d1").map((t) => t.siteId),
  );
  assert.ok(ghsSites.size >= 3, "ground handling spans at least three airfields");
  // the exchange officer: a grant whose target team belongs to another
  // organization — secondment as a crossed grant
  const crossed = s.grants.filter(
    (g) =>
      g.target.kind === "team" &&
      s.teams.find((t) => t.teamId === g.target.teamId)?.organizationId !== g.organizationId,
  );
  assert.equal(crossed.length, 1);
  assert.equal(crossed[0]?.actorId, "actor-91f3c7e8");
});

test("every twin is a healthy snapshot under its own bundle", () => {
  for (const { snapshot, policy } of TWINS) {
    assert.deepEqual(invariantProblems(snapshot, policy), []);
  }
});

test("all participations are active in both twins", () => {
  for (const { snapshot } of TWINS) {
    for (const p of snapshot.participations) assert.equal(p.status, "active");
  }
});

test("the festival is bounded and materializes the booth burst deterministically", () => {
  assert.equal(FESTIVAL.snapshot.operations[0]?.bounded, true);
  const booths = FESTIVAL.snapshot.teams.filter((t) => t.teamId.startsWith("team-booth-"));
  assert.equal(booths.length, FESTIVAL_BOOTH_COUNT);
  assert.equal(booths[0]?.displayName, "Tasting booth 001");
  assert.equal(booths[booths.length - 1]?.displayName, "Tasting booth 150");
});

test("Harbor Logistics and Dana Okafor join both consumer-design operations with different hats", () => {
  for (const { snapshot } of [PROFESSIONAL_OPERATION, FESTIVAL]) {
    assert.ok(snapshot.organizations.some((o) => o.organizationId === HARBOR_LOGISTICS));
    assert.ok(snapshot.actors.some((a) => a.actorId === DANA_OKAFOR));
  }
  const meridianHat = PROFESSIONAL_OPERATION.snapshot.grants.find((g) => g.actorId === DANA_OKAFOR);
  const festivalHat = FESTIVAL.snapshot.grants.find((g) => g.actorId === DANA_OKAFOR);
  assert.equal(meridianHat?.role, "coordinator");
  assert.equal(festivalHat?.role, "admin");
});

test("the airlift twin stands alone: no organization leaks in from the consumer-design twins", () => {
  for (const organization of AIRLIFT.snapshot.organizations) {
    const known = [PROFESSIONAL_OPERATION, FESTIVAL].some((twin) =>
      twin.snapshot.organizations.some((o) => o.organizationId === organization.organizationId),
    );
    assert.equal(known, false, `${organization.displayName} is an airlift-only organization`);
  }
});

test("one primary per actor per operation holds in both twins", () => {
  for (const { snapshot } of TWINS) {
    const primaries = new Map<string, number>();
    for (const g of snapshot.grants.filter((g2) => g2.primary)) {
      const key = `${g.operationId}/${g.organizationId}/${g.actorId}`;
      primaries.set(key, (primaries.get(key) ?? 0) + 1);
    }
    for (const [key, count] of primaries) assert.equal(count, 1, key);
  }
});
