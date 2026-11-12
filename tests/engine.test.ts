// The in-memory authority engine — issuance, refresh outcomes, the
// participation workflow with visible partial states and retry, command
// idempotency and authorization, and the bounded revocation window.

import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import { actorId, canonicalJson, isFailed, operationId, organizationId, siteId, teamId } from "../src/contract.ts";
import type { TwinFixture } from "../src/authority/twins.ts";
import type { Grant, Organization } from "../src/model.ts";
import {
  DANA_OKAFOR,
  FESTIVAL,
  HARBOR_LOGISTICS,
  PROFESSIONAL_OPERATION,
} from "../src/authority/twins.ts";
import type { PrincipalEvidence } from "../src/authority/types.ts";
import { AUTHORITY_INTERFACE_VERSION } from "../src/authority/types.ts";
import { createInMemoryAuthority } from "../src/authority/engine.ts";
import { fixedClock, webCryptoSigner } from "../src/authority/internal.ts";
import { asJson, buildCommand, failureOf, fixtureSnapshot, successOf, handleOf, okOf } from "./helpers.ts";

const OP = operationId("op-9f2e6ad4"); // Meridian
const LEN_ORG = organizationId("org-a53e90f7");
const LEN_ID = actorId("actor-77f2b0e5");
const MARCO_ORG = organizationId("org-2b7c41de");
const MARCO_ID = actorId("actor-6e0d94b2");
const INVITEE_ORG = organizationId("org-invitee");
const INVITEE_ACTOR = actorId("actor-inv-lead");
const TITLED_OP = operationId("op-titled");
const TITLED_ORG = organizationId("org-titled");
const TITLED_ACTOR = actorId("actor-titled");
const LEN = { provider: "test-idp", subject: "len" } as const;
const DANA = { provider: "test-idp", subject: "dana" } as const;
const MARCO = { provider: "test-idp", subject: "marco" } as const;
const INVITEE_LEAD = { provider: "test-idp", subject: "inv-lead" } as const;

/** A third, tiny fixture: an organization that exists but does not
 * participate in Meridian — the invite target. */
const invitee: TwinFixture = {
  name: "invitee",
  policy: PROFESSIONAL_OPERATION.policy,
  snapshot: fixtureSnapshot({
    operations: [{ operationId: "op-dummy", longName: "Dummy Home Op" }],
    organizations: [{ organizationId: "org-invitee", longName: "Cedar Works" }],
    actors: [
      { organizationId: "org-invitee", actorId: "actor-inv-lead", displayName: "Nia Fields" },
    ],
    sites: [],
    teams: [],
    grants: [],
    participations: [{ organizationId: "org-invitee", operationId: "op-dummy", status: "active" }],
  }),
};

const setup = async (transportFailures = 0, envelopeLifetimeSeconds?: number) => {
  const clock = fixedClock(1_700_000_000);
  const signer = await webCryptoSigner("key-test");
  const engine = await createInMemoryAuthority({
    clock,
    signer,
    transportFailures,
    ...(envelopeLifetimeSeconds !== undefined ? { envelopeLifetimeSeconds } : {}),
    fixtures: [PROFESSIONAL_OPERATION, FESTIVAL, invitee],
    principalLinks: [
      { provider: LEN.provider, subject: LEN.subject, organizationId: LEN_ORG, actorId: LEN_ID },
      { provider: DANA.provider, subject: DANA.subject, organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR },
      { provider: MARCO.provider, subject: MARCO.subject, organizationId: MARCO_ORG, actorId: MARCO_ID },
      { provider: INVITEE_LEAD.provider, subject: INVITEE_LEAD.subject, organizationId: INVITEE_ORG, actorId: INVITEE_ACTOR },
    ],
    orgAdmins: { [INVITEE_ORG]: [INVITEE_ACTOR], [HARBOR_LOGISTICS]: [DANA_OKAFOR] },
  });
  return { engine, clock, signer };
};

const evidence = (subject: PrincipalEvidence, operationId: string = OP) => ({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  operationId,
  evidence: subject,
});

const cmd = buildCommand;

test("[E1] engine construction refuses a signer declaring another algorithm", async () => {
  const pair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
  );
  const signer = {
    keyId: "key-ecdsa",
    algorithm: "ECDSA",
    publicKey: async () => Buffer.from(await webcrypto.subtle.exportKey("raw", pair.publicKey)).toString("base64"),
    sign: async (payload: string) => Buffer.from(await webcrypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" }, pair.privateKey, Buffer.from(payload),
    )).toString("base64url"),
    verify: async (payload: string, signature: string) => webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, pair.publicKey,
      Buffer.from(signature, "base64url"), Buffer.from(payload),
    ),
  };
  await assert.rejects(
    createInMemoryAuthority({ signer }),
    /signer must use Ed25519/,
  );
});

test("issuance: evidence resolves the actor, computes reach, and signs", async () => {
  const { engine, signer } = await setup();
  const issue = await engine.runtime.accessFromEvidence(evidence(DANA));
  assert.ok(!isFailed(issue));
  const { envelope, refresh } = issue;
  assert.equal(refresh.kind, "rotated");
  assert.equal(envelope.keyId, "key-test");
  assert.equal(envelope.claims.actor.organizationId, HARBOR_LOGISTICS);
  assert.equal(envelope.claims.hat.role, "coordinator");
  assert.deepEqual(envelope.claims.readableOrganizationIds, [HARBOR_LOGISTICS]);
  assert.equal(envelope.claims.exp - envelope.claims.iat, 900);
  assert.ok(await signer.verify(canonicalJson(asJson(envelope.claims)), envelope.signature));
});

test("[A1] issuance failures: unknown evidence, actor without admission", async () => {
  const { engine } = await setup();
  const unknown = await engine.runtime.accessFromEvidence(evidence({ provider: "test-idp", subject: "nobody" }));
  assert.equal(failureOf(unknown).kind, "unauthenticated");
  // Iris belongs to the festival, not Meridian
  const iris = await engine.runtime.accessFromEvidence(evidence({ provider: "test-idp", subject: "iris" }));
  assert.equal(failureOf(iris).kind, "unauthenticated"); // no principal link at all
  const wrongOp = await engine.runtime.accessFromEvidence(evidence(DANA, "op-nonesuch"));
  assert.equal(failureOf(wrongOp).kind, "wrong-binding");
});

