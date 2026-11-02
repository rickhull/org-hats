// The context's selected-hat resolution. A defect report (Quartermaster,
// 2026-10-30 19:39) showed the context matching the worn hat by role: with
// two grants of one role, the first in wearable order won regardless of the
// hat the person selected. The resolution is the issuance ranking
// (`firstByRank`: primary, then role, target, grant id) — the same rule
// every default-hat chooser reads — so the context agrees with the signed
// envelope by construction. The envelope cannot name the worn grant, and
// this test pins the next-best honest resolution. The display-name
// projection answers the same day's 19:31 request: a hat target carries the
// operation's own display name when one is set, absent rather than the id
// when not, on both the wearable hats and the selected one.

import test from "node:test";
import assert from "node:assert/strict";

import { AUTHORITY_INTERFACE_VERSION, isFailed, operationId } from "../src/contract.ts";
import { defineWorld, type WorldDefinition } from "../src/authority/world.ts";
import { createTestEngine, issueAccess } from "./helpers.ts";

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
  const engine = await createTestEngine({
    fixtures: [defineWorld(twoHatsWorld())],
    principalLinks: [
      { provider: "idp", subject: "two", organizationId: "org-two" as never, actorId: "actor-two" as never },
    ],
  });
  const evidence = { provider: "idp", subject: "two" } as const;
  const issue = () => issueAccess(engine, evidence, operationId("op-two"));
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

test("[E8] the context refuses a forged envelope before it reads a hat", async () => {
  const { engine, issue } = await setup();
  const issued = await issue();
  const forged = {
    ...issued.envelope,
    signature: issued.envelope.signature.slice(0, -4) + "AAAA",
  };
  const context = await engine.runtime.context({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    envelope: forged,
  });
  assert.ok(isFailed(context));
  assert.equal(context.failure.kind, "invalid-signature");
});

test("[E4] the context refuses a malformed envelope as a value, never a throw", async () => {
  // `context` shares the envelope version gate with the verifier, so it
  // inherits the same obligation: a non-object envelope, or one whose claims
  // are absent, must be a closed failure and not an exception out of the
  // runtime call.
  const { engine } = await setup();
  for (const envelope of [null, undefined, "envelope", {}, { format: "org-hats.access", v: 1 }]) {
    const context = await engine.runtime.context({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      envelope: envelope as never,
    });
    assert.ok(isFailed(context), `${String(JSON.stringify(envelope))} must fail as a value`);
    assert.equal(context.failure.kind, "wrong-interface-version");
  }
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

const namedTargetsWorld = (): WorldDefinition => ({
  name: "named-targets",
  policy: {
    format: 1,
    id: "policy-named",
    version: "1",
    actions: ["inspect"],
    roles: [{ title: "hand", actions: ["inspect"] }],
    readPolicy: { organizations: "granted-teams" },
  },
  snapshot: {
    operations: [{ operationId: "op-named", displayName: "Named", slug: "named" }],
    organizations: [{ organizationId: "org-named" }],
    actors: [{ organizationId: "org-named", actorId: "actor-named" }],
    sites: [{ siteId: "site-north", operationId: "op-named", displayName: "North Yard", path: "north", aliases: ["north"] }],
    teams: [
      { teamId: "team-named", siteId: "site-north", organizationId: "org-named", displayName: "Harbor Field" },
      { teamId: "team-plain", siteId: "site-north", organizationId: "org-named" },
    ],
    grants: [
      {
        grantId: "g-named", operationId: "op-named", organizationId: "org-named",
        actorId: "actor-named", role: "hand", primary: true,
        target: { kind: "team", teamId: "team-named" },
      },
      {
        grantId: "g-plain", operationId: "op-named", organizationId: "org-named",
        actorId: "actor-named", role: "hand",
        target: { kind: "team", teamId: "team-plain" },
      },
      {
        grantId: "g-site", operationId: "op-named", organizationId: "org-named",
        actorId: "actor-named", role: "hand",
        target: { kind: "site", siteId: "site-north" },
      },
    ],
    participations: [{ organizationId: "org-named", operationId: "op-named", status: "active" }],
  },
});

test("wearable hats and the selected hat carry the target's display name", async () => {
  const engine = await createTestEngine({
    fixtures: [defineWorld(namedTargetsWorld())],
    principalLinks: [
      { provider: "idp", subject: "named", organizationId: "org-named" as never, actorId: "actor-named" as never },
    ],
  });
  const issued = await issueAccess(
    engine,
    { provider: "idp", subject: "named" } as const,
    operationId("op-named"),
  );

  const context = await engine.runtime.context({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    envelope: issued.envelope,
  });
  if (isFailed(context)) throw new Error(`context failed: ${context.failure.kind}`);

  const byGrant = new Map(context.wearableHats.map((hat) => [hat.grantId, hat]));
  assert.equal(byGrant.get("g-named")?.targetDisplayName, "Harbor Field");
  assert.equal(byGrant.get("g-site")?.targetDisplayName, "North Yard");
  // Absent when the operation set no name — never the id, so a host
  // decides what to show.
  assert.ok(!("targetDisplayName" in (byGrant.get("g-plain") ?? {})));
  assert.equal(context.selectedHat?.grantId, "g-named");
  assert.equal(context.selectedHat?.targetDisplayName, "Harbor Field");
});
