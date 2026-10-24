// The decision rule and worn-hat selection — every denial reason, the
// primary/fallback behavior, revoked and disabled handling, and the
// participation state machine.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decide,
  invariantProblems,
  selectWornHat,
  transitionParticipation,
  type Grant,
  type Snapshot,
} from "../src/model.ts";
import type { PolicyBundle } from "../src/policy.ts";
import { DANA_OKAFOR, FESTIVAL, HARBOR_LOGISTICS, PROFESSIONAL_OPERATION } from "../src/authority/twins.ts";

const MER = PROFESSIONAL_OPERATION.snapshot;
const OP = "op-9f2e6ad4";
const EAST = "site-e4a1c9b3";
const WEST = "site-b8d620fa";
const meridian = (action: string, target: Parameters<typeof decide>[6]) =>
  decide(MER, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, DANA_OKAFOR, OP, action, target);

test("the twins pass invariantProblems unchanged", () => {
  assert.deepEqual(invariantProblems(PROFESSIONAL_OPERATION.snapshot, PROFESSIONAL_OPERATION.policy), []);
  assert.deepEqual(invariantProblems(FESTIVAL.snapshot, FESTIVAL.policy), []);
});

test("allow: the worn hat carries the action and reaches the target", () => {
  const d = meridian("resolve", { kind: "team", teamId: "team-2e8c64b9" });
  assert.ok(d.allowed);
  assert.equal(d.hat.role, "coordinator");
});

test("deny/no-capability: the role reaches but does not carry the action", () => {
  const d = meridian("configure", { kind: "team", teamId: "team-2e8c64b9" });
  assert.ok(!d.allowed);
  assert.equal(d.reason, "no-capability");
});

test("deny/out-of-reach: no grant reaches the target", () => {
  const d = meridian("observe", { kind: "team", teamId: "team-c7d9e2a1" });
  assert.ok(!d.allowed);
  assert.equal(d.reason, "out-of-reach");
});

test("deny/out-of-reach: nothing reaches a whole operation", () => {
  const d = meridian("observe", { kind: "operation" });
  assert.ok(!d.allowed);
  assert.equal(d.reason, "out-of-reach");
});

test("deny/not-admitted: unknown actor, disabled actor, or no participation", () => {
  assert.equal(decide(MER, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, "actor-nobody", OP, "observe", { kind: "team", teamId: "team-2e8c64b9" }).reason, "not-admitted");

  const disabled: Snapshot = {
    ...MER,
    actors: MER.actors.map((a) =>
      a.actorId === DANA_OKAFOR ? { ...a, disabled: true } : a,
    ),
  };
  assert.equal(
    decide(disabled, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, DANA_OKAFOR, OP, "resolve", { kind: "team", teamId: "team-2e8c64b9" }).reason,
    "not-admitted",
  );

  const uninvited: Snapshot = {
    ...MER,
    participations: MER.participations.filter((p) => p.organizationId !== HARBOR_LOGISTICS),
  };
  assert.equal(
    decide(uninvited, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, DANA_OKAFOR, OP, "resolve", { kind: "team", teamId: "team-2e8c64b9" }).reason,
    "not-admitted",
  );
});

test("a site grant reaches every team at the site, and the site itself", () => {
  // Len's admin hat is site-scoped at West Yard
  const d = decide(MER, PROFESSIONAL_OPERATION.policy, "org-a53e90f7", "actor-77f2b0e5", OP, "configure", { kind: "site", siteId: WEST });
  assert.ok(d.allowed);
  const atTeam = decide(MER, PROFESSIONAL_OPERATION.policy, "org-a53e90f7", "actor-77f2b0e5", OP, "resolve", { kind: "team", teamId: "team-9a1f73e0" });
  assert.ok(atTeam.allowed);
  const elsewhere = decide(MER, PROFESSIONAL_OPERATION.policy, "org-a53e90f7", "actor-77f2b0e5", OP, "resolve", { kind: "site", siteId: EAST });
  assert.ok(!elsewhere.allowed);
  assert.equal(elsewhere.reason, "out-of-reach");
});

