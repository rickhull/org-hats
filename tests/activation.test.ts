// Activation and principal recovery at the portable authority seam.

import test from "node:test";
import assert from "node:assert/strict";

import { actorId, isFailed, operationId, organizationId, siteId, teamId } from "../src/contract.ts";
import { createInMemoryAuthority } from "../src/authority/engine.ts";
import { fixedClock, webCryptoSigner } from "../src/authority/internal.ts";
import type { AuthorityCommand, PrincipalEvidence } from "../src/authority/types.ts";
import { AUTHORITY_INTERFACE_VERSION } from "../src/authority/types.ts";
import type { TwinFixture } from "../src/authority/twins.ts";
import { failureOf, fixtureSnapshot, handleOf, okOf, type CommandBody } from "./helpers.ts";

const ORG = organizationId("org-activation");
const OTHER_ORG = organizationId("org-other");
const ADMIN = actorId("actor-admin");
const TARGET = actorId("actor-target");
const OTHER = actorId("actor-other");
const OP = operationId("op-activation");
const SITE = siteId("site-activation");
const TEAM = teamId("team-activation");
const ADMIN_EVIDENCE = { provider: "idp", subject: "admin" } as const;
const TARGET_EVIDENCE = { provider: "idp", subject: "target" } as const;

const fixture: TwinFixture = {
  name: "invitee",
  policy: {
    format: 1,
    id: "policy-activation",
    version: "1",
    actions: ["observe"],
    roles: [{ title: "member", actions: ["observe"] }],
    readPolicy: { organizations: "granted-teams" },
  },
  snapshot: fixtureSnapshot({
    operations: [{ operationId: OP }],
    organizations: [{ organizationId: ORG }, { organizationId: OTHER_ORG }],
    actors: [
      { organizationId: ORG, actorId: ADMIN },
      { organizationId: ORG, actorId: TARGET },
      { organizationId: OTHER_ORG, actorId: OTHER },
    ],
    sites: [{ siteId: SITE, operationId: OP, aliases: [] }],
    teams: [{ teamId: TEAM, siteId: SITE, organizationId: ORG }],
    grants: [{
      grantId: "grant-target",
      operationId: OP,
      organizationId: ORG,
      actorId: TARGET,
      role: "member",
      target: { kind: "team", teamId: TEAM },
      primary: true,
    }],
    participations: [
      { organizationId: ORG, operationId: OP, status: "active" },
      { organizationId: OTHER_ORG, operationId: OP, status: "active" },
    ],
  }),
};

const setup = async (transportFailures = 0) => {
  const clock = fixedClock(1_700_000_000);
  const secrets = ["AAAAAAAAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBBBBBBBB", "CCCCCCCCCCCCCCCCCCCCCC"];
  const engine = await createInMemoryAuthority({
    clock,
    signer: await webCryptoSigner("activation-test"),
    activationLifetimeSeconds: 60,
    activationSecret: () => secrets.shift() ?? "DDDDDDDDDDDDDDDDDDDDDD",
    transportFailures,
    fixtures: [fixture],
    principalLinks: [
      { provider: "idp", subject: "admin", organizationId: ORG, actorId: ADMIN },
      { provider: "idp", subject: "other", organizationId: OTHER_ORG, actorId: OTHER },
    ],
    orgAdmins: { [ORG]: [ADMIN] },
  });
  return { engine, clock };
};

const request = (evidence: PrincipalEvidence = ADMIN_EVIDENCE) => ({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  organizationId: ORG,
  actorId: TARGET,
  evidence,
});

const cmd = (
  body: CommandBody,
  authorization: AuthorityCommand["authorization"],
  idempotencyKey: string,
): AuthorityCommand => ({ interfaceVersion: AUTHORITY_INTERFACE_VERSION, idempotencyKey, authorization, ...body });

