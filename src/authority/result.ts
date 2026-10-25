// The result vocabulary the command coordinators share.
//
// Two surfaces, two discriminants, deliberately (docs/types.md):
// - `failed` wraps a `Failure` for the session surface, where a failure is
//   identified by presence (`isFailed`);
// - `fail` builds a command failure, where `{ ok: false }` is the
//   discriminant;
// - `ok` builds a successful command receipt.
//
// Naming each one for what it returns is the whole pass: `failed` is a
// session result, not a misspelled command failure.

import type { Failed, Failure } from "../contract.ts";
import type { CommandResult } from "./types.ts";

export const failed = (failure: Failure): Failed => ({ failure });

export const fail = (kind: Failure["kind"], detail?: string): { ok: false; failure: Failure } => ({
  ok: false,
  failure: { kind, ...(detail !== undefined ? { detail } : {}) },
});

export const ok = (idempotencyKey: string, applied: boolean): CommandResult => ({
  ok: true,
  receipt: { idempotencyKey, applied },
});