test("a revoked hat is never wearable and never blocks the fallback", () => {
  const revoked: Snapshot = {
    ...MER,
    grants: MER.grants.map((g) => (g.grantId === "g-mer-3" ? { ...g, revoked: true } : g)),
  };
  assert.equal(
    decide(revoked, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, DANA_OKAFOR, OP, "review", { kind: "team", teamId: "team-2e8c64b9" }).reason,
    "not-admitted",
  );

  // Dana's revoked coordinator hat is primary; a second, non-primary field
  // hat at the same team takes over deterministically
  const withFallback: Snapshot = {
    ...revoked,
    grants: [
      ...revoked.grants,
      {
        grantId: "g-mer-6", operationId: OP, organizationId: HARBOR_LOGISTICS,
        actorId: DANA_OKAFOR, role: "field",
        target: { kind: "team", teamId: "team-2e8c64b9" },
      },
    ],
  };
  const d = decide(withFallback, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, DANA_OKAFOR, OP, "observe", { kind: "team", teamId: "team-2e8c64b9" });
  assert.ok(d.allowed);
  assert.equal(d.hat.role, "field");
  assert.equal(d.hat.grantId, "g-mer-6");
});

test("a primary that does not reach the target stands aside for the fallback", () => {
  // Dana primary = team at West; asking at the festival gate, the site admin
  // hat is the only wearable one there
  const F = FESTIVAL.snapshot;
  const hat = selectWornHat(F, FESTIVAL.policy, HARBOR_LOGISTICS, DANA_OKAFOR, "op-61a8e3f2", { kind: "site", siteId: "site-a9e05c41" });
  assert.equal(hat?.role, "admin");
  assert.equal(hat?.grantId, "g-fest-4");
});

test("selection is deterministic: same rank orders by role, target, then grant id", () => {
  const bundle: PolicyBundle = PROFESSIONAL_OPERATION.policy;
  const grant = (grantId: string, role: string): Grant => ({
    grantId, operationId: OP, organizationId: HARBOR_LOGISTICS,
    actorId: DANA_OKAFOR, role, target: { kind: "team", teamId: "team-2e8c64b9" },
  });
  const snapshot: Snapshot = {
    ...MER,
    grants: [
      grant("g-z", "field"),
      grant("g-a", "field"),
      { ...grant("g-b", "reviewer"), revoked: true },
    ],
  };
  const hat = selectWornHat(snapshot, bundle, HARBOR_LOGISTICS, DANA_OKAFOR, OP, { kind: "team", teamId: "team-2e8c64b9" });
  assert.equal(hat?.grantId, "g-a");
});

test("participation: invite → accept → activate is canonical; revoke is terminal", () => {
  const org = "org-new"; const op = OP;
  const invite = transitionParticipation(org, op, undefined, { kind: "invite", by: "operation" });
  assert.ok(invite.ok && invite.participation.status === "invited");
  assert.ok(!transitionParticipation(org, op, undefined, { kind: "invite", by: "organization" }).ok);
  const accepted = transitionParticipation(org, op, invite.ok ? invite.participation : undefined, { kind: "accept", by: "organization" });
  assert.ok(accepted.ok && accepted.participation.status === "accepted");
  // the operation cannot accept, the organization cannot activate
  assert.ok(!transitionParticipation(org, op, invite.ok ? invite.participation : undefined, { kind: "accept", by: "operation" }).ok);
  const active = transitionParticipation(org, op, accepted.ok ? accepted.participation : undefined, { kind: "activate", by: "operation" });
  assert.ok(active.ok && active.participation.status === "active");
  const revoked = transitionParticipation(org, op, active.ok ? active.participation : undefined, { kind: "revoke", by: "organization" });
  assert.ok(revoked.ok && revoked.participation.status === "revoked");
  assert.ok(!transitionParticipation(org, op, revoked.ok ? revoked.participation : undefined, { kind: "activate", by: "operation" }).ok);
});
