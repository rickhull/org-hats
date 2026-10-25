// Invariant and generative coverage. The
// generator builds valid-by-construction states and checks the model's
// claims over them; the workflow cases replay commands and outbox deliveries
// to prove idempotency and partial-failure convergence. No network, no
// accounts, no clock dependence beyond the engine's fixed default.

import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTHORITY_INTERFACE_VERSION,
  createInMemoryAuthority,
  type AuthorityCommand,
  type SignedAccessEnvelope,
} from "../src/authority/index.ts";
import {
  decide,
  grantReaches,
  invariantProblems,
  readReach,
  selectWornHat,
  wearableGrants,
  type Grant,
  type Snapshot,
  type TargetRef,
} from "../src/model.ts";
import type { PolicyBundle } from "../src/policy.ts";
import { validatePolicyBundle } from "../src/policy.ts";
import {
  CONFORMANCE_PRINCIPALS,
  CONFORMANCE_WORLD,
} from "../src/conformance.ts";
import { mulberry32, pick } from "./helpers.ts";

const OP = "op-9f2e6ad4";

// --- the generator ----------------------------------------------------------------
// The PRNG and pick come from tests/helpers.ts.

const bundleFor = (seed: number): PolicyBundle => ({
  format: 1,
  id: `policy-generated-${seed}`,
  version: "1",
  actions: ["observe", "review", "configure"],
  roles: [
    { title: "field", actions: ["observe"] },
    { title: "lead", actions: ["observe", "review"] },
    { title: "admin", actions: ["observe", "review", "configure"] },
  ],
  readPolicy: {
    organizations: seed % 2 === 0 ? "granted-teams" : "all-participating",
  },
});

const snapshotFor = (seed: number): Snapshot => {
  const rng = mulberry32(seed);
  const operationId = `op-generated-${seed}`;
  const organizations = Array.from({ length: 2 + Math.floor(rng() * 3) }, (_, i) => ({
    organizationId: `org-${seed}-${i}`,
  }));
  const sites = Array.from({ length: 1 + Math.floor(rng() * 3) }, (_, i) => ({
    siteId: `site-${seed}-${i}`,
    operationId,
    aliases: [`s${i}`],
  }));
  const teams = sites.flatMap((site) => {
    const count = Math.floor(rng() * 3);
    return Array.from({ length: count }, (_, i) => ({
      teamId: `team-${seed}-${site.siteId}-${i}`,
      siteId: site.siteId,
      organizationId: pick(rng, organizations).organizationId,
      displayName: `Team ${i}`,
    }));
  });
  const actors = organizations.flatMap((organization) =>
    Array.from({ length: 1 + Math.floor(rng() * 3) }, (_, i) => ({
      organizationId: organization.organizationId,
      actorId: `actor-${seed}-${organization.organizationId}-${i}`,
      ...(rng() < 0.15 ? { disabled: true } : {}),
    })),
  );
  const statuses = ["active", "active", "active", "invited", "accepted", "revoked"] as const;
  const participations = organizations.map((organization) => ({
    organizationId: organization.organizationId,
    operationId,
    status: pick(rng, statuses),
  }));
  const activeOrganizations = new Set(
    participations.filter((participation) => participation.status === "active").map((participation) => participation.organizationId),
  );
  const eligible = actors.filter(
    (actor) => activeOrganizations.has(actor.organizationId) && actor.disabled !== true,
  );
  const grants: Grant[] = [];
  const primaries = new Set<string>();
  for (const actor of eligible) {
    const count = Math.floor(rng() * 4);
    for (let i = 0; i < count; i++) {
      const target: Grant["target"] =
        teams.length > 0 && rng() < 0.6
          ? { kind: "team", teamId: pick(rng, teams).teamId }
          : { kind: "site", siteId: pick(rng, sites).siteId };
      const key = `${organizationKey(actor.organizationId, actor.actorId)}`;
      const primary = !primaries.has(key) && rng() < 0.5;
      if (primary) primaries.add(key);
      grants.push({
        grantId: `g-${seed}-${grants.length}`,
        operationId,
        organizationId: actor.organizationId,
        actorId: actor.actorId,
        role: pick(rng, ["field", "lead", "admin"]),
        target,
        ...(primary ? { primary: true } : {}),
        ...(rng() < 0.15 ? { revoked: true } : {}),
      });
    }
  }
  return {
    operations: [{ operationId }],
    organizations,
    actors,
    sites,
    teams,
    grants,
    participations,
  };
};

const organizationKey = (organizationId: string, actorId: string): string => `${organizationId}/${actorId}`;

