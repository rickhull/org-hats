// The decision rule and worn-hat selection — every denial reason, the
// primary/fallback behavior, revoked and disabled handling, and the
// participation state machine.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decide,
  invariantProblems,
  isActiveGrant,
  selectWornHat,
  wearableGrants,
  applyParticipationEvent,
  transitionParticipation,
  type ActiveGrant,
  type Decision,
  type Grant,
  type Snapshot,
} from "../src/model.ts";
import type { PolicyBundle } from "../src/policy.ts";
import { DANA_OKAFOR, FESTIVAL, HARBOR_LOGISTICS, PROFESSIONAL_OPERATION } from "../src/authority/twins.ts";
import { actorId, operationId, organizationId, siteId, teamId } from "../src/contract.ts";

const MER = PROFESSIONAL_OPERATION.snapshot;
const OP = operationId("op-9f2e6ad4");
const EAST = siteId("site-e4a1c9b3");
const WEST = siteId("site-b8d620fa");
const LEN_ORG = organizationId("org-a53e90f7");
const LEN = actorId("actor-77f2b0e5");
const NOBODY = actorId("actor-nobody");
const NEW_ORG = organizationId("org-new");
const ELSEWHERE = operationId("op-elsewhere");
const reasonOf = (decision: Decision): string => {
  if (decision.allowed) throw new Error("expected a denial");
  return decision.reason;
};
const withoutSlug = <T extends { slug?: string }>(value: T): Omit<T, "slug"> => {
  const { slug: _slug, ...rest } = value;
  return rest;
};
const withoutPath = <T extends { path?: string }>(value: T): Omit<T, "path"> => {
  const { path: _path, ...rest } = value;
  return rest;
};
const meridian = (action: string, target: Parameters<typeof decide>[6]) =>
  decide(MER, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, DANA_OKAFOR, OP, action, target);

test("the twins pass invariantProblems unchanged", () => {
  assert.deepEqual(invariantProblems(PROFESSIONAL_OPERATION.snapshot, PROFESSIONAL_OPERATION.policy), []);
  assert.deepEqual(invariantProblems(FESTIVAL.snapshot, FESTIVAL.policy), []);
});

test("routing facts are complete, unique, and valid labels", () => {
  const base = PROFESSIONAL_OPERATION.snapshot;
  const operation = base.operations[0]!;
  const problems = (snapshot: Snapshot): string => invariantProblems(snapshot, PROFESSIONAL_OPERATION.policy).join("; ");

  assert.match(
    problems({ ...base, operations: [{ ...operation, slug: "www" }] }),
    /invalid slug/,
  );
  assert.match(
    problems({ ...base, sites: base.sites.map((site, index) => index === 0 ? { ...site, path: "two/segments" } : site) }),
    /invalid path/,
  );
  assert.match(
    problems({ ...base, sites: base.sites.map((site) => ({ ...site, path: "same" })) }),
    /share the path/,
  );
  assert.match(
    problems({ ...base, operations: [withoutSlug(operation)] }),
    /has site paths but no slug/,
  );
  assert.match(
    problems({ ...base, sites: base.sites.map((site, index) => index === 0 ? withoutPath(site) : site) }),
    /has a slug but a site without a path/,
  );
  assert.match(
    problems({ ...base, sites: base.sites.map((site, index) => index === 0 ? { ...site, aliases: ["www"] } : site) }),
    /invalid alias/,
  );
  assert.match(
    problems({ ...base, sites: base.sites.map((site, index) => index === 0 ? { ...site, aliases: [operation.slug!] } : site) }),
    /collides with the operation slug/,
  );
  assert.match(
    problems({ ...base, sites: base.sites.map((site) => ({ ...site, aliases: ["shared"] })) }),
    /share the alias/,
  );

  // A snapshot that predates routing facts is still healthy; half a pair is not.
  assert.equal(
    problems({
      ...base,
      operations: [withoutSlug(operation)],
      sites: base.sites.map(withoutPath),
    }),
    "",
  );
});

test("allow: the worn hat carries the action and reaches the target", () => {
  const d = meridian("resolve", { kind: "team", teamId: "team-2e8c64b9" });
  assert.ok(d.allowed);
  assert.equal(d.hat.role, "coordinator");
});

test("deny/no-capability: the role reaches but does not carry the action", () => {
  const d = meridian("configure", { kind: "team", teamId: "team-2e8c64b9" });
  assert.ok(!d.allowed);
  assert.equal(reasonOf(d), "no-capability");
});

