# Test-suite review — fragility, dependencies, and rings

**Status:** review 2026-10-25, fanned out through the project-local
`test-reviewer` and `reviewer` agents (report-only): seven test batches plus a
gate-topology pass. The low-risk fragility fixes and the clear speed wins
landed with the review; the coverage gaps and remaining ring work are below.

The project-local agents were the right tool: they read their batches in full
and returned `file:line` findings without edits. `agentic-sweep` is an edit
tool and was not a fit for a review (and the worktree was dirty); the
`code-review` skill is diff-based and had no fixed point. The fanout used
`test-reviewer` for the suites and `reviewer` for the gates.

The root tests/examples typecheck gap is separate from coverage:
`plans/typechecked_tests.md` makes the suites compile at all.

## Landed in this pass

- **Ambient-state leaks in the tool tests.** `release-tools` inherited
  `GITHUB_REF` (a CI tag push made the no-arg guard audit the wrong tag) and
  both tool tests inherited global git config. Both now run with a blank
  `GITHUB_REF`, `GIT_CONFIG_GLOBAL`/`SYSTEM=/dev/null`, and
  `GIT_CONFIG_NOSYSTEM=1`. `gate-cache` also gained a test proving a changed
  `TZ` is not a cache hit.
- **A signed-claims mutation.** `scenarios.test.ts` sorted the claims array in
  place before verifying; it now copies first.
- **A provenance test that could become a no-op.**
  `access.test.ts` now derives the different `interfaceVersion` from the
  current constant instead of hard-coding `1`.
- **A wall-clock leak.** `generative.test.ts` now injects `fixedClock`, matching
  its header and the rest of the engine suites.
- **A missing admission proof.** `engine.test.ts` now exercises a successful
  `request-access` (linked principal) and a separate `admit`, not just the
  orphan rejection.
- **A vacuous smoke assertion.** `v1.test.ts` asserts the exported functions
  exist instead of `assert.ok(true)`.
- **Speed.** `tsconfig.consumer.json` makes the consumer-surface fence
  incremental (cold ~1.2s, warm ~0.6s, down from ~3.4s); `bin/check` uses it.
  `bin/release` no longer rebuilds `dist/` after `bin/check-dist` already built
  and verified it; `pnpm typecheck` no longer reruns the authority project
  that `bin/check` owns.
- **Rings and gate hygiene.** `tests/README.md` documents rings 0–3,
  `pnpm test:tools` targets the release-guard suites, `AGENTS.md` warns that
  `pnpm check` must not run concurrently with `bin/check-dist` (the build
  cleans `dist/`), and CI now fetches tags (`fetch-depth: 0`) and says it is a
  release mirror.

## P1 — coverage gaps still open

Ranked by the regression they would let through. Each is a place where a
plausible deletion or inversion leaves the suite green.

- [ ] `tests/policy.test.ts:6-55` — only about half of
  `validatePolicyBundle`'s rejection branches are pinned (missing role
  actions, duplicate/empty title, missing `readPolicy`). Add one rejection per
  branch.
- [ ] `tests/generative.test.ts:92-115` — the generator emits disabled actors
  and invited/revoked participations, but the denial check only asserts reason
  vocabulary; deleting the `disabled` or active-participation gates in
  `wearableGrants` would pass. Assert the denial reason for each ineligible
  actor.
- [ ] `tests/generative.test.ts:205` — the read-reach oracle calls the same
  `wearableGrants` primitive as `readReach`; a shared wearability regression is
  invisible. Inline an independent predicate for the granted-teams axis.
- [ ] `packages/cloudflare/test/operation.test.ts:210` — `/intake` status is
  never asserted (only the body), so a regression flipping 503-for-retry
  against 200-recorded-no-op passes. Assert both.
- [ ] `packages/cloudflare/test/exchange.test.ts:99` — no expired or wrong
  `aud`/`iss` token is exercised; deleting those checks passes. Add expiry,
  audience, issuer, and a rejected `alg` case.
- [ ] `packages/cloudflare/test/exchange.test.ts:50` — only ES256 is tested;
  the RS256 branch and the DER-signature fallback are dead under test. Add an
  RS256 token and a fixed DER vector.
- [ ] `packages/cloudflare/test/conformance.test.ts:13` — asserts
  `results.length > 0`, not the full inventory id set; a runtime-side skip
  passes. Assert the ids equal `CONFORMANCE_CASES`.
- [ ] `tests/conformance.test.ts:11` — the id-shape test does not pin the id
  values cited by `specs/authority.md`; assert the expected list.
- [ ] `tests/keyset.test.ts:83-90` — reachable parse failures (non-object key,
  missing id/key, non-array `keys`) are unpinned. Add one `throws` per branch.
- [ ] `tests/access.test.ts` / `tests/fixtures/envelope-vectors.json` — no
  vector carries an unrecognized optional claim, so E3's additive-growth
  claim is not executable. Add one.

