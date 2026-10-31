// Opt-in workerd benchmark. It uses the same public runtime and real Durable
// Objects as the gate, but is run explicitly through vitest.bench.config.ts.
// Latency numbers are medians over the sample; SQL counts are statements per
// representative call, measured by wrapping the coordinators' exec method.

import { env, runInDurableObject } from "cloudflare:test";
import { verify } from "org-hats/access";
import {
  AUTHORITY_INTERFACE_VERSION,
  isFailed,
  type AuthorityCommand,
} from "org-hats/authority";
import { CONFORMANCE_PRINCIPALS } from "org-hats/conformance";
import { expect, it } from "vitest";
import { createCloudflareConformanceWorld } from "../src/conformance";

const OP = "op-9f2e6ad4";
const HARBOR = "org-4c1f9a2e";
const DANA = CONFORMANCE_PRINCIPALS.dana;
const SAM = CONFORMANCE_PRINCIPALS.sam;
const LEN = CONFORMANCE_PRINCIPALS.len;
const ITERATIONS = 50;
const WARMUP = 5;

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

const measure = async (run: () => Promise<unknown>, batch = 1): Promise<Reading> => {
  for (let i = 0; i < WARMUP; i++) await run();
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const started = performance.now();
    for (let b = 0; b < batch; b++) await run();
    samples.push((performance.now() - started) / batch);
  }
  return summarize(samples);
};

interface SqlCounter {
  operation: number;
  organization: number;
}

const counter = (): SqlCounter =>
  ((globalThis as { __benchSql?: SqlCounter }).__benchSql ??= { operation: 0, organization: 0 });

const patchSql = async (stub: DurableObjectStub, key: keyof SqlCounter): Promise<void> => {
  await runInDurableObject(stub, (_instance, state) => {
    const store = counter();
    const sql = state.storage.sql as unknown as {
      exec: (...args: unknown[]) => unknown;
      __benchPatched?: boolean;
    };
    if (sql.__benchPatched === true) return;
    const original = sql.exec.bind(sql);
    sql.exec = (...args: unknown[]) => {
      store[key] += 1;
      return original(...args);
    };
    sql.__benchPatched = true;
  });
};

const resetSql = async (stub: DurableObjectStub): Promise<void> => {
  await runInDurableObject(stub, () => {
    const store = counter();
    store.operation = 0;
    store.organization = 0;
  });
};

const readSql = (stub: DurableObjectStub): Promise<SqlCounter> =>
  runInDurableObject(stub, () => ({ ...counter() }));

const sqlFor = async (stub: DurableObjectStub, run: () => Promise<unknown>): Promise<SqlCounter> => {
  await resetSql(stub);
  await run();
  return readSql(stub);
};

it("binding hot paths", async () => {
  const world = await createCloudflareConformanceWorld(env);
  const operationStub = env.OPERATION.get(env.OPERATION.idFromName(OP));
  const organizationStub = env.ORGANIZATION.get(env.ORGANIZATION.idFromName(HARBOR));
  await patchSql(operationStub, "operation");
  await patchSql(organizationStub, "organization");

  const issueFor = async (evidence: typeof DANA.evidence) => {
    const result = await world.runtime.accessFromEvidence({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: OP,
      evidence,
    });
    if (isFailed(result)) throw new Error(`issuance failed: ${result.failure.kind}`);
    return result;
  };
  const issue = () => issueFor(DANA.evidence);

  const issueReading = await measure(issue);

  let current = (await issue()).refresh;
  if (current.kind !== "rotated") throw new Error(`unexpected refresh outcome: ${current.kind}`);
  let handle = current.handle;
  const refresh = async () => {
    const result = await world.runtime.refresh({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: OP,
      handle,
    });
    if (isFailed(result) || result.refresh.kind !== "rotated") {
      throw new Error("refresh did not rotate");
    }
    handle = result.refresh.handle;
  };
  const refreshReading = await measure(refresh);

  const contextEnvelope = (await issue()).envelope;
  const contextReading = await measure(() => world.runtime.context({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    envelope: contextEnvelope,
  }));

  const keys = world.keys;
  const verifyReading = await measure(() => verify(contextEnvelope, keys, {
    now: contextEnvelope.claims.iat + 1,
  }), 100);

  const admin = await issueFor(LEN.evidence);
  const adminAuth = { kind: "access-envelope" as const, envelope: admin.envelope };
  let grantSequence = 0;
  const grant = async () => {
    grantSequence += 1;
    const command: AuthorityCommand = {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      idempotencyKey: `bench-grant-${grantSequence}`,
      authorization: adminAuth,
      kind: "grant-hat",
      operationId: OP,
      organizationId: HARBOR,
      actorId: SAM.actorId,
      role: "field",
      target: { kind: "team", teamId: "team-2e8c64b9" },
    };
    const result = await world.runtime.command(command);
    if (!result.ok) throw new Error(`grant failed: ${result.failure.kind}`);
  };
  const grantReading = await measure(grant);

  const issueSql = await sqlFor(operationStub, issue);
  const refreshSql = await sqlFor(operationStub, refresh);
  const contextSql = await sqlFor(operationStub, () => world.runtime.context({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    envelope: contextEnvelope,
  }));
  const grantSql = await sqlFor(operationStub, grant);

  const disable = async () => {
    const result = await world.runtime.command({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      idempotencyKey: "bench-disable",
      authorization: {
        kind: "fresh-evidence",
        evidence: DANA.evidence,
        operationId: OP,
      },
      kind: "disable-actor",
      organizationId: HARBOR,
      actorId: SAM.actorId,
    });
    if (!result.ok) throw new Error(`disable failed: ${result.failure.kind}`);
  };
  const disableSql = await sqlFor(organizationStub, disable);

  expect(issueReading.medianMs).toBeGreaterThan(0);
  console.log(JSON.stringify({
    runtime: "workerd-binding",
    iterations: ITERATIONS,
    results: {
      issue: issueReading,
      refresh: refreshReading,
      context: contextReading,
      verify: verifyReading,
      grantHat: grantReading,
    },
    sql: {
      issue: issueSql,
      refresh: refreshSql,
      context: contextSql,
      grantHat: grantSql,
      disableActor: disableSql,
    },
  }, null, 2));
});

