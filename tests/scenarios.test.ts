// Real-world arcs through the public runtime: each test models one
// situation an operator would recognize and pins what the authority
// subsystem does with it. They run through `AuthorityRuntime` and the
// access verifier only, like every conformance case, and lean on the three
// twins for world data — the professional operation, the festival, and the
// Berlin Airlift.

import test from "node:test";
import assert from "node:assert/strict";

import {
  AIRLIFT,
  DANA_OKAFOR,
  FESTIVAL,
  HARBOR_LOGISTICS,
  PROFESSIONAL_OPERATION,
} from "../src/authority/twins.ts";
import type { PrincipalEvidence } from "../src/authority/types.ts";
import { AUTHORITY_INTERFACE_VERSION } from "../src/authority/types.ts";
import { createInMemoryAuthority } from "../src/authority/engine.ts";
import { fixedClock, webCryptoSigner } from "../src/authority/internal.ts";
import { verify } from "../src/access/verify.ts";
import { ed25519VerifyKey } from "../src/access/verify.ts";

const MERIDIAN = "op-9f2e6ad4";
const FESTIVAL_OP = "op-61a8e3f2";
const AIRLIFT_OP = "op-4b8d2e67";
const NORTH_ORG = "org-2b7c41de";
const CIDERS_ORG = "org-d94b1c6e";
const HARBOR_TEAM = "team-2e8c64b9";
const NORTH_TEAM = "team-c7d9e2a1";
const NORTH_FLOOR = "team-f5b3a08d";
const BOOTH_001 = "team-booth-001";

// the airlift world
const VITTLES_WING = "org-6f1a93c4";
const PLANE_FARE = "org-2d7eb58a";
const RHEIN_CARRIERS = "org-9c4b17f3";
const GROUND_HANDLING = "org-58e3a2d1";
const TEMPELHOF = "site-c5d2a8f7";
const FASSBERG = "site-38b6f0a9";
const SHIFT_ONE = "team-5a2b8e37";
const SHIFT_TWO = "team-7f9d4c15";
const OPS_DESK = "team-9b3e6a82";
const GATOW_SHIFT = "team-c84b1f69";
const FASSBERG_DISPATCH = "team-1e94c7a8";

const LEN: PrincipalEvidence = { provider: "test-idp", subject: "len" };
const DANA: PrincipalEvidence = { provider: "test-idp", subject: "dana" };
const MARCO: PrincipalEvidence = { provider: "test-idp", subject: "marco" };
const IRIS: PrincipalEvidence = { provider: "test-idp", subject: "iris" };
const FALK: PrincipalEvidence = { provider: "test-idp", subject: "falk" };
const WHITFIELD: PrincipalEvidence = { provider: "test-idp", subject: "whitfield" };
const REEVE: PrincipalEvidence = { provider: "test-idp", subject: "reeve" };
const BRANDT: PrincipalEvidence = { provider: "test-idp", subject: "brandt" };

const MARCO_ID = "actor-6e0d94b2";
const IRIS_ID = "actor-40e9d1a7";
const SAM_ID = "actor-3a91c4d8";
const LEN_ID = "actor-77f2b0e5";
const FALK_ID = "actor-42e9c0a7";
const WHITFIELD_ID = "actor-4f7c2a19";
const REEVE_ID = "actor-91f3c7e8";
const BRANDT_ID = "actor-b86d4f31";

const setup = async () => {
  const engine = await createInMemoryAuthority({
    clock: fixedClock(1_700_000_000),
    signer: await webCryptoSigner("key-scenarios"),
    fixtures: [PROFESSIONAL_OPERATION, FESTIVAL, AIRLIFT],
    principalLinks: [
      { provider: LEN.provider, subject: LEN.subject, organizationId: "org-a53e90f7", actorId: LEN_ID },
      { provider: DANA.provider, subject: DANA.subject, organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR },
      { provider: MARCO.provider, subject: MARCO.subject, organizationId: NORTH_ORG, actorId: MARCO_ID },
      { provider: IRIS.provider, subject: IRIS.subject, organizationId: CIDERS_ORG, actorId: IRIS_ID },
      { provider: FALK.provider, subject: FALK.subject, organizationId: GROUND_HANDLING, actorId: FALK_ID },
      { provider: WHITFIELD.provider, subject: WHITFIELD.subject, organizationId: VITTLES_WING, actorId: WHITFIELD_ID },
      { provider: REEVE.provider, subject: REEVE.subject, organizationId: PLANE_FARE, actorId: REEVE_ID },
      { provider: BRANDT.provider, subject: BRANDT.subject, organizationId: GROUND_HANDLING, actorId: BRANDT_ID },
    ],
    orgAdmins: { [HARBOR_LOGISTICS]: [DANA_OKAFOR] },
  });
  const material = await engine.verificationKey();
  const key = await ed25519VerifyKey(material.keyId, material.publicKey);
  return { engine, keys: new Map([[key.keyId, key]]) };
};