test("[A7] refresh: rotation with explicit outcomes; a superseded handle is dead", async () => {
  const { engine } = await setup();
  const first = await engine.runtime.accessFromEvidence(evidence(DANA));
  assert.ok(!isFailed(first));
  const handle = handleOf(first.refresh);
  const second = await engine.runtime.refresh({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION, operationId: OP, handle,
  });
  assert.ok(!isFailed(second));
  assert.equal(second.refresh.kind, "rotated");
  const replay = await engine.runtime.refresh({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION, operationId: OP, handle,
  });
  assert.equal(failureOf(replay).kind, "unauthenticated");
  assert.match(failureOf(replay).detail ?? "", /superseded/);
});

test("the envelope lifetime is configuration, not a constant", async () => {
  const { engine } = await setup(0, 60);
  const issue = await engine.runtime.accessFromEvidence(evidence(DANA));
  assert.ok(!isFailed(issue));
  assert.equal(issue.envelope.claims.exp - issue.envelope.claims.iat, 60);
});

test("[A6] amr and auth_time: copied from evidence, preserved through refresh, surfaced in context", async () => {
  const { engine, signer } = await setup();
  const authenticated: PrincipalEvidence = { ...DANA, amr: ["hwk", "otp"], authTime: 1_699_999_000 };
  const first = await engine.runtime.accessFromEvidence(evidence(authenticated));
  assert.ok(!isFailed(first));
  assert.deepEqual(first.envelope.claims.amr, ["hwk", "otp"]);
  assert.equal(first.envelope.claims.auth_time, 1_699_999_000);
  assert.notEqual(first.envelope.claims.auth_time, first.envelope.claims.iat);
  // evidence without authentication facts issues claims without them
  const bare = await engine.runtime.accessFromEvidence(evidence(DANA));
  assert.ok(!isFailed(bare));
  assert.equal("amr" in bare.envelope.claims, false);
  assert.equal("auth_time" in bare.envelope.claims, false);
  const second = await engine.runtime.refresh({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION, operationId: OP, handle: handleOf(first.refresh),
  });
  assert.ok(!isFailed(second));
  assert.deepEqual(second.envelope.claims.amr, ["hwk", "otp"], "refresh preserves the methods");
  assert.equal(second.envelope.claims.auth_time, 1_699_999_000, "refresh preserves the authentication time");
  const context = await engine.runtime.context({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION, envelope: second.envelope,
  });
  assert.ok(!isFailed(context));
  assert.deepEqual(context.amr, ["hwk", "otp"]);
  assert.equal(context.authTime, 1_699_999_000);
  // the methods are signed facts: tampering them breaks the signature
  const forged = { ...second.envelope, claims: { ...second.envelope.claims, amr: ["pwd"] } };
  assert.ok(!(await signer.verify(canonicalJson(asJson(forged.claims)), forged.signature)));
});

test("context: wearable hats carry the grant id select-hat takes", async () => {
  const { engine } = await setup();
  const len = await engine.runtime.accessFromEvidence(evidence(LEN));
  assert.ok(!isFailed(len));
  const grant = await engine.runtime.command(cmd(
    { kind: "grant-hat", operationId: OP, organizationId: MARCO_ORG, actorId: MARCO_ID, role: "reviewer", target: { kind: "team", teamId: "team-f5b3a08d" } },
    { kind: "access-envelope", envelope: len.envelope },
    "ctx-grantid-grant",
  ));
  okOf(grant);

  const marco = await engine.runtime.accessFromEvidence(evidence(MARCO));
  assert.ok(!isFailed(marco));
  const context = await engine.runtime.context({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION, envelope: marco.envelope,
  });
  assert.ok(!isFailed(context));
  // two hats after the grant, each addressable, ids unique
  assert.equal(context.wearableHats.length, 2);
  const ids = context.wearableHats.map((hat) => hat.grantId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("g-mer-2"), "the existing grant is listed");
  const reviewer = context.wearableHats.find((hat) => hat.role === "reviewer");
  assert.ok(reviewer !== undefined);

  // the round trip a host needs: address the listed hat, wear it next
  const select = await engine.runtime.command(cmd(
    { kind: "select-hat", operationId: OP, grantId: reviewer.grantId },
    { kind: "fresh-evidence", evidence: MARCO, operationId: OP },
    "ctx-grantid-select",
  ));
  okOf(select);
  const worn = await engine.runtime.refresh({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION, operationId: OP, handle: handleOf(marco.refresh),
  });
  assert.ok(!isFailed(worn));
  assert.equal(worn.envelope.claims.hat.role, "reviewer", "the next envelope wears the selected hat");
});

test("[A7][E7] the bounded window: a revoked grant kills refresh, not the live envelope", async () => {
  const { engine } = await setup();
  const danaIssue = await engine.runtime.accessFromEvidence(evidence(DANA));
  const lenIssue = await engine.runtime.accessFromEvidence(evidence(LEN));
  assert.ok(!isFailed(danaIssue) && !isFailed(lenIssue));
  const revoke = await engine.runtime.command(cmd(
    { kind: "revoke-grant", operationId: OP, grantId: "g-mer-3" },
    { kind: "access-envelope", envelope: lenIssue.envelope },
    "revoke-dana-1",
  ));
  okOf(revoke);
  // the envelope still verifies until expiry — the window is bounded, not zero
  const ctx = await engine.runtime.context({ interfaceVersion: AUTHORITY_INTERFACE_VERSION, envelope: danaIssue.envelope });
  assert.ok(!isFailed(ctx));
  // but the refresh handle died with the grant
  const dead = await engine.runtime.refresh({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION, operationId: OP, handle: handleOf(danaIssue.refresh),
  });
  assert.equal(failureOf(dead).kind, "unauthenticated");
  assert.match(failureOf(dead).detail ?? "", /revoked/);
});

