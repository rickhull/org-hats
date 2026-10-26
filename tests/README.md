# Tests

The suites are the executable specification. Run one suite with
`node --test tests/<file>.test.ts`, all of them with `pnpm test`; `pnpm check`
adds the compiler fence, the Cloudflare-import guard, both examples, and the
release-metadata guard. `pnpm verify` is the full local gate (`bin/verify`):
`bin/check-dist` (build and freshness), `pnpm check`, then the Cloudflare
workerd suites. A clean commit that passes records the local gate cache, so
the next pre-push does not repeat the portable gate.

## Rings

- **Ring 0 — targeted.** `node --test tests/<file>.test.ts` for one portable
  suite; `pnpm --filter org-hats-cloudflare exec vitest run test/<file>.test.ts`
  for one workerd suite. Use while iterating; this is where a change's own
  evidence should come from.
- **Ring 1 — portable.** `pnpm check` (fences, test/example typecheck,
  portable suites, both examples, tag audit).
- **Ring 2 — workspace.** `pnpm check-dist && pnpm check:cloudflare` when
  `src/`, `dist/`, `package.json`, or `packages/cloudflare/` changes.
  `check-dist` cleans and rebuilds `dist/`; run it before the workerd suites
  and never concurrently with `pnpm check` in the same checkout.
- **Ring 3 — full.** `pnpm verify` (ring 2 plus ring 1; records the local
  gate cache for a clean commit) and `bin/release --push` for a release. CI
  on the GitHub release mirror is the release-time backstop, not the live
  gate. A Cloudflare tag also passes `bin/check-deploy`.

`pnpm test:tools` runs the release-guard suites alone
(`release-tools.test.ts`, `gate-cache.test.ts`, `deploy-check.test.ts`); they
need only Node and git. Use it alone for a fast loop; ring 1 runs them too.

Pre-push and the Codeberg per-push CI run the portable gate. The workerd
suite runs in ring 2, `pnpm verify`, `bin/release`, and the GitHub mirror job;
it is not part of per-push Codeberg CI.

The root suites and `examples/` are typechecked by `tsconfig.tests.json` as
part of `bin/check`; the consumer surface is the separate
`tsconfig.consumer.json` fence against `dist/`. `pnpm typecheck:tests` is the
targeted command.
`pnpm typecheck` is a fast standalone check of the build config. It is a
subset of what `tsconfig.tests.json` and `bin/check-dist` already compile, so
it is a convenience, not an additional gate. A fixture that drifts from the
public types fails the gate instead of failing at runtime.

- `contract.test.ts` — canonical JSON, byte codecs, version constants.
- `model.test.ts` — decisions, worn-hat selection, participation transitions.
- `policy.test.ts` — policy-bundle validation, including read-policy axes.
- `readreach.test.ts` — read reach under both policies and generated states.
- `twins.test.ts` — the structural properties of the synthetic twins.
- `world.test.ts` — the `defineWorld` boundary: a coherent own world, each
  refusal branch, and every twin revalidated.
- `engine.test.ts` — issuance, refresh, participation, idempotency, disable.
- `claims.test.ts` — the shared claims assembler: hat, reach, configuration,
  lifetime, and authentication facts, including the absent cases.
- `access.test.ts` — the verifier and the golden envelope vectors.
- `types.test.ts` — compile-only surface assertions: plain ids, closed
  unions, version literals, claims provenance. Nothing runs; the aliases
  fail `tsconfig.tests.json` in `bin/check`.
- `keyset.test.ts` — verification-key set parsing, serialization, rotation.
- `vertical.test.ts` — evidence → issuance → key distribution → verification.
- `scenarios.test.ts` — the twin scenarios end-to-end.
- `conformance.test.ts` — runs the public inventory from `src/conformance.ts`.
- `generative.test.ts` — 100 seeded states, duplicate commands, partial
  failure and outbox replay.
- `release-tools.test.ts` — the release-tag guard against throwaway
  repositories, both tag families.
- `gate-cache.test.ts` — the local per-commit gate marker, and its
  invalidation by dirt, a new commit, or a changed toolchain.
- `deploy-check.test.ts` — the Cloudflare deployable-artifact gate: the
  production config, the annotated tag, and the version match.

The inventory ships as `org-hats/conformance`; `tests/conformance.test.ts` is
only its in-memory runner. A case that cannot be expressed through the public
interface is a design bug, not a test gap.

`fixtures/envelope-vectors.json` carries a committed **test-only** Ed25519
keypair; it has never signed real authority. Every fixture is synthetic: no
customer names, rosters, or real-person data.