const targetsOf = (snapshot: Snapshot): readonly TargetRef[] => [
  { kind: "operation" },
  ...snapshot.sites.map((site) => ({ kind: "site" as const, siteId: site.siteId })),
  ...snapshot.teams.map((team) => ({ kind: "team" as const, teamId: team.teamId })),
];

test("generated states: invariants hold and every decision is internally consistent", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const snapshot = snapshotFor(seed);
    const bundle = bundleFor(seed);
    assert.deepEqual(validatePolicyBundle(bundle), [], `seed ${seed}: bundle`);
    assert.deepEqual(invariantProblems(snapshot, bundle), [], `seed ${seed}: invariants`);

    const operation = snapshot.operations[0];
    assert.ok(operation !== undefined);
    for (const actor of snapshot.actors) {
      for (const target of targetsOf(snapshot)) {
        for (const action of bundle.actions) {
          const decision = decide(
            snapshot,
            bundle,
            actor.organizationId,
            actor.actorId,
            operation.operationId,
            action,
            target,
          );
          const again = decide(
            snapshot,
            bundle,
            actor.organizationId,
            actor.actorId,
            operation.operationId,
            action,
            target,
          );
          assert.deepEqual(again, decision, `seed ${seed}: determinism`);
          if (decision.allowed) {
            assert.ok(decision.hat !== undefined, `seed ${seed}: allowed carries a hat`);
            assert.ok(decision.hat.actions.includes(action), `seed ${seed}: hat carries the action`);
            const grant = snapshot.grants.find((candidate) => candidate.grantId === decision.hat?.grantId);
            assert.ok(grant !== undefined, `seed ${seed}: hat names a grant`);
            assert.ok(grant.revoked !== true, `seed ${seed}: a revoked grant is never worn`);
            assert.ok(grantReaches(snapshot, grant, target), `seed ${seed}: hat reaches the target`);
          } else {
            assert.ok(
              ["not-admitted", "no-capability", "out-of-reach"].includes(decision.reason),
              `seed ${seed}: closed denial vocabulary`,
            );
          }
        }
      }
    }
  }
});

test("generated states: read reach matches the policy axis and the reached teams", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const snapshot = snapshotFor(seed);
    const bundle = bundleFor(seed);
    const operation = snapshot.operations[0];
    assert.ok(operation !== undefined);

    for (const actor of snapshot.actors) {
      const reach = readReach(
        snapshot,
        bundle,
        actor.organizationId,
        actor.actorId,
        operation.operationId,
      );
      assert.equal(
        new Set(reach.readableOrganizationIds).size,
        reach.readableOrganizationIds.length,
        `seed ${seed}: no duplicate readable organizations`,
      );

      const reached = new Set<string>();
      for (const grant of wearableGrants(snapshot, actor.organizationId, actor.actorId, operation.operationId)) {
        if (grant.target.kind === "team") reached.add(grant.target.teamId);
        else {
          for (const team of snapshot.teams) {
            if (team.siteId === grant.target.siteId) reached.add(team.teamId);
          }
        }
      }
      const expectedOrganizations = bundle.readPolicy.organizations === "all-participating"
        ? [...new Set(
            snapshot.participations
              .filter((participation) => participation.status === "active")
              .map((participation) => participation.organizationId),
          )].sort()
        : [...new Set(
            [...reached]
              .map((teamId) => snapshot.teams.find((team) => team.teamId === teamId)?.organizationId)
              .filter((organizationId): organizationId is string => organizationId !== undefined),
          )].sort();
      assert.deepEqual([...reach.readableOrganizationIds].sort(), expectedOrganizations, `seed ${seed}: organization axis`);

      // exceptional teams are exactly the reached teams whose organization is
      // outside the readable set — this can be non-empty under either policy
      const expectedExceptions = [...reached].filter((teamId) => {
        const organizationId = snapshot.teams.find((team) => team.teamId === teamId)?.organizationId;
        return organizationId !== undefined && !expectedOrganizations.includes(organizationId);
      }).sort();
      assert.deepEqual([...reach.readableTeamIds].sort(), expectedExceptions, `seed ${seed}: exceptional teams`);

      for (const target of targetsOf(snapshot).filter((candidate) => candidate.kind !== "operation")) {
        const selected = selectWornHat(
          snapshot,
          bundle,
          actor.organizationId,
          actor.actorId,
          operation.operationId,
          target,
        );
        if (selected === undefined) continue;
        const grant = snapshot.grants.find((candidate) => candidate.grantId === selected.grantId);
        assert.ok(grant !== undefined, `seed ${seed}: selected grant exists`);
        assert.ok(grant.revoked !== true, `seed ${seed}: selected grant is wearable`);
        assert.ok(grantReaches(snapshot, grant, target), `seed ${seed}: selected grant reaches`);
      }
    }
  }
});

