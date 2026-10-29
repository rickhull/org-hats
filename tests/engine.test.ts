// The in-memory authority engine — issuance, refresh outcomes, the
// participation workflow with visible partial states and retry, command
// idempotency and authorization, and the bounded revocation window.

import test from "node:test";
import assert from "node:assert/strict";

import { actorId, canonicalJson, isFailed, operationId, organizationId, siteId, teamId } from "../src/contract.ts";
import type { TwinFixture } from "../src/authority/twins.ts";
import type { Grant, Organization } from "../src/model.ts";
import {
  DANA_OKAFOR,
  FESTIVAL,
  HARBOR_LOGISTICS,
  PROFESSIONAL_OPERATION,
} from "../src/authority/twins.ts";
import type { AuthorityCommand, PrincipalEvidence } from "../src/authority/types.ts";
import { AUTHORITY_INTERFACE_VERSION } from "../src/authority/types.ts";
import { createInMemoryAuthority } from "../src/authority/engine.ts";
import { fixedClock, webCryptoSigner } from "../src/authority/internal.ts";
import { asJson, failureOf, fixtureSnapshot, successOf, handleOf, okOf, type CommandBody } from "./helpers.ts";

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
    operations: [{ operationId: "op-dummy", displayName: "Dummy Home Op" }],
    organizations: [{ organizationId: "org-invitee", displayName: "Cedar Works" }],
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

const cmd = (body: CommandBody, authorization: AuthorityCommand["authorization"], key: string): AuthorityCommand => ({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  idempotencyKey: key,
  authorization,
  ...body,
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

test("issuance failures: unknown evidence, actor without admission", async () => {
  const { engine } = await setup();
  const unknown = await engine.runtime.accessFromEvidence(evidence({ provider: "test-idp", subject: "nobody" }));
  assert.equal(failureOf(unknown).kind, "unauthenticated");
  // Iris belongs to the festival, not Meridian
  const iris = await engine.runtime.accessFromEvidence(evidence({ provider: "test-idp", subject: "iris" }));
  assert.equal(failureOf(iris).kind, "unauthenticated"); // no principal link at all
  const wrongOp = await engine.runtime.accessFromEvidence(evidence(DANA, "op-nonesuch"));
  assert.equal(failureOf(wrongOp).kind, "wrong-binding");
});

test("refresh: rotation with explicit outcomes; a superseded handle is dead", async () => {
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

test("amr and auth_time: copied from evidence, preserved through refresh, surfaced in context", async () => {
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

test("the bounded window: a revoked grant kills refresh, not the live envelope", async () => {
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

test("disable-actor: issuance stops immediately; the outbox revokes refresh records", async () => {
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

test("principal link keys cannot collide across provider/subject splits", async () => {
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

test("idempotency: retries claim their result; misuse and denials do not poison", async () => {
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

test("authorization: administration is policy, not a hardcoded role", async () => {
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

test("request-access and admit: asking is not being admitted", async () => {
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

test("command and context use the envelope version gate, not just the signature", async () => {
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
