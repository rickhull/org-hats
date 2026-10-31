// Interleavings at the portable seam. The single-threaded engine still yields
// at signature and digest work; these tests pin the bounds A7 and A13 state:
// a revocation that commits during issuance or refresh may let one envelope
// out, but the handle it leaves behind cannot rotate again.

import test from "node:test";
import assert from "node:assert/strict";

import { AUTHORITY_INTERFACE_VERSION, operationId } from "../src/contract.ts";
import { CONFORMANCE_PRINCIPALS, CONFORMANCE_WORLD } from "../src/conformance.ts";
import { fixedClock, webCryptoSigner, type Signer } from "../src/authority/internal.ts";
import { buildCommand, createTestEngine, failureOf, freshAuth, handleOf, okOf, successOf } from "./helpers.ts";

const OP = operationId("op-9f2e6ad4");
const HARBOR = CONFORMANCE_PRINCIPALS.dana.organizationId;
const SAM_ENTRY = CONFORMANCE_PRINCIPALS.sam;
const SAM = SAM_ENTRY.actorId;
const ADMIN = CONFORMANCE_PRINCIPALS.dana;
const LEN = CONFORMANCE_PRINCIPALS.len;

/**
 * A signer whose next `sign` stops after the claims are built. The gate is
 * armed per interleaving, so issuance and refresh can be paused exactly
 * between the authority read and the signature that publishes its result.
 */
interface SignGate {
  readonly signer: Signer;
  arm(): void;
  waitForSign(): Promise<void>;
  release(): void;
}

const gatedSigner = async (): Promise<SignGate> => {
  const base = await webCryptoSigner("concurrency-test");
  let armed = false;
  let entered = Promise.resolve();
  let enter: (() => void) | undefined;
  let releaseCurrent: (() => void) | undefined;

  return {
    signer: {
      ...base,
      sign: async (payload) => {
        if (!armed) return base.sign(payload);
        armed = false;
        const blocked = new Promise<void>((resolve) => {
          releaseCurrent = resolve;
        });
        enter?.();
        await blocked;
        return base.sign(payload);
      },
    },
    arm: () => {
      armed = true;
      entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
    },
    waitForSign: () => entered,
    release: () => {
      releaseCurrent?.();
      releaseCurrent = undefined;
    },
  };
};

const setup = async () => {
  const gate = await gatedSigner();
  const engine = await createTestEngine({
    ...CONFORMANCE_WORLD,
    clock: fixedClock(1_700_000_000),
    signer: gate.signer,
  });
  const admin = successOf(await engine.runtime.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: OP,
    evidence: LEN.evidence,
  }));
  const target = successOf(await engine.runtime.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: OP,
    evidence: SAM_ENTRY.evidence,
  }));
  return {
    engine,
    gate,
    handle: handleOf(target.refresh),
    adminAuth: { kind: "access-envelope" as const, envelope: admin.envelope },
  };
};

const refresh = (
  engine: Awaited<ReturnType<typeof setup>>["engine"],
  handle: string,
) => engine.runtime.refresh({ interfaceVersion: AUTHORITY_INTERFACE_VERSION, operationId: OP, handle });

const fresh = () => freshAuth(ADMIN.evidence, OP);

const cmd = buildCommand;

test("[A13] a disable drained during refresh leaves no usable handle", async () => {
  const { engine, gate, handle } = await setup();
  gate.arm();
  const inFlight = refresh(engine, handle);
  await gate.waitForSign();

  okOf(await engine.runtime.command(cmd(
    { kind: "disable-actor", organizationId: HARBOR, actorId: SAM },
    fresh(),
    "race-disable-drained",
  )));
  await engine.drainOutbox();
  gate.release();

  // A7 allows the envelope already under construction out. The handle it
  // installs was minted after the disable notice drained, so the A13 read —
  // not the record — is what must refuse the next rotation.
  const issued = successOf(await inFlight);
  const next = await refresh(engine, handleOf(issued.refresh));
  assert.equal(failureOf(next).kind, "not-admitted");
  assert.match(failureOf(next).detail ?? "", /disabled/);
});

