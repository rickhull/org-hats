// The scaled-world benchmark. `binding.bench.ts` measures the hot paths at
// conformance-fixture sizes, where every table is small enough that
// statement *counts* are visible but statement *costs* are not. This file
// boots the same coordinators with thousands of grants, teams, and
// projected actors, and runs the same four measured calls — so the
// O(state-size) candidates can be justified or retired by measurement:
//
// 1. the per-call model-snapshot re-read (every issuance reads all sites,
//    teams, grants, participations, and the actor projection);
// 2. the indexless scans (the outbox undelivered scan rides every call via
//    the drain; the schema carries no indexes at all);
// 3. statement counts, which should stay identical to the toy world —
//    proving the cost moved into the statements, not into more of them.
//
// Same rule as the other benchmark: it is opt-in, never a gate, and a
// number here justifies a change only against a before/after on the same
// machine.

import { env, runInDurableObject } from "cloudflare:test";
import {
  AUTHORITY_INTERFACE_VERSION,
  isFailed,
  type AuthorityCommand,
} from "org-hats/authority";
import { expect, it } from "vitest";
import {
  createCloudflareRuntime,
  createEphemeralSigner,
  verificationKeyOf,
} from "../src/runtime";
import type { Env } from "../src/env";

const OP = "op-scale";
const ORG_A = "org-scale-a";
const ORG_B = "org-scale-b";

// The scale dial. At these sizes the model snapshot the operation reads
// per call carries ~10k grants, ~3k projected actors, 60 teams, 10 sites —
// the order of a real mid-size operation rather than a fixture.
const SITES = 10;
const TEAMS = 60;
const ACTORS_PER_ORG = 1_500;
const GRANTS = 10_000;

const pad = (n: number, width = 4): string => String(n).padStart(width, "0");

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

const measure = async (run: () => Promise<unknown>, iterations = 30): Promise<Reading> => {
  for (let i = 0; i < 3; i++) await run();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const started = performance.now();
    await run();
    samples.push(performance.now() - started);
  }
  return summarize(samples);
};

interface SqlCounter {
  operation: number;
}

const counter = (): SqlCounter =>
  ((globalThis as { __benchSql?: SqlCounter }).__benchSql ??= { operation: 0 });

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
    counter().operation = 0;
  });
};

const readSql = (stub: DurableObjectStub): Promise<SqlCounter> =>
  runInDurableObject(stub, () => ({ ...counter() }));

const sqlFor = async (stub: DurableObjectStub, run: () => Promise<unknown>): Promise<SqlCounter> => {
  await resetSql(stub);
  await run();
  return readSql(stub);
};

