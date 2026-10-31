# Refactor and quality program

**Status:** active 2026-10-29, directed by Rick. The feature line is complete
for now; the work is clarity, simplicity, readability, and reliability behind
the existing contract.

## Principle

The suites are the contract. Every item here is behavior-identical unless it
is a test or a documented deprecation: one refactor per commit, full
`pnpm verify` after each, conformance inventory and failure messages unchanged.

## Scope

- **Test coverage expansion** — measure first, then close real gaps.
- **Performance optimization** — baseline the hot paths, then remove measured
  waste; no invented targets.
- **Structural refactors** — mechanical extraction where the files have grown
  past what one reader can hold.
- **Reliability guards** — make the drift surfaces fail in tests.
- **Documentation and invariants** — keep the built system and A1–A17 in step.

**Out of scope:** new features, policy axes, speculative adapters, public
contract changes beyond named deprecations, a generic SQL repository behind the
seam (A3), or merging the portable and Durable Object state models.

## Baseline, 2026-10-29

- Portable `src/` ~5.5k lines; largest `conformance.ts` 1,297, `operation.ts`
  620, `organization.ts` 502.
- Cloudflare `src/` ~5.5k lines; largest `operation.ts` 2,094,
  `organization.ts` 1,339, `runtime.ts` 801.
- Tests ~5.2k lines; portable ring ~2.5 s, workerd ring ~14–20 s.
- Drift surfaces: 24 `CREATE TABLE` statements against 20 export table specs;
  36 dispatch cases across two switches plus a separate operation-binding
  list; 41 replay/claim sites; repeated command authorization preambles.
- Existing hard gates: envelope size against the 3,800-byte host budget,
  conformance inventory, schema restore on the current version.

## 1. Guards before movement

Done, 2026-10-30: all five guards hold and each fails on the drift it
names — `tests/schema-parity.test.ts`, `tests/command-inventory.test.ts`,
`tests/failure-mapping.test.ts`, and the workerd restore matrix in
`packages/cloudflare/test/restore-matrix.test.ts`. The dead-surface rule is
the fifth, a standing rule rather than a test.

- **Dead surface.** The ignored `admit.teamId` is documented as deprecated;
  removal is an interface-bump item, not a quiet deletion.

## 2. Coverage expansion

1. **Baseline measurement.** Done, 2026-10-31: `pnpm coverage` runs Node's
   built-in coverage over the portable suites (opt-in; no gate, no
   threshold). Baseline after the gap-closing tests: 99.58% lines / 87.80%
   branches / 99.68% functions over `src/`. The workerd provider is
   deferred: Cloudflare's vitest-plugin coverage documentation was a 404 when
   evaluated, no threshold exists to enforce, and a dev dependency would buy
   numbers without a role; the named workerd suites cover those branches.
2. **Gap list.** Closed 2026-10-31: world cross-reference refusals,
   multi-byte canonical bytes, organization-side participation revoke, the
   untyped-host command arm, roster ceilings, context and command
   `invalid-signature`, a grant targeting an unknown site, envelope refusal
   for `revoke-activation` and `unlink-principal`, the activation-request
   refusals (wrong organization, non-administrator, already linked), boot
   refusal for a principal link to an unknown actor, and refresh with no
   principal link. Remaining, deferred:
   - Defensive adapter paths: `verifyKeyOf`, the platform-crypto `catch` in
     both verifiers, and the conformance harness's own failure messages (a
     broken case, not behavior).
   - Unreachable by contract: the `firstByRank` final tie when role, target,
     and grant id all match (`model.ts:289`); the context's stale-role branch
     needs a snapshot the public boundary rejects (`operation.ts:221-222`).
3. **Targeted suites.** Close gaps that represent real behavior, not vanity
   lines. Where a threshold helps, apply it to `src/authority`, `src/access`,
   and the Cloudflare coordinators, excluding conformance fixture data.
4. **Generative extension.** Done, 2026-10-31: duplicate-command cases cover
   create/update actor, appoint/retire administrator, and
   request/admit/update/retire team; eight seeded command sequences re-check
   invariants after the roster and team writes; and the workerd restore matrix
   round-trips command-built roster and team state through export and restore.
5. **Determinism audit.** Repeat the suites to catch clock/outbox/DO ordering
   flakes; fix or record each.