const evidence = (subject: PrincipalEvidence, operationId: string) => ({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  operationId,
  evidence: subject,
});

const issue = async (
  engine: Awaited<ReturnType<typeof createInMemoryAuthority>>["runtime"],
  subject: PrincipalEvidence,
  operationId: string,
) => {
  const result = await engine.accessFromEvidence(evidence(subject, operationId));
  assert.ok(!("failure" in result), `issuance failed: ${"failure" in result ? result.failure.kind : ""}`);
  return result;
};

const command = async (
  engine: Awaited<ReturnType<typeof createInMemoryAuthority>>["runtime"],
  body: Record<string, unknown>,
  authorization: Record<string, unknown>,
  key: string,
) =>
  engine.command({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    idempotencyKey: key,
    authorization,
    ...body,
  } as Parameters<typeof engine.command>[0]);

test("the embedded specialist reads the organization that owns the team, not their employer's alone", async () => {
  const { engine, keys } = await setup();
  const before = await issue(engine.runtime, MARCO, MERIDIAN);
  assert.deepEqual(before.envelope.claims.readableOrganizationIds, [NORTH_ORG]);

  const len = await issue(engine.runtime, LEN, MERIDIAN);
  const grant = await command(
    engine.runtime,
    { kind: "grant-hat", operationId: MERIDIAN, organizationId: NORTH_ORG, actorId: MARCO_ID, role: "field", teamId: HARBOR_TEAM, primary: true },
    { kind: "access-envelope", envelope: len.envelope },
    "scenarios-embed-1",
  );
  assert.ok(grant.ok);

  const after = await issue(engine.runtime, MARCO, MERIDIAN);
  // read reach follows the target: the Harbor-owned team makes Harbor
  // readable to a North actor
  assert.deepEqual(after.envelope.claims.readableOrganizationIds.sort(), [HARBOR_LOGISTICS, NORTH_ORG].sort());
  const verified = await verify(after.envelope, keys, {
    now: after.envelope.claims.iat + 1,
    expectedOperationId: MERIDIAN,
  });
  assert.ok(!("failure" in verified));
  assert.equal(verified.access.mayAct("observe", { kind: "team", teamId: HARBOR_TEAM }), true);
});

test("the suspended guild's booth stays readable through a crossed grant, as an exceptional team", async () => {
  const { engine, keys } = await setup();
  const admin = await issue(engine.runtime, DANA, FESTIVAL_OP);
  assert.deepEqual(
    admin.envelope.claims.readableOrganizationIds.slice().sort(),
    [CIDERS_ORG, HARBOR_LOGISTICS, "org-08f7a2b5"].sort(),
  );
  assert.deepEqual(admin.envelope.claims.readableTeamIds, []);

  // the safety lead takes a crossed grant at a ciders guild booth, as
  // their working hat
  const cross = await command(
    engine.runtime,
    { kind: "grant-hat", operationId: FESTIVAL_OP, organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR, role: "steward", teamId: BOOTH_001, primary: true },
    { kind: "access-envelope", envelope: admin.envelope },
    "scenarios-cross-1",
  );
  assert.ok(cross.ok);

  const revoke = await command(
    engine.runtime,
    { kind: "participation-revoke", operationId: FESTIVAL_OP, organizationId: CIDERS_ORG, by: "operation" },
    { kind: "access-envelope", envelope: admin.envelope },
    "scenarios-revoke-ciders",
  );
  assert.ok(revoke.ok);

  const after = await issue(engine.runtime, DANA, FESTIVAL_OP);
  // the guild is suspended, so its organization leaves the readable set —
  // but the booth the steward reaches is exceptional team reach
  assert.deepEqual(
    after.envelope.claims.readableOrganizationIds.slice().sort(),
    [HARBOR_LOGISTICS, "org-08f7a2b5"].sort(),
  );
  assert.ok(after.envelope.claims.readableTeamIds.includes(BOOTH_001));
  const verified = await verify(after.envelope, keys, {
    now: after.envelope.claims.iat + 1,
    expectedOperationId: FESTIVAL_OP,
  });
  assert.ok(!("failure" in verified));
  // read reach narrows; act capability at the booth does not
  assert.equal(verified.access.mayAct("flag", { kind: "team", teamId: BOOTH_001 }), true);
});