test("deny/out-of-reach: no grant reaches the target", () => {
  const d = meridian("observe", { kind: "team", teamId: "team-c7d9e2a1" });
  assert.ok(!d.allowed);
  assert.equal(reasonOf(d), "out-of-reach");
});

test("deny/out-of-reach: nothing reaches a whole operation", () => {
  const d = meridian("observe", { kind: "operation" });
  assert.ok(!d.allowed);
  assert.equal(reasonOf(d), "out-of-reach");
});

test("deny/not-admitted: unknown actor, disabled actor, or no participation", () => {
  assert.equal(reasonOf(decide(MER, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, NOBODY, OP, "observe", { kind: "team", teamId: "team-2e8c64b9" })), "not-admitted");

  const disabled: Snapshot = {
    ...MER,
    actors: MER.actors.map((a) =>
      a.actorId === DANA_OKAFOR ? { ...a, disabled: true } : a,
    ),
  };
  assert.equal(
    reasonOf(decide(disabled, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, DANA_OKAFOR, OP, "resolve", { kind: "team", teamId: "team-2e8c64b9" })),
    "not-admitted",
  );

  const uninvited: Snapshot = {
    ...MER,
    participations: MER.participations.filter((p) => p.organizationId !== HARBOR_LOGISTICS),
  };
  assert.equal(
    reasonOf(decide(uninvited, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, DANA_OKAFOR, OP, "resolve", { kind: "team", teamId: "team-2e8c64b9" })),
    "not-admitted",
  );
});

test("a site grant reaches every team at the site, and the site itself", () => {
  // Len's admin hat is site-scoped at West Yard
  const d = decide(MER, PROFESSIONAL_OPERATION.policy, LEN_ORG, LEN, OP, "configure", { kind: "site", siteId: WEST });
  assert.ok(d.allowed);
  const atTeam = decide(MER, PROFESSIONAL_OPERATION.policy, LEN_ORG, LEN, OP, "resolve", { kind: "team", teamId: "team-9a1f73e0" });
  assert.ok(atTeam.allowed);
  const elsewhere = decide(MER, PROFESSIONAL_OPERATION.policy, LEN_ORG, LEN, OP, "resolve", { kind: "site", siteId: EAST });
  assert.ok(!elsewhere.allowed);
  assert.equal(reasonOf(elsewhere), "out-of-reach");
});

test("a revoked hat is never wearable and never blocks the fallback", () => {
  const revoked: Snapshot = {
    ...MER,
    grants: MER.grants.map((g) => (g.grantId === "g-mer-3" ? { ...g, revoked: true } : g)),
  };
  assert.equal(
    reasonOf(decide(revoked, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, DANA_OKAFOR, OP, "review", { kind: "team", teamId: "team-2e8c64b9" })),
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
        target: { kind: "team", teamId: teamId("team-2e8c64b9") },
      },
    ],
  };
  const d = decide(withFallback, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, DANA_OKAFOR, OP, "observe", { kind: "team", teamId: "team-2e8c64b9" });
  assert.ok(d.allowed);
  assert.equal(d.hat.role, "field");
  assert.equal(d.hat.grantId, "g-mer-6");
});

test("the revocation filter is the ActiveGrant refinement, checked once", () => {
  // `wearableGrants` routes every grant through `isActiveGrant`, and its
  // return type records that. The predicate is the runtime check the type
  // claims; absent, explicit false, and true are its whole vocabulary.
  const revokedGrant: Grant = { ...MER.grants[0]!, revoked: true };
  assert.ok(!isActiveGrant(revokedGrant));
  assert.ok(isActiveGrant({ ...MER.grants[0]! }));
  assert.ok(isActiveGrant({ ...MER.grants[0]!, revoked: false }));

  const revoked: Snapshot = {
    ...MER,
    grants: [
      ...MER.grants.map((g) => (g.grantId === "g-mer-3" ? { ...g, revoked: true } : g)),
      {
        grantId: "g-mer-6", operationId: OP, organizationId: HARBOR_LOGISTICS,
        actorId: DANA_OKAFOR, role: "field",
        target: { kind: "team", teamId: teamId("team-2e8c64b9") },
      },
    ],
  };
  const wearable = wearableGrants(revoked, HARBOR_LOGISTICS, DANA_OKAFOR, OP);
  // the revoked primary is gone and only the fallback survives
  assert.deepEqual(wearable.map((g) => g.grantId), ["g-mer-6"]);
  assert.ok(wearable.every(isActiveGrant));
  const survivors: readonly ActiveGrant[] = wearable;
  assert.equal(survivors.length, 1);
  // while `Snapshot.grants` keeps the revoked record for audit
  assert.ok(revoked.grants.some((g) => g.grantId === "g-mer-3" && g.revoked === true));
});