test("[A7][A13] disable-actor: issuance stops immediately; the outbox revokes refresh records", async () => {
  const { engine } = await setup();
  const danaIssue = await engine.runtime.accessFromEvidence(evidence(DANA));
  assert.ok(!isFailed(danaIssue));
  // Dana administers Harbor
  const disable = await engine.runtime.command(cmd(
    { kind: "disable-actor", organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR },
    { kind: "fresh-evidence", evidence: DANA, operationId: OP },
    "disable-dana",
  ));
  okOf(disable);
  const blocked = await engine.runtime.accessFromEvidence(evidence(DANA));
  assert.equal(failureOf(blocked).kind, "not-admitted");
  // Context is a fresh authority read, not verification: the disabled actor's
  // context lists no wearable hats, while the envelope still verifies.
  const context = successOf(await engine.runtime.context({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    envelope: danaIssue.envelope,
  }));
  assert.equal(context.wearableHats.length, 0);
  assert.equal(context.selectedHat, undefined);
  const dead = await engine.runtime.refresh({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION, operationId: OP, handle: handleOf(danaIssue.refresh),
  });
  assert.equal(failureOf(dead).kind, "unauthenticated");
});

test("participation: an acceptance delivered after a revoke does not resurrect it", async () => {
  // The two coordinators disagree for a while by design — that is what the
  // outbox is. The organization accepts an invitation it still holds while
  // the operation has already revoked the participation, so the acceptance
  // arrives against a terminal state. No fault injection is needed: the
  // operation's revoke does not notify the organization, which is exactly
  // the visible partial state the design calls for.
  const { engine } = await setup();
  const len = await engine.runtime.accessFromEvidence(evidence(LEN));
  assert.ok(!isFailed(len));

  const invite = await engine.runtime.command(cmd(
    { kind: "participation-invite", operationId: OP, organizationId: "org-invitee" },
    { kind: "access-envelope", envelope: len.envelope },
    "revoke-race-invite",
  ));
  okOf(invite);
  await engine.drainOutbox();
  assert.equal(engine.invitationsOf(INVITEE_ORG).size, 1);

  const revoke = await engine.runtime.command(cmd(
    { kind: "participation-revoke", operationId: OP, organizationId: "org-invitee", by: "operation" },
    { kind: "access-envelope", envelope: len.envelope },
    "revoke-race-revoke",
  ));
  okOf(revoke);
  assert.equal(
    engine.snapshotOf(OP)?.participations.find((p) => p.organizationId === "org-invitee")?.status,
    "revoked",
  );

  // the organization still holds a pending invitation and accepts it
  const accept = await engine.runtime.command(cmd(
    { kind: "participation-accept", operationId: OP },
    { kind: "fresh-evidence", evidence: INVITEE_LEAD, operationId: OP },
    "revoke-race-accept",
  ));
  okOf(accept);
  assert.equal(engine.pendingOutbox(), 1);

  // delivery applies nothing: `transitionParticipation` refuses `accept`
  // and `activate` from `revoked`, so the message is consumed as a no-op
  assert.equal(await engine.drainOutbox(), 1);
  assert.equal(
    engine.snapshotOf(OP)?.participations.find((p) => p.organizationId === "org-invitee")?.status,
    "revoked",
    "a revoked participation stays revoked",
  );
  const after = await engine.runtime.accessFromEvidence(evidence(INVITEE_LEAD));
  assert.equal(failureOf(after).kind, "not-admitted", "no issuance against a revoked participation");
});

test("a wrong-version call mutates nothing — not even the outbox drain", async () => {
  // The version gate is the first thing every call settles. A caller the
  // runtime refuses must cause no side effects, and delivery of pending
  // coordinator messages is a side effect: a stale client's rejected call
  // must not advance settlement state it has no right to touch.
  const { engine } = await setup();
  const len = await engine.runtime.accessFromEvidence(evidence(LEN));
  assert.ok(!isFailed(len));

  const invite = await engine.runtime.command(cmd(
    { kind: "participation-invite", operationId: OP, organizationId: "org-invitee" },
    { kind: "access-envelope", envelope: len.envelope },
    "gate-drain-invite",
  ));
  okOf(invite);
  // the invitation is en route: delivered to nobody yet, still pending
  assert.equal(engine.invitationsOf(INVITEE_ORG).size, 0);
  assert.equal(engine.pendingOutbox(), 1);

  const stale = await engine.runtime.context({
    interfaceVersion: 99 as never,
    envelope: len.envelope,
  });
  assert.equal(failureOf(stale).kind, "wrong-interface-version");

  // the rejected call delivered nothing; the invitation is still pending
  assert.equal(engine.invitationsOf(INVITEE_ORG).size, 0, "a refused call must not deliver");
  assert.equal(engine.pendingOutbox(), 1, "the message stays pending");

  // and a valid call delivers it — deferred by the gate, not dropped
  await engine.drainOutbox();
  assert.equal(engine.invitationsOf(INVITEE_ORG).size, 1);
});

test("[A10] principal link keys cannot collide across provider/subject splits", async () => {
  // "a:b"/"c" and "a"/"b:c" concatenated with ":" are the same string. The
  // link key must encode the pair, not concatenate it — otherwise bootstrap
  // refuses one of two legitimate links, or worse, one evidence resolves
  // to the other's actor.
  const clock = fixedClock(1_700_000_000);
  const engine = await createInMemoryAuthority({
    clock,
    signer: await webCryptoSigner("key-collision"),
    fixtures: [PROFESSIONAL_OPERATION],
    principalLinks: [
      { provider: "idp:x", subject: "y", organizationId: LEN_ORG, actorId: LEN_ID },
      { provider: "idp", subject: "x:y", organizationId: MARCO_ORG, actorId: MARCO_ID },
    ],
  });
  const len = await engine.runtime.accessFromEvidence(evidence({ provider: "idp:x", subject: "y" }));
  assert.ok(!isFailed(len), "the first link issues");
  const marco = await engine.runtime.accessFromEvidence(evidence({ provider: "idp", subject: "x:y" }));
  assert.ok(!isFailed(marco), "the second link issues");
  assert.equal(len.envelope.claims.actor.actorId, LEN_ID);
  assert.equal(marco.envelope.claims.actor.actorId, MARCO_ID);
});

