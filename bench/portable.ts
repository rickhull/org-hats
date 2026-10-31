// Opt-in in-memory benchmark. Not a gate: run it when a change claims a
// performance improvement, and record the before/after numbers with the
// change. `BENCH_ITERATIONS` overrides the sample count.

import {
  AUTHORITY_INTERFACE_VERSION,
  isFailed,
  operationId,
} from "../src/contract.ts";
import { ed25519VerifyKey, verify } from "../src/access/verify.ts";
import { createInMemoryAuthority } from "../src/authority/engine.ts";
import { fixedClock, webCryptoSigner } from "../src/authority/internal.ts";
import { CONFORMANCE_PRINCIPALS, CONFORMANCE_WORLD } from "../src/conformance.ts";

const OP = operationId("op-9f2e6ad4");
const DANA = CONFORMANCE_PRINCIPALS.dana;
const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 100);
const WARMUP = Math.min(10, ITERATIONS);

interface Reading {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly opsPerSecond: number;
}

const summarize = (samples: readonly number[]): Reading => {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  return {
    medianMs: Number(median.toFixed(4)),
    p95Ms: Number(p95.toFixed(4)),
    opsPerSecond: Number((1000 / median).toFixed(1)),
  };
};

const measure = async (run: () => Promise<unknown>): Promise<Reading> => {
  for (let i = 0; i < WARMUP; i++) await run();
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const started = performance.now();
    await run();
    samples.push(performance.now() - started);
  }
  return summarize(samples);
};

const setup = async () => {
  const engine = await createInMemoryAuthority({
    ...CONFORMANCE_WORLD,
    clock: fixedClock(1_700_000_000),
    signer: await webCryptoSigner("bench-portable"),
  });
  return engine;
};

const issue = async (engine: Awaited<ReturnType<typeof setup>>) => {
  const result = await engine.runtime.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: OP,
    evidence: DANA.evidence,
  });
  if (isFailed(result)) throw new Error(`issuance failed: ${result.failure.kind}`);
  return result;
};

const main = async (): Promise<void> => {
  const issueEngine = await setup();
  const issueReading = await measure(() => issue(issueEngine));

  const refreshEngine = await setup();
  let handle = (await issue(refreshEngine)).refresh;
  if (handle.kind !== "rotated") throw new Error(`unexpected refresh outcome: ${handle.kind}`);
  let current = handle.handle;
  const refreshReading = await measure(async () => {
    const result = await refreshEngine.runtime.refresh({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: OP,
      handle: current,
    });
    if (isFailed(result) || result.refresh.kind !== "rotated") {
      throw new Error("refresh did not rotate");
    }
    current = result.refresh.handle;
  });

  const contextEngine = await setup();
  const envelope = (await issue(contextEngine)).envelope;
  const contextReading = await measure(() => contextEngine.runtime.context({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    envelope,
  }));

  const verifyEngine = await setup();
  const verifiedEnvelope = (await issue(verifyEngine)).envelope;
  const material = await verifyEngine.verificationKey();
  const key = await ed25519VerifyKey(material.keyId, material.publicKey);
  const keys = new Map([[key.keyId, key]]);
  const verifyReading = await measure(() => verify(verifiedEnvelope, keys, {
    now: verifiedEnvelope.claims.iat + 1,
  }));

  console.log(JSON.stringify({
    runtime: "in-memory",
    iterations: ITERATIONS,
    results: {
      issue: issueReading,
      refresh: refreshReading,
      context: contextReading,
      verify: verifyReading,
    },
  }, null, 2));
};

await main();