test("[A7] a pending disable notice revokes a handle issued during the race", async () => {
  const { engine, gate, handle } = await setup();
  gate.arm();
  const inFlight = refresh(engine, handle);
  await gate.waitForSign();

  okOf(await engine.runtime.command(cmd(
    { kind: "disable-actor", organizationId: HARBOR, actorId: SAM },
    fresh(),
    "race-disable-pending",
  )));
  gate.release();

  const issued = successOf(await inFlight);
  // The next call drains the notice first; it revokes every matching record,
  // including the one the in-flight refresh added after the disable.
  const next = await refresh(engine, handleOf(issued.refresh));
  assert.equal(failureOf(next).kind, "unauthenticated");
  assert.match(failureOf(next).detail ?? "", /revoked/);
});

test("[A7] an unlink drained during refresh leaves no usable handle", async () => {
  const { engine, gate, handle } = await setup();
  gate.arm();
  const inFlight = refresh(engine, handle);
  await gate.waitForSign();

  okOf(await engine.runtime.command(cmd(
    { kind: "unlink-principal", organizationId: HARBOR, actorId: SAM },
    fresh(),
    "race-unlink",
  )));
  await engine.drainOutbox();
  gate.release();

  const issued = successOf(await inFlight);
  const next = await refresh(engine, handleOf(issued.refresh));
  assert.equal(failureOf(next).kind, "unauthenticated");
  assert.match(failureOf(next).detail ?? "", /no principal link/);
});

test("[A7] a participation revoke during refresh leaves no usable handle", async () => {
  const { engine, gate, handle } = await setup();
  gate.arm();
  const inFlight = refresh(engine, handle);
  await gate.waitForSign();

  okOf(await engine.runtime.command(cmd(
    { kind: "participation-revoke", operationId: OP, organizationId: HARBOR, by: "organization" },
    fresh(),
    "race-participation-revoke",
  )));
  gate.release();

  const issued = successOf(await inFlight);
  const next = await refresh(engine, handleOf(issued.refresh));
  assert.equal(failureOf(next).kind, "not-admitted");
});

test("[A7] a grant revoke during refresh leaves no usable handle", async () => {
  const { engine, gate, handle, adminAuth } = await setup();
  gate.arm();
  const inFlight = refresh(engine, handle);
  await gate.waitForSign();

  okOf(await engine.runtime.command(cmd(
    { kind: "revoke-grant", operationId: OP, grantId: "g-mer-4" },
    adminAuth,
    "race-revoke-grant",
  )));
  gate.release();

  const issued = successOf(await inFlight);
  const next = await refresh(engine, handleOf(issued.refresh));
  assert.equal(failureOf(next).kind, "not-admitted");
});

test("[A7] one handle cannot rotate twice under concurrent refreshes", async () => {
  const { engine, gate, handle } = await setup();
  gate.arm();
  const first = refresh(engine, handle);
  await gate.waitForSign();

  // The first refresh already consumed the handle before it reached the
  // signature; a second caller must lose rather than install a second chain.
  const second = await refresh(engine, handle);
  assert.equal(failureOf(second).kind, "unauthenticated");
  assert.match(failureOf(second).detail ?? "", /superseded/);

  gate.release();
  const winner = successOf(await first);
  assert.ok(handleOf(winner.refresh));
});

test("[A7] issuance racing a grant revoke may issue one envelope, then stops", async () => {
  const { engine, gate, adminAuth } = await setup();
  gate.arm();
  const inFlight = engine.runtime.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: OP,
    evidence: SAM_ENTRY.evidence,
  });
  await gate.waitForSign();

  okOf(await engine.runtime.command(cmd(
    { kind: "revoke-grant", operationId: OP, grantId: "g-mer-4" },
    adminAuth,
    "race-issue-revoke",
  )));
  gate.release();

  const issued = successOf(await inFlight);
  assert.equal(issued.envelope.claims.hat.role, "field", "the envelope was built before the revoke");
  const next = await refresh(engine, handleOf(issued.refresh));
  assert.equal(failureOf(next).kind, "not-admitted");
});