6. **Adversarial concurrency review.** Test the stated bounds against
   interleavings, not only the sequential cases: disable, unlink, grant
   revoke, and participation revoke against refresh; two refreshes of one
   handle; issuance racing a revocation; a delayed outbox. Pin the
   disable-while-refreshing case first: once the revoke applies, a concurrent
   refresh must not leave a usable handle. The finalize transaction and A13
   gate are the answer; the test needs a controllable pause at the
   organization read. Add such a seam only if the case cannot be written
   without it. Record the expected bound for each scenario; a new authority
   feature is not the fix.

**Done when:** coverage is measured, the gap list is closed or explicitly
deferred, and any threshold is stable across repeated runs.

## 3. Performance optimization

1. **Harness.** A benchmark script (not a gate) for issuance, verify, refresh,
   and context in memory and through the binding; record numbers per commit
   that claims an improvement. Count SQL statements per command in the
   Durable Object.
2. **Hot-path review.** Repeated `snapshotOf` assembly during one issuance or
   refresh; claims sorting and canonicalization; signature work; DO query
   counts and indexes (`EXPLAIN QUERY PLAN` for the hot reads).
3. **Budgets.** Keep envelope size as the hard gate. Add a Worker bundle-size
   reading to the artifact check if it is stable; add test-runtime budgets to
   the rings rather than per-benchmark gates.
4. **Evidence.** Before/after numbers for every performance change; revert a
   change that does not move the measured cost.

**Done when:** baselines exist, the measured hot spots are addressed or
recorded as acceptable, and the only gates are the stable ones.

## 4. Structural refactors

Behavior-identical, in the schema-first order below.

1. **Cloudflare schema and migrations** out of the coordinator classes into
   schema modules; migrations become named steps with tests.
2. **Route and body parsing** out of the coordinator classes; the classes keep
   use cases.
3. **Shared validators** imported by the Cloudflare adapter, or a documented
   decision that adapter-local copies are intentional.
4. **Command descriptor** — one module states owner, operation binding,
   authorization mode, and required standing per kind; `engine.ts` and
   `runtime.ts` consume it instead of parallel switches and the binding list.
   No kind carries a hat action as its authorization.
5. **Portable authorization preamble** consolidated where the rules agree;
   disable's envelope path, fresh-evidence recovery, and roster writes keep
   their distinct modes.
6. **Conformance inventory split** by family (`model`, `auth`, `participation`,
   `commands`, `activation`, `roster`, `team`, `access`) with one exported
   list.
7. **Portable test harness** extracted for fixtures, engine setup, command and
   envelope builders, shared by the domain suites.
8. **`docs/commands.md`** — kind → owner, scope, authorization mode,
   required standing, effects — checked against the descriptor; the table
   states that the selected hat authorizes no authority command.

**Done when:** the largest files are navigable in one read, the duplicated
policy lives in one place, and the suites still pass unchanged.

## 5. Documentation and invariants

Re-read A1–A17 against the code; keep schema, live-deployment, version, and
suite references current; add the command table; record adapter-only behavior
(export/restore, operator snapshot) in the Cloudflare documents.

**Done when:** the docs test passes and no stale reference survives.

## Sequencing

1. ~~Guards (phase 1)~~ — done, 2026-10-30.
2. ~~Coverage baseline and gap list~~ — done, 2026-10-31.
3. Mechanical extractions (schema, routes, conformance split, test harness)
   interleaved with the targeted tests they enable.
4. Benchmarks and measured performance work.
5. Command descriptor and `docs/commands.md` last, once the guards and
   parity tests are in place.

## Exit criteria

- Guards exist and fail on their named drift.
- Coverage baseline is recorded; gaps are closed or deferred with a reason.
- Performance baselines are recorded; measured wins are kept and the rest
  reverted.
- Structural items are landed; the suites and conformance inventory still pass
  unchanged.
- `pnpm verify` is green with tracked `dist/`.
- This plan is removed when those hold.

## Risks

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Refactor weakens the tests | The safety net moves with the code | Characterize behavior first; never relax an assertion to make a refactor pass |
| Coverage becomes a vanity number | Lines covered without behavior | Measure branches and failure paths; thresholds only where stable |
| Benchmarks flake | A false regression blocks work | Record, do not gate, until variance is understood |
| SQL extraction becomes a repository | A3's seam is lost | Move DDL and parsing only; handlers keep use-case shape |
| Dependency creep for coverage | A dev dependency for numbers | Evaluate the Vitest provider against Node's built-in portable coverage before adding |