test("snapshotOf hands out a copy: mutating the snapshot cannot corrupt the engine", async () => {
  // The type says `readonly`, but a shared array is a runtime fact, not a
  // type fact — a caller that mutates what it was handed (or holds it while
  // the engine keeps writing) must not reach engine state.
  const { engine } = await setup();
  const before = engine.snapshotOf(OP);
  assert.ok(before !== undefined);
  const grantsBefore = before.grants.length;
  const orgsBefore = before.organizations.length;
  (before.grants as Grant[]).push({ ...before.grants[0]!, grantId: "g-forged" });
  (before.organizations as Organization[]).push(before.organizations[0]!);
  const after = engine.snapshotOf(OP);
  assert.equal(after?.grants.length, grantsBefore, "the grant list is engine-owned");
  assert.equal(after?.organizations.length, orgsBefore, "the organization list is engine-owned");
});

test("request-access keeps its note for the administrator who admits", async () => {
  // The note is the requester's one sentence to the administrator; asking
  // without it must not silently discard it. `admit` consumes the queue,
  // so the record — note included — is what the administrator reads.
  const { engine } = await setup();
  const asked = await engine.runtime.command(cmd(
    { kind: "request-access", operationId: OP, evidence: INVITEE_LEAD, note: "booth power hookup" },
    { kind: "fresh-evidence", evidence: INVITEE_LEAD, operationId: OP },
    "note-keep-ask",
  ));
  okOf(asked);
  const requests = engine.accessRequestsOf(OP);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.note, "booth power hookup");
  assert.equal(requests[0]?.actorId, INVITEE_ACTOR);
});

test("participation: revoking twice is a safe retry; revoking a non-participant is denied", async () => {
  const { engine } = await setup();
  const len = await engine.runtime.accessFromEvidence(evidence(LEN));
  assert.ok(!isFailed(len));
  const revokeCmd = (key: string, organizationId: string) => cmd(
    { kind: "participation-revoke", operationId: OP, organizationId, by: "operation" },
    { kind: "access-envelope", envelope: len.envelope },
    key,
  );

  const invite = await engine.runtime.command(cmd(
    { kind: "participation-invite", operationId: OP, organizationId: "org-invitee" },
    { kind: "access-envelope", envelope: len.envelope },
    "twice-invite",
  ));
  okOf(invite);

  okOf(await engine.runtime.command(revokeCmd("twice-1", "org-invitee")));
  // a second revoke under a fresh key is not a replay, and must still read
  // as success: the state the caller asked for is the state that holds
  const again = await engine.runtime.command(revokeCmd("twice-2", "org-invitee"));
  assert.ok(again.ok, "revoking an already-revoked participation is a safe retry");
  assert.equal(
    engine.snapshotOf(OP)?.participations.find((p) => p.organizationId === "org-invitee")?.status,
    "revoked",
  );

  // never participating is a different thing, and is refused
  const stranger = await engine.runtime.command(revokeCmd("twice-3", "org-stranger"));
  assert.ok(!stranger.ok);
  assert.equal(failureOf(stranger).kind, "denied");
});

test("participation: invite → accept → active, with a visible partial state and retry", async () => {
  const { engine } = await setup(1); // the first outbox delivery fails
  const len = await engine.runtime.accessFromEvidence(evidence(LEN));
  assert.ok(!isFailed(len));

  const invite = await engine.runtime.command(cmd(
    { kind: "participation-invite", operationId: OP, organizationId: "org-invitee" },
    { kind: "access-envelope", envelope: len.envelope },
    "invite-1",
  ));
  okOf(invite);
  // the delivery failed: the op says invited, the org has nothing yet
  assert.equal(engine.pendingOutbox(), 1);
  const before = engine.snapshotOf(OP);
  assert.equal(before?.participations.find((p) => p.organizationId === "org-invitee")?.status, "invited");
  const earlyAccept = await engine.runtime.command(cmd(
    { kind: "participation-accept", operationId: OP },
    { kind: "fresh-evidence", evidence: INVITEE_LEAD, operationId: OP },
    "accept-early",
  ));
  assert.ok(!earlyAccept.ok); // no such invitation yet — the partial state is visible

  const delivered = await engine.drainOutbox();
  assert.equal(delivered, 1);
  assert.equal(engine.invitationsOf(INVITEE_ORG).size, 1);
  const accept = await engine.runtime.command(cmd(
    { kind: "participation-accept", operationId: OP },
    { kind: "fresh-evidence", evidence: INVITEE_LEAD, operationId: OP },
    "accept-1",
  ));
  okOf(accept);
  // the acceptance ack crosses the outbox; the operation records active
  await engine.drainOutbox();
  const after = engine.snapshotOf(OP);
  assert.equal(after?.participations.find((p) => p.organizationId === "org-invitee")?.status, "active");

  // duplicate accept and second invite are both refused
  const dupAccept = await engine.runtime.command(cmd(
    { kind: "participation-accept", operationId: OP },
    { kind: "fresh-evidence", evidence: INVITEE_LEAD, operationId: OP },
    "accept-2",
  ));
  assert.ok(!dupAccept.ok);
  const secondInvite = await engine.runtime.command(cmd(
    { kind: "participation-invite", operationId: OP, organizationId: "org-invitee" },
    { kind: "access-envelope", envelope: len.envelope },
    "invite-2",
  ));
  assert.ok(!secondInvite.ok);
});