test("suspension cuts both ways: the guild's own people lose fresh access, live envelopes survive to expiry", async () => {
  const { engine, keys } = await setup();
  const live = await issue(engine.runtime, IRIS, FESTIVAL_OP);
  const admin = await issue(engine.runtime, DANA, FESTIVAL_OP);
  const revoke = await command(
    engine.runtime,
    { kind: "participation-revoke", operationId: FESTIVAL_OP, organizationId: CIDERS_ORG, by: "operation" },
    { kind: "access-envelope", envelope: admin.envelope },
    "scenarios-cut-revoke",
  );
  assert.ok(revoke.ok);

  const refused = await engine.runtime.accessFromEvidence(evidence(IRIS, FESTIVAL_OP));
  assert.equal(refused.failure.kind, "not-admitted");

  const stillLive = await verify(live.envelope, keys, {
    now: live.envelope.claims.iat + 1,
    expectedOperationId: FESTIVAL_OP,
  });
  assert.ok(!("failure" in stillLive), "the live envelope survives suspension to expiry");

  assert.equal(live.refresh.kind, "rotated");
  const dead = await engine.runtime.refresh({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: FESTIVAL_OP,
    handle: live.refresh.kind === "rotated" ? live.refresh.handle : "",
  });
  assert.equal(dead.failure.kind, "unauthenticated");
});

test("the departing administrator: administration survives to expiry, fresh proof does not", async () => {
  const { engine } = await setup();
  const dana = await issue(engine.runtime, DANA, MERIDIAN);

  // Dana disables herself — the last administrator of Harbor
  const self = await command(
    engine.runtime,
    { kind: "disable-actor", organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR },
    { kind: "fresh-evidence", evidence: DANA, operationId: MERIDIAN },
    "scenarios-self-disable",
  );
  assert.ok(self.ok);

  // her live envelope still administers: the bounded window applies to
  // administration exactly as it does to every other authority fact
  const viaEnvelope = await command(
    engine.runtime,
    { kind: "disable-actor", organizationId: HARBOR_LOGISTICS, actorId: SAM_ID },
    { kind: "access-envelope", envelope: dana.envelope },
    "scenarios-disable-sam",
  );
  assert.ok(viaEnvelope.ok);

  // fresh proof is refused, and the refresh handle died with her
  const viaEvidence = await command(
    engine.runtime,
    { kind: "disable-actor", organizationId: HARBOR_LOGISTICS, actorId: "actor-3a91c4d8" },
    { kind: "fresh-evidence", evidence: DANA, operationId: MERIDIAN },
    "scenarios-disable-sam-2",
  );
  assert.equal(viaEvidence.ok, false);
  assert.equal(viaEvidence.failure.kind, "not-admitted");

  assert.equal(dana.refresh.kind, "rotated");
  const dead = await engine.runtime.refresh({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: MERIDIAN,
    handle: dana.refresh.kind === "rotated" ? dana.refresh.handle : "",
  });
  assert.equal(dead.failure.kind, "unauthenticated");
});

test("the shift change: the worn hat turns over at the next issuance, never mid-envelope", async () => {
  const { engine, keys } = await setup();
  const before = await issue(engine.runtime, MARCO, MERIDIAN);
  assert.equal(before.envelope.claims.hat.role, "field");

  const len = await issue(engine.runtime, LEN, MERIDIAN);
  const grant = await command(
    engine.runtime,
    { kind: "grant-hat", operationId: MERIDIAN, organizationId: NORTH_ORG, actorId: MARCO_ID, role: "reviewer", teamId: NORTH_FLOOR, primary: true },
    { kind: "access-envelope", envelope: len.envelope },
    "scenarios-shift-grant",
  );
  assert.ok(grant.ok);

  // the envelope already in the field still wears the old hat
  const stillOld = await verify(before.envelope, keys, {
    now: before.envelope.claims.iat + 1,
    expectedOperationId: MERIDIAN,
  });
  assert.ok(!("failure" in stillOld));
  assert.equal(stillOld.claims.hat.role, "field");

  // the next issuance wears the new primary
  const after = await issue(engine.runtime, MARCO, MERIDIAN);
  assert.equal(after.envelope.claims.hat.role, "reviewer");
  assert.deepEqual(after.envelope.claims.hat.teamIds, [NORTH_FLOOR]);
});

test("one identity is never two actors: a conflicting principal link is refused at both bootstrap layers", async () => {
  const base = {
    clock: fixedClock(1_700_000_000),
    signer: await webCryptoSigner("key-identity"),
    fixtures: [PROFESSIONAL_OPERATION],
  };
  const danaLink = { provider: "test-idp", subject: "dana", organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR };

  await assert.rejects(
    createInMemoryAuthority({
      ...base,
      principalLinks: [danaLink, { ...danaLink, actorId: SAM_ID }],
    }),
    /already resolves/,
  );

  // re-linking the same actor is idempotent, not a conflict
  const engine = await createInMemoryAuthority({ ...base, principalLinks: [danaLink, danaLink] });
  const issued = await engine.runtime.accessFromEvidence(evidence(DANA, MERIDIAN));
  assert.ok(!("failure" in issued));
  assert.equal(issued.envelope.claims.actor.actorId, DANA_OKAFOR);
});