test("activation request returns a secret once; inspection discloses only usability", async () => {
  const { engine } = await setup();
  const issued = await engine.runtime.activationRequest(request());
  assert.ok(!isFailed(issued));
  assert.equal(issued.secret, "AAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(issued.expiresAt, 1_700_000_060);

  const inspected = await engine.runtime.activationInspect({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    secret: issued.secret,
  });
  assert.deepEqual(inspected, { usable: true });
  assert.equal("actorId" in inspected, false);
  assert.equal("expiresAt" in inspected, false);
});

test("request retry rotates instead of replaying plaintext", async () => {
  const { engine } = await setup();
  const first = await engine.runtime.activationRequest(request());
  const second = await engine.runtime.activationRequest(request());
  assert.ok(!isFailed(first) && !isFailed(second));
  assert.notEqual(first.requestId, second.requestId);
  assert.notEqual(first.secret, second.secret);
  assert.equal(failureOf(await engine.runtime.activationInspect({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    secret: first.secret,
  })).kind, "unauthenticated");
  assert.deepEqual(await engine.runtime.activationInspect({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    secret: second.secret,
  }), { usable: true });
});

test("accept binds the verified subject atomically and replays for that subject only", async () => {
  const { engine } = await setup();
  const issued = await engine.runtime.activationRequest(request());
  assert.ok(!isFailed(issued));
  const accepted = await engine.runtime.activationAccept({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    secret: issued.secret,
    evidence: TARGET_EVIDENCE,
  });
  assert.ok(!isFailed(accepted));
  assert.deepEqual(accepted, {
    applied: true,
    actor: { organizationId: ORG, actorId: TARGET },
  });

  const replay = await engine.runtime.activationAccept({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    secret: issued.secret,
    evidence: TARGET_EVIDENCE,
  });
  assert.ok(!isFailed(replay));
  assert.equal(replay.applied, false);

  const different = await engine.runtime.activationAccept({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    secret: issued.secret,
    evidence: { provider: "idp", subject: "different" },
  });
  assert.equal(failureOf(different).kind, "unauthenticated");

  const access = await engine.runtime.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: OP,
    evidence: TARGET_EVIDENCE,
  });
  assert.ok(!isFailed(access));
});

test("expiry and a subject owned by another actor fail without consuming the request", async () => {
  const { engine, clock } = await setup();
  const conflict = await engine.runtime.activationRequest(request());
  assert.ok(!isFailed(conflict));
  const refused = await engine.runtime.activationAccept({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    secret: conflict.secret,
    evidence: { provider: "idp", subject: "other" },
  });
  assert.equal(failureOf(refused).kind, "denied");
  assert.deepEqual(await engine.runtime.activationInspect({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    secret: conflict.secret,
  }), { usable: true }, "a conflicting subject does not spend the request");

  clock.advance(60);
  const expiredInspect = await engine.runtime.activationInspect({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    secret: conflict.secret,
  });
  const expiredAccept = await engine.runtime.activationAccept({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    secret: conflict.secret,
    evidence: TARGET_EVIDENCE,
  });
  assert.deepEqual(failureOf(expiredInspect), failureOf(expiredAccept));
  assert.equal(failureOf(expiredAccept).kind, "unauthenticated");
});

test("revocation is idempotent and leaves the actor enabled and unlinked", async () => {
  const { engine } = await setup();
  const issued = await engine.runtime.activationRequest(request());
  assert.ok(!isFailed(issued));
  const revoke = cmd(
    { kind: "revoke-activation", organizationId: ORG, actorId: TARGET },
    { kind: "fresh-evidence", evidence: ADMIN_EVIDENCE, operationId: OP },
    "revoke-activation-1",
  );
  okOf(await engine.runtime.command(revoke));
  const replay = await engine.runtime.command(revoke);
  assert.ok(replay.ok && replay.receipt.applied === false);
  assert.equal(failureOf(await engine.runtime.activationInspect({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    secret: issued.secret,
  })).kind, "unauthenticated");
});

test("unlink preserves grants and refresh fails even when outbox delivery is lost", async () => {
  const { engine } = await setup(1);
  const issued = await engine.runtime.activationRequest(request());
  assert.ok(!isFailed(issued));
  const accepted = await engine.runtime.activationAccept({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    secret: issued.secret,
    evidence: TARGET_EVIDENCE,
  });
  assert.ok(!isFailed(accepted));
  const access = await engine.runtime.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: OP,
    evidence: TARGET_EVIDENCE,
  });
  assert.ok(!isFailed(access));

  okOf(await engine.runtime.command(cmd(
    { kind: "unlink-principal", organizationId: ORG, actorId: TARGET },
    { kind: "fresh-evidence", evidence: ADMIN_EVIDENCE, operationId: OP },
    "unlink-target-1",
  )));
  assert.equal(failureOf(await engine.runtime.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: OP,
    evidence: TARGET_EVIDENCE,
  })).kind, "unauthenticated");
  assert.equal(failureOf(await engine.runtime.refresh({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: OP,
    handle: handleOf(access.refresh),
  })).kind, "unauthenticated");
  assert.equal(engine.snapshotOf(OP)?.grants.some((grant) => grant.actorId === TARGET), true);

  const replacement = await engine.runtime.activationRequest(request());
  assert.ok(!isFailed(replacement), "the enabled, unlinked actor can be activated again");
});
