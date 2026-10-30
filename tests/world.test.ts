// The public fixture boundary: a host's own world is validated before a
// runtime boots it, and the synthetic twins pass the same validator.

import test from "node:test";
import assert from "node:assert/strict";

import { defineWorld, type WorldDefinition } from "../src/authority/world.ts";
import { TWINS } from "../src/authority/twins.ts";

const ownWorld = (): WorldDefinition => ({
  name: "own",
  policy: {
    format: 1,
    id: "policy-own",
    version: "1",
    actions: ["inspect"],
    roles: [{ title: "hand", actions: ["inspect"] }],
    readPolicy: { organizations: "granted-teams" },
  },
  snapshot: {
    operations: [{ operationId: "op-own", displayName: "Own Operation", slug: "own" }],
    organizations: [{ organizationId: "org-own", displayName: "Own Works" }],
    actors: [{ organizationId: "org-own", actorId: "actor-own", displayName: "Own Hand" }],
    sites: [{ siteId: "site-own", operationId: "op-own", displayName: "Yard", path: "yard", aliases: ["yard"] }],
    teams: [{ teamId: "team-own", siteId: "site-own", organizationId: "org-own", displayName: "Crew" }],
    grants: [
      {
        grantId: "g-own", operationId: "op-own", organizationId: "org-own",
        actorId: "actor-own", role: "hand",
        target: { kind: "team", teamId: "team-own" }, primary: true,
      },
    ],
    participations: [{ organizationId: "org-own", operationId: "op-own", status: "active" }],
  },
});

test("[P10] defineWorld accepts a coherent own world", () => {
  const world = defineWorld(ownWorld());
  assert.equal(world.name, "own");
  assert.equal(world.snapshot.teams.length, 1);
});

test("defineWorld refuses a snapshot whose grant names an unknown team", () => {
  const definition = ownWorld();
  const snapshot = {
    ...definition.snapshot,
    grants: [{ ...definition.snapshot.grants[0]!, target: { kind: "team" as const, teamId: "team-missing" } }],
  };
  assert.throws(
    () => defineWorld({ ...definition, snapshot }),
    /invalid world "own".*unknown team/,
  );
});

test("[P9][P10] defineWorld refuses an invalid policy bundle", () => {
  const definition = ownWorld();
  assert.throws(
    () =>
      defineWorld({
        ...definition,
        policy: {
          ...definition.policy,
          roles: [
            { title: "hand", actions: ["inspect"] },
            { title: "hand", actions: ["inspect"] },
          ],
        },
      }),
    /policy: the role title "hand" appears twice/,
  );
});

test("defineWorld refuses more than one operation in a fixture", () => {
  const definition = ownWorld();
  assert.throws(
    () =>
      defineWorld({
        ...definition,
        snapshot: {
          ...definition.snapshot,
          operations: [
            ...definition.snapshot.operations,
            { operationId: "op-second", displayName: "Second Operation" },
          ],
        },
      }),
    /a fixture carries exactly one operation, not 2/,
  );
});

test("every synthetic twin is a valid world under the public boundary", () => {
  for (const twin of TWINS) {
    const world = defineWorld({ name: twin.name, policy: twin.policy, snapshot: twin.snapshot });
    assert.equal(world.snapshot.operations.length, 1, twin.name);
  }
});
