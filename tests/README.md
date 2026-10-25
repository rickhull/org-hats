# Tests

The suites are the executable specification. Run one suite with
`node --test tests/<file>.test.ts`, all of them with `pnpm test`; `pnpm check`
adds the compiler fence, the Cloudflare-import guard, the pilot, and the
release-metadata guard. `pnpm verify` is the full local gate: `bin/check-dist`
(build and freshness), `pnpm check`, then the Cloudflare workerd suites.

## Rings

- **Ring 0 — targeted.** `node --test tests/<file>.test.ts` for one portable
  suite; `pnpm --filter org-hats-cloudflare exec vitest run test/<file>.test.ts`
  for one workerd suite. Use while iterating; this is where a change's own
  evidence should come from.
- **Ring 1 — portable.** `pnpm check` (fences, portable suites, pilot, tag
  audit).
- **Ring 2 — workspace.** `pnpm check-dist && pnpm check:cloudflare` when
  `src/`, `dist/`, `package.json`, or `packages/cloudflare/` changes.
  `check-dist` cleans and rebuilds `dist/`; run it before the workerd suites
  and never concurrently with `pnpm check` in the same checkout.
- **Ring 3 — full.** `pnpm verify` (ring 2 plus ring 1) and
  `bin/release --push` for a release. CI on the GitHub release mirror is the
  release-time backstop, not the live gate.

`pnpm test:tools` runs the release-guard suites alone
(`release-tools.test.ts`, `gate-cache.test.ts`); they need only Node and git
and are part of ring 1.

- `contract.test.ts` — canonical JSON, byte codecs, version constants.
- `model.test.ts` — decisions, worn-hat selection, participation transitions.
- `policy.test.ts` — policy-bundle validation, including read-policy axes.
- `readreach.test.ts` — read reach under both policies and generated states.
- `twins.test.ts` — the structural properties of the synthetic twins.
- `engine.test.ts` — issuance, refresh, participation, idempotency, disable.
- `access.test.ts` — the verifier and the golden envelope vectors.
- `keyset.test.ts` — verification-key set parsing, serialization, rotation.
- `vertical.test.ts` — evidence → issuance → key distribution → verification.
- `scenarios.test.ts` — the twin scenarios end-to-end.
- `conformance.test.ts` — runs the public inventory from `src/conformance.ts`.
- `generative.test.ts` — 100 seeded states, duplicate commands, partial
  failure and outbox replay.
- `v1.test.ts` — the portable modules load inside the fence.
- `release-tools.test.ts` — the release-tag guard against throwaway
  repositories, both tag families.
- `gate-cache.test.ts` — the local per-commit gate marker, and its
  invalidation by dirt, a new commit, or a changed toolchain.

The inventory ships as `org-hats/conformance`; `tests/conformance.test.ts` is
only its in-memory runner. A case that cannot be expressed through the public
interface is a design bug, not a test gap.

`fixtures/envelope-vectors.json` carries a committed **test-only** Ed25519
keypair; it has never signed real authority. Every fixture is synthetic: no
customer names, rosters, or real-person data.
