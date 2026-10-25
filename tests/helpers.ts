// Shared helpers for the generative suites: the deterministic mulberry32
// PRNG and a pick over its stream. Same seed, same world, in every suite.

import { isFailed, type Failed, type Failure, type JsonValue, type Unbranded } from "../src/contract.ts";
import type { PolicyBundle } from "../src/policy.ts";
import type { Snapshot } from "../src/model.ts";

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

/** The source canonicalizes claims through the same boundary assertion. */
export const asJson = (value: unknown): JsonValue => value as JsonValue;

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