// --- workflow resilience ------------------------------------------------------------

type CommandBody = AuthorityCommand extends infer Command
  ? Command extends AuthorityCommand
    ? Omit<Command, "interfaceVersion" | "idempotencyKey" | "authorization">
    : never
  : never;

const setup = async (transportFailures = 0) =>
  createInMemoryAuthority({ ...CONFORMANCE_WORLD, transportFailures });

const issue = async (
  engine: Awaited<ReturnType<typeof setup>>,
  entry: (typeof CONFORMANCE_PRINCIPALS)[keyof typeof CONFORMANCE_PRINCIPALS],
  operationId = OP,
) => {
  const result = await engine.runtime.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId,
    evidence: entry.evidence,
  });
  if ("failure" in result) throw new Error(`issuance for ${entry.label}: ${result.failure.kind}`);
  return result;
};

const command = (
  engine: Awaited<ReturnType<typeof setup>>,
  body: CommandBody,
  authorization: AuthorityCommand["authorization"],
  key: string,
) =>
  engine.runtime.command({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    idempotencyKey: key,
    authorization,
    ...body,
  } as AuthorityCommand);

const envelopeAuth = (envelope: SignedAccessEnvelope): AuthorityCommand["authorization"] => ({
  kind: "access-envelope",
  envelope,
});

const freshAuth = (
  entry: (typeof CONFORMANCE_PRINCIPALS)[keyof typeof CONFORMANCE_PRINCIPALS],
  operationId = OP,
): AuthorityCommand["authorization"] => ({
  kind: "fresh-evidence",
  evidence: entry.evidence,
  operationId,
});

const applyTwice = async (
  engine: Awaited<ReturnType<typeof setup>>,
  body: CommandBody,
  authorization: AuthorityCommand["authorization"],
  key: string,
): Promise<void> => {
  const first = await command(engine, body, authorization, key);
  assert.ok(first.ok && first.receipt.applied, `${body.kind}: first application`);
  const retry = await command(engine, body, authorization, key);
  assert.ok(retry.ok && !retry.receipt.applied, `${body.kind}: retry claims the result`);
};

test("duplicate commands: every mutating command claims its key", async () => {
  const len = async (engine: Awaited<ReturnType<typeof setup>>) => envelopeAuth((await issue(engine, CONFORMANCE_PRINCIPALS.len)).envelope);
  const dana = async (engine: Awaited<ReturnType<typeof setup>>) => envelopeAuth((await issue(engine, CONFORMANCE_PRINCIPALS.dana)).envelope);
  const marco = async (engine: Awaited<ReturnType<typeof setup>>) => envelopeAuth((await issue(engine, CONFORMANCE_PRINCIPALS.marco)).envelope);

  {
    const engine = await setup();
    await applyTwice(
      engine,
      { kind: "grant-hat", operationId: OP, organizationId: "org-2b7c41de", actorId: "actor-6e0d94b2", role: "reviewer", target: { kind: "team", teamId: "team-c7d9e2a1" } },
      await len(engine),
      "dup-grant",
    );
  }
  {
    const engine = await setup();
    await applyTwice(engine, { kind: "revoke-grant", operationId: OP, grantId: "g-mer-3" }, await len(engine), "dup-revoke");
  }
  {
    const engine = await setup();
    await applyTwice(engine, { kind: "select-hat", operationId: OP, grantId: "g-mer-2" }, await marco(engine), "dup-select");
  }
  {
    const engine = await setup();
    await applyTwice(
      engine,
      { kind: "participation-invite", operationId: OP, organizationId: "org-invitee" },
      await len(engine),
      "dup-invite",
    );
  }
  {
    const engine = await setup();
    const admin = await len(engine);
    await command(engine, { kind: "participation-invite", operationId: OP, organizationId: "org-invitee" }, admin, "dup-accept-invite");
    await engine.drainOutbox();
    await applyTwice(
      engine,
      { kind: "participation-accept", operationId: OP },
      freshAuth(CONFORMANCE_PRINCIPALS.inviteeAdmin),
      "dup-accept",
    );
  }
  {
    const engine = await setup();
    const admin = await len(engine);
    await command(engine, { kind: "participation-invite", operationId: OP, organizationId: "org-invitee" }, admin, "dup-revoke-invite");
    await engine.drainOutbox();
    await command(
      engine,
      { kind: "participation-accept", operationId: OP },
      freshAuth(CONFORMANCE_PRINCIPALS.inviteeAdmin),
      "dup-revoke-accept",
    );
    await engine.drainOutbox();
    await applyTwice(
      engine,
      { kind: "participation-revoke", operationId: OP, organizationId: "org-invitee", by: "operation" },
      admin,
      "dup-participation-revoke",
    );
  }
  {
    const engine = await setup();
    await applyTwice(
      engine,
      { kind: "disable-actor", organizationId: "org-4c1f9a2e", actorId: "actor-3a91c4d8" },
      await dana(engine),
      "dup-disable",
    );
  }
  {
    const engine = await setup();
    await applyTwice(
      engine,
      { kind: "request-access", operationId: OP, evidence: CONFORMANCE_PRINCIPALS.inviteeAdmin.evidence },
      freshAuth(CONFORMANCE_PRINCIPALS.inviteeAdmin),
      "dup-request",
    );
  }
  {
    const engine = await setup();
    const admin = await len(engine);
    await command(
      engine,
      { kind: "request-access", operationId: OP, evidence: CONFORMANCE_PRINCIPALS.inviteeAdmin.evidence },
      freshAuth(CONFORMANCE_PRINCIPALS.inviteeAdmin),
      "dup-admit-request",
    );
    await applyTwice(
      engine,
      { kind: "admit", operationId: OP, organizationId: "org-invitee", actorId: "actor-inv-admin" },
      admin,
      "dup-admit",
    );
  }
});