test("[A8] idempotency: retries claim their result; misuse and denials do not poison", async () => {
  const { engine } = await setup();
  const len = await engine.runtime.accessFromEvidence(evidence(LEN));
  assert.ok(!isFailed(len));

  const grantBody = {
    kind: "grant-hat", operationId: OP, organizationId: "org-2b7c41de",
    actorId: "actor-6e0d94b2", role: "reviewer", target: { kind: "team", teamId: "team-f5b3a08d" },
  } as const;
  // a denied variant first (unknown role) must not poison the key
  const denied = await engine.runtime.command(cmd(
    { ...grantBody, role: "wizard" }, { kind: "access-envelope", envelope: len.envelope }, "grant-key-1",
  ));
  assert.equal(denied.ok, false);
  assert.equal(failureOf(denied).kind, "invalid-command");
  const applied = await engine.runtime.command(cmd(
    { ...grantBody }, { kind: "access-envelope", envelope: len.envelope }, "grant-key-1",
  ));
  assert.ok(applied.ok && applied.receipt.applied);
  const retry = await engine.runtime.command(cmd(
    { ...grantBody }, { kind: "access-envelope", envelope: len.envelope }, "grant-key-1",
  ));
  assert.ok(retry.ok && !retry.receipt.applied); // safe replay
  const misuse = await engine.runtime.command(cmd(
    { ...grantBody, role: "field" }, { kind: "access-envelope", envelope: len.envelope }, "grant-key-1",
  ));
  assert.ok(!misuse.ok);
  assert.equal(failureOf(misuse).kind, "invalid-command");
});

test("[A9] authorization: administration is policy, not a hardcoded role", async () => {
  const { engine } = await setup();
  const dana = await engine.runtime.accessFromEvidence(evidence(DANA));
  assert.ok(!isFailed(dana));
  // Dana (coordinator, not an administrator of Meridian) cannot grant hats
  const denied = await engine.runtime.command(cmd(
    { kind: "grant-hat", operationId: OP, organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR, role: "field", target: { kind: "team", teamId: "team-2e8c64b9" } },
    { kind: "access-envelope", envelope: dana.envelope },
    "dana-grant",
  ));
  assert.ok(!denied.ok);
  assert.equal(failureOf(denied).kind, "denied");
  // and a caller with the wrong interface version learns it immediately
  const stale = await engine.runtime.command({
    interfaceVersion: 99 as never, idempotencyKey: "stale",
    authorization: { kind: "access-envelope", envelope: dana.envelope },
    kind: "grant-hat", operationId: OP, organizationId: HARBOR_LOGISTICS,
    actorId: DANA_OKAFOR, role: "field", target: { kind: "team", teamId: "team-2e8c64b9" },
  });
  assert.ok(!stale.ok);
  assert.equal(failureOf(stale).kind, "wrong-interface-version");
});

test("authorization: an undeclared admin role grants nothing by default", async () => {
  // The engine used to fall back to `["admin"]` when a deployment declared
  // no admin role for an operation, so a hat titled "admin" administered an
  // operation nobody had said it administered. Administration is
  // configuration; an undeclared set is empty, not a hardcoded title.
  const clock = fixedClock(1_700_000_000);
  const signer = await webCryptoSigner("key-admin-default");
  const policy = {
    ...PROFESSIONAL_OPERATION.policy,
    actions: ["observe", "review"],
    roles: [{ title: "admin", actions: ["observe", "review"] }],
  };
  const titled: TwinFixture = {
    name: "professional",
    policy,
    snapshot: fixtureSnapshot({
      operations: [{ operationId: "op-titled" }],
      organizations: [{ organizationId: "org-titled" }],
      actors: [{ organizationId: "org-titled", actorId: "actor-titled" }],
      sites: [{ siteId: "site-titled", operationId: "op-titled", aliases: [] }],
      teams: [{ teamId: "team-titled", siteId: "site-titled", organizationId: "org-titled" }],
      grants: [{
        grantId: "g-titled",
        operationId: "op-titled",
        organizationId: "org-titled",
        actorId: "actor-titled",
        role: "admin",
        target: { kind: "team", teamId: "team-titled" },
        primary: true,
      }],
      participations: [{ organizationId: "org-titled", operationId: "op-titled", status: "active" }],
    }),
  };
  const engine = await createInMemoryAuthority({
    clock,
    signer,
    fixtures: [titled],
    principalLinks: [
      { provider: "test-idp", subject: "titled", organizationId: TITLED_ORG, actorId: TITLED_ACTOR },
    ],
    // deliberately no adminRoles, and the role carries no configure action
  });
  const issued = await engine.runtime.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: TITLED_OP,
    evidence: { provider: "test-idp", subject: "titled" },
  });
  assert.ok(!isFailed(issued));
  assert.equal(issued.envelope.claims.hat.role, "admin");

  const attempt = await engine.runtime.command(cmd(
    { kind: "grant-hat", operationId: "op-titled", organizationId: "org-titled", actorId: "actor-titled", role: "admin", target: { kind: "team", teamId: "team-titled" } },
    { kind: "access-envelope", envelope: issued.envelope },
    "titled-grant",
  ));
  assert.ok(!attempt.ok, "a hat titled admin does not administer an operation by title alone");
  assert.equal(failureOf(attempt).kind, "denied");
});

test("[A15] request-access and admit: asking is not being admitted", async () => {
  const { engine } = await setup();
  const len = await engine.runtime.accessFromEvidence(evidence(LEN));
  assert.ok(!isFailed(len));
  const newcomer: PrincipalEvidence = { provider: "test-idp", subject: "newcomer" };
  // no principal link: the request itself is unauthenticated — links are explicit
  const orphan = await engine.runtime.command(cmd(
    { kind: "request-access", operationId: OP, evidence: newcomer },
    { kind: "fresh-evidence", evidence: newcomer, operationId: OP },
    "req-orphan",
  ));
  assert.equal(orphan.ok, false);
  assert.equal(failureOf(orphan).kind, "unauthenticated");

  // a linked principal can ask; the request is recorded, not admission
  const request = await engine.runtime.command(cmd(
    { kind: "request-access", operationId: OP, evidence: INVITEE_LEAD },
    { kind: "fresh-evidence", evidence: INVITEE_LEAD, operationId: OP },
    "req-invitee",
  ));
  okOf(request);
  const beforeAdmit = await engine.runtime.accessFromEvidence(evidence(INVITEE_LEAD));
  assert.ok(isFailed(beforeAdmit));
  assert.equal(failureOf(beforeAdmit).kind, "not-admitted", "asking did not admit");

  // admission is a separate, administrator act
  const admitted = await engine.runtime.command(cmd(
    { kind: "admit", operationId: OP, organizationId: "org-invitee", actorId: "actor-inv-lead" },
    { kind: "access-envelope", envelope: len.envelope },
    "admit-invitee",
  ));
  okOf(admitted);
});