## P2 — smaller coverage and fragility fixes

- [ ] `tests/model.test.ts:129-141` — the ordering fixture ties role and
  target, and the revoked grant cannot win, so the test cannot prove either
  exclusion. Give the revoked grant a winning rank and vary role/target.
- [ ] `tests/readreach.test.ts:28` — `length === 3` passes on any three wrong
  ids; use `deepEqual` against the expected set.
- [ ] `tests/twins.test.ts:74,98-107` — one assertion compares a fixture to its
  own constant; another re-implements `invariantProblems`. Pin the literal
  booth count and drop the duplicate (or assert a property the validator does
  not cover). Guard the `operations[0]` access before reading `.bounded`.
- [ ] `tests/contract.test.ts:29-50` — no canonical-JSON escaping/non-ASCII
  case; add a byte assertion.
- [ ] `tests/engine.test.ts:110,155` — regex assertions on human-readable
  failure details couple tests to copy. Assert the stable kind, or a token the
  contract owns.
- [ ] `tests/vertical.test.ts:52` — pin the wrong-`expectedSiteId` binding
  failure in the end-to-end path, not only in the access vectors.
- [ ] `packages/cloudflare/test/operation.test.ts:123` and `:384`,
  `roster.test.ts:178` — same wording coupling; use the stable `not applied:`
  prefix.
- [ ] `packages/cloudflare/test/operation.test.ts:92,128,150` — three tests
  bootstrap the organization without touching it; drop the cross-DO roundtrip
  and make the operation-local decision explicit.
- [ ] `packages/cloudflare/test/operation.test.ts:195` — A2 claims both alarms
  are held by tests; only the operation alarm runs. Add the organization retry.
- [ ] `packages/cloudflare/test/operation.test.ts:230` — the outsider case
  fails on the unknown-actor check first; add an `invited` participation case
  to pin the active-status gate.
- [ ] `packages/cloudflare/test/roster.test.ts:170` — only strictly-older
  images are tested; pin the same-`at` and reconcile-cadence guards.
- [ ] `packages/cloudflare/test/ops.test.ts:56` — the export/restore test
  inherits the previous test's bootstrap and fails when run alone; bootstrap
  in the test (`vitest -t` must work).
- [ ] `packages/cloudflare/test/context.test.ts:8` — resets the whole
  conformance world for one context; bootstrap only Dana's org/op.
- [ ] `packages/cloudflare/vitest.config.ts:7` — add `isolatedStorage: true`
  so DO residue cannot survive a failed/rerun test; unique names remain the
  fallback.

## Rings and measured cost

Measured on the thinkpad under light load; load 5+ inflated the same runs, so
treat these as relative. `bin/check` is ~5.6–7.9s, `tsc` authority fence
~1.1–2.2s, the incremental consumer fence ~0.6–1.2s, portable suites
~1.8–3.3s, `bin/check-dist` ~2.7s, `pnpm typecheck` ~3.8–4.4s, and the
Cloudflare suite ~10–15s (conformance ~7.2s, roster ~3.4s, operation ~2.9s,
the rest ≤1.3s). `pnpm verify` is ~20–45s depending on load; a measured run
under concurrent load was 43s.

| Ring | Trigger | Command | Cost |
| --- | --- | --- | --- |
| 0 targeted | one suite or one `src` file | `node --test tests/<file>.test.ts`; `pnpm --filter org-hats-cloudflare exec vitest run test/<file>.test.ts` | 0.3–2s portable; ~5–6s workerd (startup dominates) |
| 1 portable | `src/`, `tests/`, `bin/`, examples, configs | `pnpm check` | ~6–8s |
| 2 workspace | `packages/cloudflare/**`, `src/`, `dist/` | `pnpm check-dist && pnpm check:cloudflare` | ~13–20s |
| 3 full | pre-push, release, CI | `pnpm verify`; `bin/release ... --push` | ~20–25s idle |

- Excluding `conformance.test.ts` from the workerd suite saved only ~1s in a
  measured run: workerd startup and parallel file scheduling dominate. The
  useful fast path is **file-targeted** vitest, not "all except conformance".
- The tool tests (`release-tools`, `gate-cache`) cost ~1.2s each and need git
  and temp dirs. They stay in ring 1 for now; `pnpm test:tools` is the targeted
  loop. A future `tests/tools/` split could remove ~2.5s from ring 1 without
  weakening the guard.
- `pnpm check` and `bin/check-dist` must not run concurrently: the build
  cleans `dist/` and the consumer fence would read a missing tree. This is
  documented in `AGENTS.md`; the pre-push and CI sequences are ordered.

## Suggested next slice

Take the P1 items in two batches: (1) policy/model/readreach/twins/contract
and the engine/vertical wording/binding fixes; (2) generative denial oracles,
conformance ids and the optional-claim vector, keyset branches, and the
Cloudflare intake/exchange gaps. That closes the places where a plausible
regression currently passes before touching the smaller P2 polish.