it("scaled-world hot paths", async () => {
  const organization = (id: string) => env.ORGANIZATION.get(env.ORGANIZATION.idFromName(id));
  const operation = (id: string) => env.OPERATION.get(env.OPERATION.idFromName(id));

  const post = async (stub: DurableObjectStub, path: string, body: unknown): Promise<void> => {
    const response = await stub.fetch(`https://authority.internal${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as { readonly ok: boolean; readonly failure?: unknown };
    if (!result.ok) throw new Error(`scale bootstrap ${path} failed: ${JSON.stringify(result.failure)}`);
  };

  // A clean pair of coordinators under ids no other case uses.
  await post(organization(ORG_A), "/reset", {});
  await post(organization(ORG_B), "/reset", {});
  await post(operation(OP), "/reset", {});

  for (const [org, letter] of [[ORG_A, "a"], [ORG_B, "b"]] as const) {
    await post(organization(org), "/bootstrap", {
      organizationId: org,
      displayName: `Scale ${letter.toUpperCase()}`,
      actors: Array.from({ length: ACTORS_PER_ORG }, (_, i) => ({
        actorId: `actor-${letter}${pad(i)}`,
        displayName: `Scale ${letter}${pad(i)}`,
      })),
      // one (provider, subject) may link in one organization only; the
      // measured actor lives in org A
      ...(letter === "a"
        ? { principalLinks: [{ provider: "idp", subject: "scale", actorId: "actor-a0000" }] }
        : { principalLinks: [] }),
      orgAdmins: [`actor-${letter}0000`],
      sealedIdpConfig: "sealed:scale-bench",
    });
  }

  await post(operation(OP), "/bootstrap", {
    operationId: OP,
    slug: "scale",
    displayName: "Scale Operation",
    policy: {
      format: 1,
      id: "policy-scale",
      version: "1",
      actions: ["observe", "review"],
      roles: [
        { title: "field", actions: ["observe"] },
        { title: "lead", actions: ["observe", "review"] },
      ],
      readPolicy: { organizations: "granted-teams" },
    },
    configureActions: ["review"],
    sites: Array.from({ length: SITES }, (_, i) => ({
      siteId: `site-s${pad(i, 2)}`,
      path: `s${pad(i, 2)}`,
      aliases: [`s${pad(i, 2)}`],
    })),
    teams: Array.from({ length: TEAMS }, (_, i) => ({
      teamId: `team-t${pad(i, 2)}`,
      siteId: `site-s${pad(i % SITES, 2)}`,
      organizationId: i % 2 === 0 ? ORG_A : ORG_B,
    })),
    grants: Array.from({ length: GRANTS }, (_, i) => ({
      grantId: `g-${pad(i)}`,
      organizationId: i % 2 === 0 ? ORG_A : ORG_B,
      actorId: `actor-${i % 2 === 0 ? "a" : "b"}${pad(Math.floor(i / 2) % ACTORS_PER_ORG)}`,
      role: i % 3 === 0 ? "lead" : "field",
      target: { kind: "team" as const, teamId: `team-t${pad(i % TEAMS, 2)}` },
      ...(i === 0 ? { primary: true } : {}),
    })),
    participations: [
      { organizationId: ORG_A, status: "active" },
      { organizationId: ORG_B, status: "active" },
    ],
  });

  const signer = await createEphemeralSigner();
  const key = await verificationKeyOf(signer);
  const keys = new Map([[key.keyId, key]]);
  const runtime = createCloudflareRuntime({
    env: env as Env,
    signer,
    keys,
    organizationIds: [ORG_A, ORG_B],
  });

  const operationStub = operation(OP);
  await patchSql(operationStub, "operation");

  const evidence = { provider: "idp", subject: "scale" } as const;

  const issueFor = async (actorEvidence: typeof evidence) => {
    const result = await runtime.accessFromEvidence({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: OP,
      evidence: actorEvidence,
    });
    if (isFailed(result)) throw new Error(`issuance failed: ${JSON.stringify(result.failure)}`);
    return result;
  };

  const issue = () => issueFor(evidence);

  // The first calls import the roster projections (~3k actors flow from the
  // organizations); measure() warms past that so the readings are
  // steady-state, as in the toy benchmark.
  const issueReading = await measure(issue);

  let current = (await issue()).refresh;
  if (current.kind !== "rotated") throw new Error(`unexpected refresh outcome: ${current.kind}`);
  let handle = current.handle;
  const refresh = async () => {
    const result = await runtime.refresh({
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
  const context = () => runtime.context({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    envelope: contextEnvelope,
  });
  const contextReading = await measure(context);

  const admin = await issueFor(evidence);
  const adminAuth = { kind: "access-envelope" as const, envelope: admin.envelope };
  let grantSequence = 0;
  const grant = async () => {
    grantSequence += 1;
    const command: AuthorityCommand = {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      idempotencyKey: `scale-grant-${grantSequence}`,
      authorization: adminAuth,
      kind: "grant-hat",
      operationId: OP,
      organizationId: ORG_A,
      actorId: "actor-a0001",
      role: "field",
      target: { kind: "team", teamId: "team-t00" },
    };
    const result = await runtime.command(command);
    if (!result.ok) throw new Error(`grant failed: ${result.failure.kind}`);
  };
  const grantReading = await measure(grant);

  const issueSql = await sqlFor(operationStub, issue);
  const refreshSql = await sqlFor(operationStub, refresh);
  const contextSql = await sqlFor(operationStub, context);
  const grantSql = await sqlFor(operationStub, grant);

  expect(issueReading.medianMs).toBeGreaterThan(0);
  console.log(JSON.stringify({
    runtime: "workerd-binding-scaled",
    world: { sites: SITES, teams: TEAMS, actors: ACTORS_PER_ORG * 2, grants: GRANTS },
    readings: {
      issue: issueReading,
      refresh: refreshReading,
      context: contextReading,
      grantHat: grantReading,
    },
    statements: {
      issue: issueSql,
      refresh: refreshSql,
      context: contextSql,
      grantHat: grantSql,
    },
  }, null, 2));
}, 240_000);