// --- the Berlin Airlift — the coalition twin -----------------------------------

test("the coalition tonnage board: a Berlin shift lead reads every participating organization", async () => {
  const { engine, keys } = await setup();
  const falk = await issue(engine.runtime, FALK, AIRLIFT_OP);
  assert.deepEqual(
    falk.envelope.claims.readableOrganizationIds.slice().sort(),
    [VITTLES_WING, PLANE_FARE, RHEIN_CARRIERS, GROUND_HANDLING].sort(),
  );
  assert.deepEqual(falk.envelope.claims.readableTeamIds, []);
  const verified = await verify(falk.envelope, keys, {
    now: falk.envelope.claims.iat + 1,
    expectedOperationId: AIRLIFT_OP,
  });
  assert.ok(!("failure" in verified));
  assert.equal(verified.access.mayAct("load", { kind: "team", teamId: SHIFT_TWO }), true);
  assert.equal(verified.access.mayAct("haul", { kind: "team", teamId: SHIFT_TWO }), false);
});

test("the exchange officer: secondment is a crossed grant onto another organization's team", async () => {
  const { engine, keys } = await setup();
  const reeve = await issue(engine.runtime, REEVE, AIRLIFT_OP);
  // one worn hat: the Ground Handling shift, not the home station at Fassberg
  assert.deepEqual(reeve.envelope.claims.hat.teamIds, [SHIFT_ONE]);
  const verified = await verify(reeve.envelope, keys, {
    now: reeve.envelope.claims.iat + 1,
    expectedOperationId: AIRLIFT_OP,
  });
  assert.ok(!("failure" in verified));
  assert.equal(verified.access.mayAct("dispatch", { kind: "team", teamId: SHIFT_ONE }), true);
  assert.equal(verified.access.mayAct("dispatch", { kind: "team", teamId: FASSBERG_DISPATCH }), false);
});

test("one airfield is one site: a Tempelhof foreman reaches every team there and nothing at Gatow", async () => {
  const { engine, keys } = await setup();
  const brandt = await issue(engine.runtime, BRANDT, AIRLIFT_OP);
  const verified = await verify(brandt.envelope, keys, {
    now: brandt.envelope.claims.iat + 1,
    expectedOperationId: AIRLIFT_OP,
    expectedSiteId: TEMPELHOF,
  });
  assert.ok(!("failure" in verified));
  // every team at Tempelhof, including the wing's ops desk — site reach
  // crosses organizations — but the load action stays the worn hat's
  for (const teamId of [SHIFT_ONE, SHIFT_TWO, OPS_DESK]) {
    assert.equal(verified.access.mayAct("load", { kind: "team", teamId }), true, teamId);
  }
  // the same organization's shift at Gatow is another site: nothing there
  assert.equal(verified.access.mayAct("load", { kind: "team", teamId: GATOW_SHIFT }), false);
});

test("the host nation stands down, the lift continues: the board shrinks, the secondment becomes exceptional", async () => {
  const { engine } = await setup();
  const whitfield = await issue(engine.runtime, WHITFIELD, AIRLIFT_OP);
  const revoke = await command(
    engine.runtime,
    { kind: "participation-revoke", operationId: AIRLIFT_OP, organizationId: GROUND_HANDLING, by: "operation" },
    { kind: "access-envelope", envelope: whitfield.envelope },
    "scenarios-ghs-stands-down",
  );
  assert.ok(revoke.ok);

  // the ground handlers lose fresh access; the wing does not
  const refused = await engine.runtime.accessFromEvidence(evidence(FALK, AIRLIFT_OP));
  assert.equal(refused.failure.kind, "not-admitted");

  const after = await issue(engine.runtime, WHITFIELD, AIRLIFT_OP);
  assert.deepEqual(
    after.envelope.claims.readableOrganizationIds.slice().sort(),
    [VITTLES_WING, PLANE_FARE, RHEIN_CARRIERS].sort(),
  );

  // the exchange officer still holds the crossed grant, and the shift it
  // reaches now travels as an exceptional team
  const reeve = await issue(engine.runtime, REEVE, AIRLIFT_OP);
  assert.deepEqual(reeve.envelope.claims.hat.teamIds, [SHIFT_ONE]);
  assert.ok(reeve.envelope.claims.readableTeamIds.includes(SHIFT_ONE));
});