test("select-hat: an actor selects their own hat; a stranger cannot", async () => {
  const { engine } = await setup();
  const marco = await engine.runtime.accessFromEvidence(evidence(MARCO));
  assert.ok(!isFailed(marco));
  const self = await engine.runtime.command(cmd(
    { kind: "select-hat", operationId: OP, grantId: "g-mer-2" },
    { kind: "fresh-evidence", evidence: MARCO, operationId: OP },
    "marco-select",
  ));
  okOf(self);
  const stranger = await engine.runtime.command(cmd(
    { kind: "select-hat", operationId: OP, grantId: "g-mer-3" },
    { kind: "fresh-evidence", evidence: MARCO, operationId: OP },
    "marco-stranger",
  ));
  assert.ok(!stranger.ok);
  assert.equal(failureOf(stranger).kind, "denied");
});

test("select-hat: a revoked or non-wearable grant cannot be selected", async () => {
  const clock = fixedClock(1_700_000_000);
  const signer = await webCryptoSigner("key-select");
  const op = "op-select";
  const org = organizationId("org-select");
  const actor = actorId("actor-select");
  const fixture: TwinFixture = {
    name: "professional",
    policy: PROFESSIONAL_OPERATION.policy,
    snapshot: fixtureSnapshot({
      operations: [{ operationId: op }],
      organizations: [{ organizationId: "org-select" }],
      actors: [{ organizationId: "org-select", actorId: "actor-select" }],
      sites: [{ siteId: "site-select", operationId: op, aliases: [] }],
      teams: [{ teamId: "team-select", siteId: "site-select", organizationId: "org-select" }],
      grants: [
        {
          grantId: "g-select-active", operationId: op, organizationId: "org-select",
          actorId: "actor-select", role: "field",
          target: { kind: "team", teamId: "team-select" }, primary: true,
        },
        {
          grantId: "g-select-revoked", operationId: op, organizationId: "org-select",
          actorId: "actor-select", role: "reviewer",
          target: { kind: "team", teamId: "team-select" }, revoked: true,
        },
      ],
      participations: [{ organizationId: "org-select", operationId: op, status: "active" }],
    }),
  };
  const engine = await createInMemoryAuthority({
    clock,
    signer,
    fixtures: [fixture],
    principalLinks: [
      { provider: "test-idp", subject: "select", organizationId: org, actorId: actor },
    ],
  });
  const auth = {
    kind: "fresh-evidence" as const,
    evidence: { provider: "test-idp", subject: "select" },
    operationId: op,
  };
  const revoked = await engine.runtime.command(cmd(
    { kind: "select-hat", operationId: op, grantId: "g-select-revoked" },
    auth,
    "select-revoked",
  ));
  assert.ok(!revoked.ok);
  assert.equal(failureOf(revoked).kind, "denied");
  const active = await engine.runtime.command(cmd(
    { kind: "select-hat", operationId: op, grantId: "g-select-active" },
    auth,
    "select-active",
  ));
  okOf(active);
});

test("[E8] command and context use the envelope version gate, not just the signature", async () => {
  const { engine } = await setup();
  const issued = await engine.runtime.accessFromEvidence(evidence(DANA));
  assert.ok(!isFailed(issued));
  const wrongEnvelope = { ...issued.envelope, v: 2 as never };
  const command = await engine.runtime.command(cmd(
    { kind: "select-hat", operationId: OP, grantId: "g-mer-3" },
    { kind: "access-envelope", envelope: wrongEnvelope },
    "bad-envelope-version",
  ));
  assert.ok(!command.ok);
  assert.equal(failureOf(command).kind, "wrong-interface-version");

  const wrongClaims = {
    ...issued.envelope,
    claims: { ...issued.envelope.claims, v: 2 as never },
  };
  const context = await engine.runtime.context({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    envelope: wrongClaims,
  });
  assert.ok(isFailed(context));
  assert.equal(failureOf(context).kind, "wrong-interface-version");
});

test("[E4][E7] context and commands refuse signed claims without expiry", async (t) => {
  const { engine, signer } = await setup();
  const issued = successOf(await engine.runtime.accessFromEvidence(evidence(DANA)));
  const { exp: _exp, ...claims } = issued.envelope.claims;
  const envelope = {
    ...issued.envelope,
    claims: claims as never,
    signature: await signer.sign(canonicalJson(asJson(claims))),
  };
  await t.test("context", async () => {
    const result = await engine.runtime.context({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      envelope,
    });
    assert.equal(failureOf(result).kind, "unauthenticated");
  });
  await t.test("command", async () => {
    const result = await engine.runtime.command(cmd(
      { kind: "select-hat", operationId: OP, grantId: "g-mer-3" },
      { kind: "access-envelope", envelope },
      "missing-expiry",
    ));
    assert.equal(failureOf(result).kind, "unauthenticated");
  });
});

