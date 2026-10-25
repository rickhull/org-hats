# Type leverage

**Status:** revised 2026-10-25. Landed from the first pass: honest claims
provenance (`IssuerInterfaceVersion` vs the call-surface literal,
pinned by `tests/types.test.ts`), the `isFailed` session guard, the
compile-only surface tests, the consumer's exhaustive `FailureKind` map, and
the shared `Failure` in the Cloudflare DOs. The `ActiveGrant` refinement
(`wearableGrants` returns `readonly ActiveGrant[]`; the decision path takes
nothing wider) landed the same day. What remains:

## 1. Raise Cloudflare's compiler strictness

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

## 2. Numeric time brand, conditionally

Seconds-versus-milliseconds is the one remaining strong mix-up class. It is
also the one with public ergonomics cost.

- [ ] If the conversion stays internal, add `EpochSeconds` for
      `Clock.now`, refresh/issued times, and verification `now`; keep the
      JSON claims and public call inputs as plain numbers via `Unbranded`.
- [ ] Extend `Unbranded<T>` with a numeric-brand arm; do not make hosts
      import an epoch constructor.
- [ ] Stop if the conversion spreads into public signatures; the brand is
      not worth that ceremony.

## 3. Compiler alignment and erasable syntax

The root is on TypeScript 5.7 while the Cloudflare package is on 5.9.
`erasableSyntaxOnly` (5.8+) would enforce that the `.ts` tests and pilot can
run under Node's type stripping.

- [ ] Align the root TypeScript version with the Cloudflare package after a
      clean build/test pass.
- [ ] Enable `erasableSyntaxOnly` for the portable build and test configs.
- [ ] Do not introduce enums, namespaces, or parameter properties.

## Decided along the way

- No public `assertNever` helper: the command dispatchers in both runtimes
  answer structurally unknown commands from the service binding with
  `invalid-command`, never a thrown exception, so their `default` arms keep
  the fail-closed return and carry an inline `satisfies never` witness for
  exhaustiveness instead.
- Session and command result shapes stay asymmetric (`isFailed` vs `ok`).

## Not in this plan

- Replacing runtime validation with types.
- Branding every id or public field.
- A public `ok` discriminant change to unify session and command results.
- `DeepReadonly` as a substitute for copying live state.
- Root id re-exports and `NeutralAccess` accessors (`code_review.md` R3) or
  the R4 engine split and R5 package slices.