test("idempotency misuse: the same key with a different payload is invalid", async () => {
  const engine = await setup();
  const admin = envelopeAuth((await issue(engine, CONFORMANCE_PRINCIPALS.len)).envelope);
  const body: CommandBody = {
    kind: "grant-hat",
    operationId: OP,
    organizationId: "org-2b7c41de",
    actorId: "actor-6e0d94b2",
    role: "reviewer",
    target: { kind: "team", teamId: "team-c7d9e2a1" },
  };
  const first = await command(engine, body, admin, "misuse-key");
  assert.ok(first.ok && first.receipt.applied);
  const changed = await command(engine, { ...body, role: "field" }, admin, "misuse-key");
  assert.ok(!changed.ok && changed.failure.kind === "invalid-command");
});

test("partial workflow failure: retries converge, replays are no-ops, and state stays visible", async () => {
  const engine = await setup(2);
  const admin = envelopeAuth((await issue(engine, CONFORMANCE_PRINCIPALS.len)).envelope);
  const invite = await command(
    engine,
    { kind: "participation-invite", operationId: OP, organizationId: "org-invitee" },
    admin,
    "partial-invite",
  );
  assert.ok(invite.ok);
  assert.equal(engine.pendingOutbox(), 1);
  // the acceptance cannot exist before its invitation arrives; the attempt
  // consumes one transport failure and leaves the invitation pending
  const earlyAccept = await command(
    engine,
    { kind: "participation-accept", operationId: OP },
    freshAuth(CONFORMANCE_PRINCIPALS.inviteeAdmin),
    "partial-early-accept",
  );
  assert.ok(!earlyAccept.ok && earlyAccept.failure.kind === "denied");
  assert.equal(engine.pendingOutbox(), 1);
  assert.equal(await engine.drainOutbox(), 0);
  assert.equal(engine.pendingOutbox(), 1);
  // the next attempt delivers; a replay is a no-op
  assert.equal(await engine.drainOutbox(), 1);
  assert.equal(engine.pendingOutbox(), 0);
  assert.equal(await engine.drainOutbox(), 0);
  const invitation = [...engine.invitationsOf("org-invitee").values()][0];
  assert.equal(invitation?.status, "pending");

  const accept = await command(
    engine,
    { kind: "participation-accept", operationId: OP },
    freshAuth(CONFORMANCE_PRINCIPALS.inviteeAdmin),
    "partial-accept",
  );
  assert.ok(accept.ok);
  assert.equal(engine.pendingOutbox(), 1);
  // the acceptance ack is pending: the operation still records invited
  assert.equal(engine.snapshotOf(OP)?.participations.find((p) => p.organizationId === "org-invitee")?.status, "invited");
  assert.equal(await engine.drainOutbox(), 1);
  assert.equal(engine.snapshotOf(OP)?.participations.find((p) => p.organizationId === "org-invitee")?.status, "active");
  assert.equal(await engine.drainOutbox(), 0);
});