test("[E4] command authorization refuses a malformed envelope as a value, never a throw", async () => {
  // The command path reads `authorization.envelope.claims` as it authorizes,
  // so the version gate has to refuse a non-object envelope and an absent
  // claims payload before any field is touched. A host decoding a bearer
  // cookie into JSON supplies exactly these shapes.
  const { engine } = await setup();
  // Labelled rather than stringified: the deep case is the idempotency key and
  // the assertion message too, and serializing it would overflow the stack in
  // the test itself.
  const deep = (() => {
    let node: unknown = 1;
    for (let i = 0; i < 5_000; i += 1) node = { a: node };
    return { format: "org-hats.access", v: 1, claims: { v: 1, deep: node }, keyId: "k", signature: "x" };
  })();
  const cases: readonly (readonly [string, unknown, string])[] = [
    ["null", null, "unauthenticated"],
    ["undefined", undefined, "unauthenticated"],
    ["a string", "envelope", "unauthenticated"],
    ["no claims", { format: "org-hats.access", v: 1 }, "unauthenticated"],
    ["an empty object", {}, "wrong-interface-version"],
    // deeper than the format's bound; the gate gets there before the
    // canonicalization that used to overflow the stack
    ["claims past the depth bound", deep, "unauthenticated"],
  ];
  for (const [label, envelope, kind] of cases) {
    const command = await engine.runtime.command(cmd(
      { kind: "select-hat", operationId: OP, grantId: "g-mer-3" },
      { kind: "access-envelope", envelope: envelope as never },
      `malformed-${label}`,
    ));
    assert.ok(!command.ok, `${label} must fail as a value`);
    assert.equal(failureOf(command).kind, kind, label);
  }
});

test("[A1] an organization revokes its own participation and its actors stop being admitted", async () => {
  const { engine } = await setup();
  const before = await engine.runtime.accessFromEvidence(evidence(DANA));
  assert.ok(!isFailed(before), "Harbor's administrator is admitted while participating");

  const revoked = await engine.runtime.command({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    idempotencyKey: "org-side-participation-revoke",
    authorization: { kind: "fresh-evidence", ...evidence(DANA), },
    kind: "participation-revoke",
    operationId: OP,
    organizationId: HARBOR_LOGISTICS,
    by: "organization",
  });
  assert.ok(revoked.ok && revoked.receipt.applied, "the organization-side revoke succeeds");

  const after = await engine.runtime.accessFromEvidence(evidence(DANA));
  assert.ok(isFailed(after));
  assert.equal(failureOf(after).kind, "not-admitted", "admission dies with the participation");
});

test("the closed taxonomy survives an untyped host", async () => {
  const { engine } = await setup();
  const result = await engine.runtime.command({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    idempotencyKey: "unknown-kind",
    authorization: { kind: "fresh-evidence", ...evidence(DANA) },
    kind: "merge-team",
  } as never);
  assert.ok(isFailed(result));
  assert.equal(failureOf(result).kind, "invalid-command", "an unknown kind fails closed, never throws");
});

test("boot refuses a principal link to an actor the fixtures do not declare", async () => {
  await assert.rejects(
    createInMemoryAuthority({
      clock: fixedClock(1_700_000_000),
      signer: await webCryptoSigner("unknown-link-test"),
      fixtures: [PROFESSIONAL_OPERATION],
      principalLinks: [{
        provider: "idp",
        subject: "ghost",
        organizationId: HARBOR_LOGISTICS,
        actorId: actorId("actor-ghost"),
      }],
    }),
    /principal link names an unknown actor/,
  );
});

test("the short name is a second display label, carried to the exported snapshot", async () => {
  // A short form is not computable from a long one, so it is stored, not
  // derived. It is presentation only — the same footing as `displayName`,
  // bootstrap-set, never read by a decision — and the operator's long form
  // carries no parenthetical: a host composes "Long (SHORT)" from the two
  // fields, so one name has one place to edit it.
  const labelled: TwinFixture = {
    name: "professional",
    policy: PROFESSIONAL_OPERATION.policy,
    snapshot: fixtureSnapshot({
      operations: [{ operationId: "op-labelled", longName: "Porsche Experience Centers", shortName: "PEC" }],
      organizations: [{ organizationId: "org-labelled", longName: "AMCI Global", shortName: "AMCI" }],
      actors: [{ organizationId: "org-labelled", actorId: "actor-labelled" }],
      sites: [
        { siteId: "site-atl", operationId: "op-labelled", longName: "Atlanta, GA", shortName: "PEC-ATL", aliases: [] },
        { siteId: "site-bare", operationId: "op-labelled", aliases: [] },
      ],
      teams: [{ teamId: "team-labelled", siteId: "site-atl", organizationId: "org-labelled" }],
      grants: [],
      participations: [{ organizationId: "org-labelled", operationId: "op-labelled", status: "active" }],
    }),
  };
  const engine = await createInMemoryAuthority({
    clock: fixedClock(1_700_000_000),
    signer: await webCryptoSigner("key-short-name"),
    fixtures: [labelled],
  });
  const snapshot = engine.snapshotOf(operationId("op-labelled"));
  assert.ok(snapshot !== undefined);

  const operation = snapshot.operations.find((o) => o.operationId === "op-labelled");
  assert.equal(operation?.longName, "Porsche Experience Centers", "the long form stores without the parenthetical");
  assert.equal(operation?.shortName, "PEC");
  const organization = snapshot.organizations.find((o) => o.organizationId === "org-labelled");
  assert.equal(organization?.longName, "AMCI Global");
  assert.equal(organization?.shortName, "AMCI");
  const site = snapshot.sites.find((s) => s.siteId === "site-atl");
  assert.equal(site?.longName, "Atlanta, GA");
  assert.equal(site?.shortName, "PEC-ATL");

  // Absent is absent: an unset short name is not an empty string and not a
  // fallback to the id or the long form, so a host decides what to show.
  const bare = snapshot.sites.find((s) => s.siteId === "site-bare");
  assert.equal(bare?.shortName, undefined);
  assert.ok(!("shortName" in (bare ?? {})), "an unset short name is absent, not undefined-valued");
});

