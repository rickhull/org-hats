// Shared helpers for the generative suites: the deterministic mulberry32
// PRNG and a pick over its stream. Same seed, same world, in every suite.

import {
  AUTHORITY_INTERFACE_VERSION,
  isFailed,
  type Failed,
  type Failure,
  type OperationId,
  type RefreshHandle,
  type RefreshHandleOutcome,
  type SignedAccessEnvelope,
  type Unbranded,
} from "../src/contract.ts";
import type { PolicyBundle } from "../src/policy.ts";
import type { Snapshot } from "../src/model.ts";
import type { AccessIssue, AuthorityCommand, AuthorityCommandBody, CommandResult, PrincipalEvidence } from "../src/authority/types.ts";
import { createInMemoryAuthority, type InMemoryAuthorityConfig } from "../src/authority/engine.ts";
import { fixedClock, webCryptoSigner } from "../src/authority/internal.ts";

export const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const pick = <T>(rng: () => number, values: readonly T[]): T =>
  values[Math.floor(rng() * values.length)] as T;

// --- typed test boundaries ----------------------------------------------------
//
// The suites are typechecked by `tsconfig.tests.json`. These helpers keep the
// conversions deliberate: fixtures enter the domain through one boundary, and
// union results are narrowed by a named check rather than a property access
// the compiler cannot see.

/** Hand-written fixture data, converted once at the boundary. Coherence is
 * what `invariantProblems` checks; the cast only supplies the brands. */
export const fixtureSnapshot = (snapshot: Unbranded<Snapshot>): Snapshot =>
  snapshot as Snapshot;

/** Deliberately malformed policy data for the validator's rejection cases. */
export const uncheckedPolicy = (value: unknown): PolicyBundle =>
  value as PolicyBundle;

/** The source canonicalizes claims through the same boundary conversion
 * (`asJson` from `src/contract.ts`). */
export { asJson } from "../src/contract.ts";

/** A failed result, with a clear test failure if the call succeeded. */
export const failureOf = (value: unknown): Failure => {
  if (typeof value !== "object" || value === null || !("failure" in value)) {
    throw new Error("expected a failure");
  }
  return (value as Failed).failure;
};

/** A successful result, preserving the caller's concrete type. */
export const successOf = <T extends object>(value: T | Failed): T => {
  if (isFailed(value)) throw new Error(`expected success, got ${value.failure.kind}`);
  return value;
};

/** A command body without the shell every call shares: the public union of
 * all command variants, so a suite builds commands against the same type the
 * runtime validates. */
export type CommandBody = AuthorityCommandBody;

/** A successful command, naming its failure kind when it is not. */
export const okOf = (result: CommandResult): Extract<CommandResult, { ok: true }> => {
  if (!result.ok) throw new Error(`expected command success, got ${result.failure.kind}`);
  return result;
};

/** A rotated refresh handle; any other outcome fails the test and names
 * itself, so a changed outcome cannot skip the assertions that follow. */
export const handleOf = (outcome: RefreshHandleOutcome): RefreshHandle => {
  if (outcome.kind !== "rotated") throw new Error(`expected a rotated refresh handle, got ${outcome.kind}`);
  return outcome.handle;
};

// --- engine and command harness -------------------------------------------------

export type TestEngine = Awaited<ReturnType<typeof createInMemoryAuthority>>;

/** The fixed clock and fresh signer every domain suite starts from, with
 * per-suite config layered over them. */
export const createTestEngine = async (config: InMemoryAuthorityConfig = {}): Promise<TestEngine> => {
  const clock = config.clock ?? fixedClock(1_700_000_000);
  const signer = config.signer ?? await webCryptoSigner("test-engine");
  return createInMemoryAuthority({ ...config, clock, signer });
};

/** A command shell around a typed body: the one shape every suite sends. */
export const buildCommand = (
  body: CommandBody,
  authorization: AuthorityCommand["authorization"],
  idempotencyKey: string,
): AuthorityCommand => ({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  idempotencyKey,
  authorization,
  ...body,
});

export const freshAuth = (
  evidence: PrincipalEvidence,
  operationId: OperationId,
): AuthorityCommand["authorization"] => ({
  kind: "fresh-evidence",
  evidence,
  operationId,
});

export const envelopeAuth = (envelope: SignedAccessEnvelope): AuthorityCommand["authorization"] => ({
  kind: "access-envelope",
  envelope,
});

/** Issue access from evidence, naming the failure instead of returning it. */
export const issueAccess = async (
  engine: TestEngine,
  evidence: PrincipalEvidence,
  operationId: OperationId,
): Promise<AccessIssue> => {
  const result = await engine.runtime.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId,
    evidence,
  });
  if (isFailed(result)) throw new Error(`issuance failed: ${result.failure.kind}`);
  return result;
};
