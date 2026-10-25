# Type leverage

**Status:** proposed 2026-10-25, after the type-layer review in
[`docs/types.md`](../docs/types.md). The typechecked-test gate is landed;
this plan covers the remaining type-specific follow-ups. It does not replace
the API additions in `code_review.md` R3.

## 1. Make the claims' interface provenance honest

`AccessEnvelopeClaimsV1.interfaceVersion` is typed as the current call
interface literal (`2`), but the field records the issuing interface and the
verifier deliberately accepts historical values. `tests/access.test.ts`
already needs `as never` to sign a different interface. That is a type
assertion standing in for a missing distinction.

- [ ] Widen the claims field to a provenance type — `number` or a named
      `IssuerInterfaceVersion` — while keeping
      `Versioned.interfaceVersion: AuthorityInterfaceVersion` on the call
      surface.
- [ ] Remove the `as never` from the provenance test; add a claims/vector
      case whose value is historical.
- [ ] Add a type-level assertion that `AccessFromEvidenceInput` still speaks
      the current literal.
- [ ] Review the type-only change with the consumer; no runtime or wire
      change.

This is the smallest item and the most direct type-truth fix.

## 2. Carry the wearable filter in the type

`wearableGrants` filters out revoked grants at runtime but returns
`readonly Grant[]`. Downstream callers know only that they hold a grant,
not that it survived the filter.

- [ ] Add `ActiveGrant = Grant & { readonly revoked?: false }` and an
      `isActiveGrant` predicate.
- [ ] Return `readonly ActiveGrant[]` from `wearableGrants`; let
      `firstByRank`, `selectWornHat`, and `decide` accept the refined type.
      `readReach` inherits the refinement through `wearableGrants`.
- [ ] Keep `Snapshot.grants` carrying revoked records for audit; only the
      decision path sees `ActiveGrant`.
- [ ] Add a compile-time test that a revoked grant cannot be passed to the
      refined decision helpers.

No behavior change; the filter moves from a convention into the signature.

## 3. Centralize result narrowing and exhaustiveness

Session results use `"failure" in value`; command results use `ok`. That is
workable, but the narrowing helpers live in the test suite and the
`FailureKind` map is not forced to be exhaustive.

- [ ] Add a session-result `isFailed` guard in the public contract (or a
      small shared helper) and use it in hosts/tests; keep the command
      result's `ok` discriminant.
- [ ] Add `assertNever(value: never): never` and use it in command/failure
      switches in both runtimes.
- [ ] Add a `satisfies Record<FailureKind, ...>` mapping in the
      consumer-surface type test, so a new failure kind must be handled.
- [ ] Do not unify the session and command result shapes; that is a public
      break with little gain.

## 4. Add type-level public-surface tests

`tests/consumer-surface.ts` already compiles against `dist/`. Extend the
idea into a compile-only `tests/types.test.ts` (or a second section there):

- [ ] Assert every public id remains a plain `string`.
- [ ] Assert `GrantTarget` remains a two-arm union and `HatSummary.target`
      stays unbranded.
- [ ] Assert the envelope version literals and the claims' version field.
- [ ] Assert the `FailureKind` mapping is exhaustive.
- [ ] Use conditional-type assertions (`Expect<Equal<...>>`) rather than
      `@ts-expect-error`; keep the file in `tsconfig.tests.json`.

These cost no runtime and catch public-surface drift at the compiler.

## 5. Raise Cloudflare's compiler strictness

`packages/cloudflare/tsconfig.json` does not enable
`noUncheckedIndexedAccess` or `exactOptionalPropertyTypes`, although the
runtime reads SQLite rows and optional columns. The portable package already
does.

- [ ] Add both flags; fix the resulting row/optional-property errors
      deliberately.
- [ ] Consider `noImplicitOverride` at the same time; leave module resolution
      and emit alone.
- [ ] Run `pnpm check:cloudflare` and the full `pnpm verify`.

This is a reliability pass, not a behavior change; it may surface real
row/property assumptions.

## 6. Numeric time brand, conditionally

Seconds-versus-milliseconds is the one remaining strong mix-up class. It is
also the one with public ergonomics cost.

- [ ] If the conversion stays internal, add `EpochSeconds` for
      `Clock.now`, refresh/issued times, and verification `now`; keep the
      JSON claims and public call inputs as plain numbers via `Unbranded`.
- [ ] Extend `Unbranded<T>` with a numeric-brand arm; do not make hosts
      import an epoch constructor.
- [ ] Stop if the conversion spreads into public signatures; the brand is
      not worth that ceremony.

## 7. Compiler alignment and erasable syntax

The root is on TypeScript 5.7 while the Cloudflare package is on 5.9.
`erasableSyntaxOnly` (5.8+) would enforce that the `.ts` tests and pilot can
run under Node's type stripping.

- [ ] Align the root TypeScript version with the Cloudflare package after a
      clean build/test pass.
- [ ] Enable `erasableSyntaxOnly` for the portable build and test configs.
- [ ] Do not introduce enums, namespaces, or parameter properties.

## 8. Small consolidation

- [ ] Import the shared `Failure` type in `packages/cloudflare` instead of
      keeping a local copy beside `FailureKind`.
- [ ] Leave root id re-exports and `NeutralAccess` accessors to
      `code_review.md` R3; do not duplicate that ledger.

## Order

1, 3, and 4 are small and independent. 2 is a local model refinement. 5 is a
focused Cloudflare pass. 6 and 7 are conditional on cost. 8 is cleanup.

## Not in this plan

- Replacing runtime validation with types.
- Branding every id or public field.
- A public `ok` discriminant change to unify session and command results.
- `DeepReadonly` as a substitute for copying live state.
- The R4 engine split or the R5 package slices.