test("a team carries the pair, and `update-team` writes both labels in one act", async () => {
  // A team label is the one rendered most times per page and in the densest
  // slots, so a host needs the short form it cannot derive. The pair arrives
  // on a team's terms, not the other three's: a team is the only one of these
  // with a write path, so the labels are set at request and edited after.
  //
  // Both fields are required in `update-team`, the consumer's choice: its
  // client is a full-form page that submits every field, so absent-means-
  // unchanged would buy nothing, and the remedy for concurrent editing it
  // would actually want is optimistic concurrency, which no command shape
  // provides.
  const paired: TwinFixture = {
    name: "professional",
    policy: PROFESSIONAL_OPERATION.policy,
    snapshot: fixtureSnapshot({
      operations: [{ operationId: "op-team-pair", longName: "Team Pair", shortName: "TP" }],
      organizations: [{ organizationId: "org-team-pair", longName: "Pair Works" }],
      actors: [{ organizationId: "org-team-pair", actorId: "actor-pair" }],
      sites: [{ siteId: "site-pair", operationId: "op-team-pair", aliases: [] }],
      teams: [
        {
          teamId: "team-paired",
          siteId: "site-pair",
          organizationId: "org-team-pair",
          longName: "Atlanta Floor Operations",
          shortName: "ATL-FLOOR",
        },
        { teamId: "team-bare", siteId: "site-pair", organizationId: "org-team-pair", longName: "No Short Form" },
      ],
      grants: [],
      participations: [{ organizationId: "org-team-pair", operationId: "op-team-pair", status: "active" }],
    }),
  };
  const engine = await createInMemoryAuthority({
    clock: fixedClock(1_700_000_000),
    signer: await webCryptoSigner("key-team-pair"),
    fixtures: [paired],
  });
  const snapshot = engine.snapshotOf(operationId("op-team-pair"));
  assert.ok(snapshot !== undefined);

  const team = snapshot.teams.find((t) => t.teamId === "team-paired");
  assert.equal(team?.longName, "Atlanta Floor Operations");
  assert.equal(team?.shortName, "ATL-FLOOR");

  // The same absence rule as the other three: unset is absent, never the id
  // and never a truncation of the long form.
  const bare = snapshot.teams.find((t) => t.teamId === "team-bare");
  assert.equal(bare?.longName, "No Short Form");
  assert.ok(!("shortName" in (bare ?? {})), "an unset team short name is absent");
});

// --- Ownership of the in-memory world and snapshots ------------------------
//
// A readonly type is not a runtime fact. The engine must own what it keeps:
// fixture data handed in at construction (the world) and the objects inside
// a snapshot handed out (nested copies, not shared references). These
// regressions were proven red first: a site alias pushed into the fixture
// after construction appeared in later snapshots, a granted action pushed
// into the fixture's policy widened the issued hat, and a `revoked` flip
// through a mutable structural type on a returned grant reached engine
// state.

test("the engine owns the world: fixture mutation after construction cannot change engine state", async () => {
  const OWN_OP = "op-own-fixture";
  const OWN_ORG = "org-own-fixture";
  const OWN_ACTOR = "actor-own-fixture";
  // a local, deliberately mutable policy and snapshot: the engine must copy
  // them on ingress, not retain them
  const policy = {
    format: 1 as const,
    id: "policy-own",
    version: "1",
    actions: ["observe"],
    roles: [{ title: "field", actions: ["observe"] }],
    readPolicy: { organizations: "granted-teams" as const },
  };
  const snapshot = fixtureSnapshot({
    operations: [{ operationId: OWN_OP }],
    organizations: [{ organizationId: OWN_ORG }],
    actors: [{ organizationId: OWN_ORG, actorId: OWN_ACTOR }],
    sites: [{ siteId: "site-own", operationId: OWN_OP, aliases: ["own"] }],
    teams: [{ teamId: "team-own", siteId: "site-own", organizationId: OWN_ORG }],
    grants: [{
      grantId: "g-own", operationId: OWN_OP, organizationId: OWN_ORG,
      actorId: OWN_ACTOR, role: "field",
      target: { kind: "team", teamId: "team-own" }, primary: true,
    }],
    participations: [{ organizationId: OWN_ORG, operationId: OWN_OP, status: "active" }],
  });
  const engine = await createInMemoryAuthority({
    clock: fixedClock(1_700_000_000),
    signer: await webCryptoSigner("key-own"),
    fixtures: [{ name: "own", policy, snapshot }],
    principalLinks: [{ provider: "idp", subject: "own", organizationId: OWN_ORG as never, actorId: OWN_ACTOR as never }],
  });

  // the caller keeps its mutable references and changes them afterwards
  (policy.roles[0] as { actions: string[] }).actions.push("forged-action");
  (snapshot.sites[0] as unknown as { aliases: string[] }).aliases.push("forged-alias");

  const world = engine.snapshotOf(OWN_OP as never);
  assert.ok(world !== undefined);
  assert.deepEqual(world.sites[0]?.aliases, ["own"], "site aliases are copied on ingress");

  const issued = await engine.runtime.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: OWN_OP,
    evidence: { provider: "idp", subject: "own" },
  });
  const claims = successOf(issued).envelope.claims;
  assert.deepEqual(claims.hat.actions, ["observe"], "the policy bundle is copied on ingress");
});

test("snapshotOf hands out nested copies: grant, site, and participation objects cannot corrupt the engine", async () => {
  const { engine } = await setup();
  const before = engine.snapshotOf(OP);
  assert.ok(before !== undefined);
  const grant = before.grants.find((g) => g.revoked !== true);
  assert.ok(grant !== undefined);
  // the documented hole: a readonly grant assigned to a mutable structural
  // type flips `revoked` on the object the engine still holds
  (grant as { revoked?: boolean }).revoked = true;
  const site = before.sites[0];
  assert.ok(site !== undefined);
  (site.aliases as string[]).push("forged-alias");
  const participation = before.participations.find((p) => p.status === "active");
  assert.ok(participation !== undefined);
  (participation as { status: string }).status = "revoked";

  const after = engine.snapshotOf(OP);
  assert.ok(after !== undefined);
  assert.equal(after.grants.find((g) => g.grantId === grant.grantId)?.revoked, undefined,
    "a returned grant is engine-owned");
  assert.ok(!after.sites[0]?.aliases.includes("forged-alias"),
    "a returned site's aliases are engine-owned");
  assert.equal(after.participations.find((p) => p.organizationId === participation.organizationId)?.status, "active",
    "a returned participation is engine-owned");
});
