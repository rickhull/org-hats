# Typechecked tests — the root suites and examples

**Status:** proposed 2026-10-25. The 2.0.0 interface break exposed that
`node --test` strips types without checking them: a fixture can keep sending
a shape the interface no longer accepts and fail only at runtime. The
`tsconfig.tests.json` experiment recorded in `claude_review.md` reported
**173 errors across ten files** in `src`, `tests`, and `examples`. A
re-measure on 2026-10-25 against the current tree reported **180 errors in
ten files** (all in `tests/`; `src` and `examples` were clean). Use 180 as
the starting point. The Cloudflare package already typechecks its `test/`
directory through its own tsconfig; this plan covers the root package.

## Why this is a gate, not a cleanup

- `tsconfig.json` compiles only `src/**/*.ts`; `bin/check` compiles the
  portable fence (`tsconfig.authority.json`) and the consumer surface, never
  the suites.
- `node --test` runs the `.ts` files with type stripping. Nothing checks
  that the tests build the types they claim to test.
- During the `GrantTarget` break the compiler was silent and six tests died
  with `Cannot read properties of undefined`; the published-surface fence
  covered consumer shapes but not internal test fixtures.
- The errors are test-ergonomic patterns that never had to typecheck —
  narrowing `Failed | Verified` by reaching for `.failure`, claims passed
  where `JsonValue` is wanted, fixtures that need `Unbranded` at the
  boundary. They should be fixed deliberately, not silenced.

## Steps

- [ ] Add `tsconfig.tests.json`:

  ```json
  {
    "extends": "./tsconfig.json",
    "compilerOptions": {
      "noEmit": true,
      "rootDir": ".",
      "types": ["node"]
    },
    "include": ["src/**/*.ts", "tests/**/*.ts", "examples/**/*.ts"]
  }
  ```

  The root config's `outDir`/`rootDir` are for the build; the tests config
  overrides `rootDir` and emits nothing. `allowImportingTsExtensions` is
  already on and remains valid with `noEmit`.
- [ ] Add a targeted script, `typecheck:tests`, running
      `tsc -p tsconfig.tests.json`.
- [ ] Wire it into `bin/check` after the portable fence and before the
      `node --test` suites, so pre-push and CI fail on a test type error.
      Keep `pnpm typecheck` for the build configuration; do not run two
      full `src` compiles in the same gate.
- [ ] Fix the errors in batches, without weakening the checks:
  - [ ] access / contract / consumer-surface narrowing and JSON boundaries;
  - [ ] engine / conformance / scenario fixtures;
  - [ ] generative and property cases;
  - [ ] `examples/pilot.ts`;
  - [ ] tests that construct branded ids or partial claims.
- [ ] Use boundary conversions (`Unbranded`, a typed JSON helper) and
      discriminated-union guards. No new `as any`, `@ts-ignore`,
      `@ts-expect-error`, or loosened compiler options. If a test needs a
      helper to narrow `Failed | Verified`, add the helper rather than a
      cast at every call site.
- [ ] Re-measure and record the final error count and gate cost; update the
      ring table in `tests/README.md` if the cost is material.
- [ ] Document the new gate in `tests/README.md` and, if the command order
      matters, the check-order note in `AGENTS.md`.
- [ ] Run `pnpm check`, `pnpm typecheck`, `pnpm check:cloudflare`, and
      `pnpm verify`; a `src/` change also requires `pnpm build`.

## Acceptance

- `tsc -p tsconfig.tests.json` exits zero, and `bin/check` fails on a
  deliberate type error in a test.
- No new suppressions or relaxed compiler options.
- `node --test` and workerd test behavior are unchanged.
- The baseline (180 at the last re-measure) is gone; fixtures convert once
  at their boundary, rather than carrying plain strings into domain
  positions.

## Out of scope

- Runtime behavior changes or new public API. If a type error exposes a real
  behavior bug, move it to `code_review.md` and decide it there.
- The `packages/cloudflare` tests: its `tsconfig.json` already includes
  `src`, `test`, and `vitest.config.ts`.
- The R4 engine split and the R5 package slices.