test("a primary that does not reach the target stands aside for the fallback", () => {
  // Dana primary = team at West; asking at the festival gate, the site admin
  // hat is the only wearable one there
  const F = FESTIVAL.snapshot;
  const hat = selectWornHat(F, FESTIVAL.policy, HARBOR_LOGISTICS, DANA_OKAFOR, operationId("op-61a8e3f2"), { kind: "site", siteId: "site-a9e05c41" });
  assert.equal(hat?.role, "admin");
  assert.equal(hat?.grantId, "g-fest-4");
});

test("selection is deterministic: same rank orders by role, target, then grant id", () => {
  const bundle: PolicyBundle = PROFESSIONAL_OPERATION.policy;
  const grant = (grantId: string, role: string): Grant => ({
    grantId, operationId: OP, organizationId: HARBOR_LOGISTICS,
    actorId: DANA_OKAFOR, role, target: { kind: "team", teamId: teamId("team-2e8c64b9") },
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
  const org = NEW_ORG; const op = OP;
  const invite = transitionParticipation(org, op, undefined, { kind: "invite", by: "operation" });
  assert.ok(invite.ok && invite.participation.status === "invited");
  assert.ok(!transitionParticipation(org, op, undefined, { kind: "invite", by: "organization" } as never).ok);
  const accepted = transitionParticipation(org, op, invite.ok ? invite.participation : undefined, { kind: "accept", by: "organization" });
  assert.ok(accepted.ok && accepted.participation.status === "accepted");
  // the operation cannot accept, the organization cannot activate
  assert.ok(!transitionParticipation(org, op, invite.ok ? invite.participation : undefined, { kind: "accept", by: "operation" } as never).ok);
  const active = transitionParticipation(org, op, accepted.ok ? accepted.participation : undefined, { kind: "activate", by: "operation" });
  assert.ok(active.ok && active.participation.status === "active");
  const revoked = transitionParticipation(org, op, active.ok ? active.participation : undefined, { kind: "revoke", by: "organization" });
  assert.ok(revoked.ok && revoked.participation.status === "revoked");
  assert.ok(!transitionParticipation(org, op, revoked.ok ? revoked.participation : undefined, { kind: "activate", by: "operation" }).ok);
});

test("participation: applyParticipationEvent is the only way a status moves", () => {
  const org = NEW_ORG; const op = OP;
  const invited = applyParticipationEvent([], org, op, { kind: "invite", by: "operation" });
  assert.ok(invited.ok);
  assert.deepEqual(invited.participations, [{ organizationId: org, operationId: op, status: "invited" }]);

  // an unrelated participation is carried through untouched
  const other = { organizationId: organizationId("org-other"), operationId: op, status: "active" } as const;
  const accepted = applyParticipationEvent(
    [other, ...invited.participations],
    org,
    op,
    { kind: "accept", by: "organization" },
  );
  assert.ok(accepted.ok);
  assert.equal(accepted.participation.status, "accepted");
  assert.deepEqual(accepted.participations.find((p) => p.organizationId === other.organizationId), other);

  const active = applyParticipationEvent(accepted.participations, org, op, { kind: "activate", by: "operation" });
  assert.ok(active.ok && active.participation.status === "active");
  const revoked = applyParticipationEvent(active.participations, org, op, { kind: "revoke", by: "operation" });
  assert.ok(revoked.ok && revoked.participation.status === "revoked");

  // the whole point: nothing moves a revoked participation back, and a
  // refusal returns no list, so an adapter cannot write one by accident
  for (const event of [
    { kind: "accept", by: "organization" },
    { kind: "activate", by: "operation" },
    { kind: "invite", by: "operation" },
    { kind: "revoke", by: "operation" },
  ] as const) {
    const refused = applyParticipationEvent(revoked.participations, org, op, event);
    assert.ok(!refused.ok, `${event.kind} must be refused from revoked`);
    assert.ok(!("participations" in refused));
  }

  // a participation that is not there at all is a different refusal
  const absent = applyParticipationEvent([], org, op, { kind: "revoke", by: "operation" });
  assert.ok(!absent.ok);
  assert.equal(absent.problem, "the organization is not participating");

  // the operation's participation is matched by both ids, never one
  const elsewhere = applyParticipationEvent(
    [{ organizationId: org, operationId: ELSEWHERE, status: "active" }],
    org,
    op,
    { kind: "revoke", by: "operation" },
  );
  assert.ok(!elsewhere.ok, "a participation in another operation is not this one");
});
