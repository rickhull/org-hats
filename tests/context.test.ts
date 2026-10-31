// The context's selected-hat resolution. A defect report (Quartermaster,
// 2026-10-30 19:39) showed the context matching the worn hat by role: with
// two grants of one role, the first in wearable order won regardless of the
// hat the person selected. The resolution is the issuance ranking
// (`firstByRank`: primary, then role, target, grant id) — the same rule
// every default-hat chooser reads — so the context agrees with the signed
// envelope by construction. The envelope cannot name the worn grant, and
// this test pins the next-best honest resolution.

import test from "node:test";
import assert from "node:assert/strict";

import { AUTHORITY_INTERFACE_VERSION, isFailed } from "../src/contract.ts";
import { createInMemoryAuthority } from "../src/authority/engine.ts";
import { defineWorld, type WorldDefinition } from "../src/authority/world.ts";

const twoHatsWorld = (): WorldDefinition => ({
  name: "two-hats",
  policy: {
    format: 1,
    id: "policy-two-hats",
    version: "1",
    actions: ["inspect"],
    roles: [{ title: "hand", actions: ["inspect"] }],
    readPolicy: { organizations: "granted-teams" },
  },
  snapshot: {
    operations: [{ operationId: "op-two", displayName: "Two Hats", slug: "two-hats" }],
    organizations: [{ organizationId: "org-two", displayName: "Two Works" }],
    actors: [{ organizationId: "org-two", actorId: "actor-two", displayName: "Two Hands" }],
    sites: [{ siteId: "site-two", operationId: "op-two", displayName: "Yard", path: "yard", aliases: ["yard"] }],
    teams: [
      { teamId: "team-first", siteId: "site-two", organizationId: "org-two", displayName: "First Crew" },
      { teamId: "team-second", siteId: "site-two", organizationId: "org-two", displayName: "Second Crew" },
    ],
    grants: [
      {
        grantId: "g-first", operationId: "op-two", organizationId: "org-two",
        actorId: "actor-two", role: "hand",
        target: { kind: "team", teamId: "team-first" },
      },
      {
        grantId: "g-second", operationId: "op-two", organizationId: "org-two",
        actorId: "actor-two", role: "hand",
        target: { kind: "team", teamId: "team-second" },
      },
    ],
    participations: [{ organizationId: "org-two", operationId: "op-two", status: "active" }],
  },
});

const setup = async () => {
  const engine = await createInMemoryAuthority({
    fixtures: [defineWorld(twoHatsWorld())],
    principalLinks: [
      { provider: "idp", subject: "two", organizationId: "org-two" as never, actorId: "actor-two" as never },
    ],
  });
  const evidence = { provider: "idp", subject: "two" };
  const issue = async () => {
    const issued = await engine.runtime.accessFromEvidence({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: "op-two",
      evidence,
    });
    if (isFailed(issued)) throw new Error(`issuance failed: ${issued.failure.kind}`);
    return issued;
  };
  return { engine, evidence, issue };
};

test("the context names the selected hat, not the first hat of its role", async () => {
  const { engine, evidence, issue } = await setup();

  // Both hats are `hand`; the person selects the second one, which sorts
  // after the first by grant id. Issuance wears it (primary first).
  const selected = await engine.runtime.command({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    idempotencyKey: "select-second",
    authorization: { kind: "fresh-evidence", evidence, operationId: "op-two" },
    kind: "select-hat",
    operationId: "op-two",
    grantId: "g-second",
  });
  assert.ok(selected.ok, JSON.stringify(selected));

  const issued = await issue();
  assert.deepEqual(issued.envelope.claims.hat.teamIds, ["team-second"]);

  const context = await engine.runtime.context({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    envelope: issued.envelope,
  });
  if (isFailed(context)) throw new Error(`context failed: ${context.failure.kind}`);

  assert.equal(context.wearableHats.length, 2);
  assert.equal(context.selectedHat?.grantId, "g-second");
  assert.equal(context.selectedHat?.target.kind, "team");
  assert.equal(
    context.selectedHat?.target.kind === "team" ? context.selectedHat.target.teamId : undefined,
    "team-second",
  );
  assert.equal(context.selectedHat?.primary, true);
});

test("the context still names a hat when nothing was explicitly selected", async () => {
  const { engine, issue } = await setup();
  const issued = await issue();
  // No select-hat: issuance and the context both fall back to the ranking,
  // which orders by role, then target id, then grant id — the first crew.
  assert.deepEqual(issued.envelope.claims.hat.teamIds, ["team-first"]);
  const context = await engine.runtime.context({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    envelope: issued.envelope,
  });
  if (isFailed(context)) throw new Error(`context failed: ${context.failure.kind}`);
  assert.equal(context.selectedHat?.grantId, "g-first");
});
