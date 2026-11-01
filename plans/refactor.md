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

**Done 2026-10-31.** The baseline, gap list, targeted suites, generative
and restore round-trips, determinism audit, and concurrency review all hold;
the remaining branches are classified as deferred above.

1. **Baseline measurement.** Done, 2026-10-31: `pnpm coverage` runs Node's
   built-in coverage over the portable suites (opt-in; no gate, no
   threshold). Baseline after the gap-closing tests: 99.58% lines / 87.93%
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
5. **Determinism audit.** Done, 2026-10-31: the portable suite ran five
   times (206 tests, 7.8–8.4 s each) and the workerd suite three times (14
   files, 91 tests, 24.4–27.7 s each), all green. No clock, outbox, or DO
   ordering flake appeared.
6. **Adversarial concurrency review.** Done, 2026-10-31:
   `tests/concurrency.test.ts` pauses the in-memory signer after the claims
   are built to pin disable, unlink, participation revoke, and grant revoke
   against refresh; issuance racing a revoke; a pending actor-disabled
   notice; and two refreshes of one handle.
   `packages/cloudflare/test/roster.test.ts` pins concurrent refreshes to one
   winner and races a disable against a refresh. Bound: a revocation that lands after the claims are built may
   let one envelope out; the replacement handle then fails closed through
   the A13 organization read, the revoked record, or the finalize
   transaction's re-read. No production seam was added: the portable signer
   supplies the pause, and the workerd cases use the public request surface.

**Done when:** coverage is measured, the gap list is closed or explicitly
deferred, and any threshold is stable across repeated runs.

## 3. Performance optimization

**Done 2026-10-31.** The harness and baseline live in
[`docs/performance.md`](../docs/performance.md).

1. **Harness.** Done: `pnpm bench` measures issuance, refresh, context, and
   verification in memory; `pnpm bench:binding` measures the same through the
   workerd Durable Objects plus `grant-hat` and SQL statements per call.
   Neither is a gate. The binding harness wraps each coordinator's `exec`
   method to count statements.
2. **Hot-path review.** Done: in-memory cost is signing and canonicalization;
   binding cost is the service/Durable Object round trip, with stable, small
   SQL counts. Repeated config and snapshot reads are visible but not
   measurable against transport; the hot reads use primary keys. Nothing was
   changed without a before/after.
3. **Budgets.** Envelope size stays the hard gate. `bin/check-artifact` now
   prints the stable `index.js` size (285,186 bytes at baseline) as a reading,
   not a gate. No per-operation or test-runtime threshold was added: ring
   times move with the host, and an unstable threshold would be a false gate.
4. **Evidence.** Baseline recorded above; every future performance change must
   carry its before/after, and a change that does not move the measured cost
   is reverted.

**Done when:** baselines exist, the measured hot spots are addressed or
recorded as acceptable, and the only gates are the stable ones.

## 4. Structural refactors

**Done 2026-10-31.** Behavior-identical, in the schema-first order below.

1. ~~Cloudflare schema and migrations~~ — done, 2026-10-31: the table
   declarations and named additive steps live in `src/schema/`, with
   `test/schema.test.ts` exercising an old organization and operation shape.
2. ~~Route and body parsing~~ — done, 2026-10-31: `src/http/` owns the two
   route modules plus the shared parse/response boundary; the coordinators
   keep the use cases and a short adapter object.
3. ~~Shared validators~~ — done, 2026-10-31: routing-label and policy
   validators are imported; the adapter-local actor/team id and display-name
   copies are consolidated in `src/validation.ts` and documented as the
   intentional exception in `docs/cloudflare.md`.
4. ~~Command descriptor~~ — done, 2026-10-31: `src/authority/commands.ts`
   states owner, operation binding, authorization mode, and required standing
   per kind. The portable engine dispatches on `policy.coordinator`; the
   Cloudflare runtime uses the table for authorization, binding, and standing
   enforcement, leaving only its per-kind transport switch.
5. ~~Portable authorization preamble~~ — done, 2026-10-31:
   `organizationAuthority` consolidates the either/fresh, same-organization,
   and administrator modes; `operationFor`/`operationAdmin` consolidate the
   operation lookup and simple administrator gate. Disable's envelope path,
   fresh-evidence recovery, roster writes, select-hat, and the team writes
   keep their distinct rules.
6. ~~Conformance inventory split~~ — done, 2026-10-31: the families live
   under `src/conformance/` (`model`, `auth`, `activation`, `roster`, `team`,
   `participation`, `commands`, `access`); `src/conformance/cases.ts` exports
   the one ordered list, and `src/conformance.ts` keeps the public surface.
7. ~~Portable test harness~~ — done, 2026-10-31: `tests/helpers.ts` now
   owns the test engine, command shell, fresh-evidence and envelope builders,
   and access issuance; the roster, team, activation, context, engine, and
   concurrency suites consume them.
8. ~~`docs/commands.md`~~ — done, 2026-10-31: the table states owner, scope,
   authorization mode, required standing, and effects; `tests/docs.test.ts`
   checks its policy columns against `src/authority/commands.ts`, and the
   table states that the selected hat authorizes no authority command.

**Done when:** the largest files are navigable in one read, the duplicated
policy lives in one place, and the suites still pass unchanged.

## 5. Documentation and invariants

Re-read A1–A17 against the code; keep schema, live-deployment, version, and
suite references current; add the command table; record adapter-only behavior
(export/restore, operator snapshot) in the Cloudflare documents.

**Done when:** the docs test passes and no stale reference survives.

## Sequencing

1. ~~Guards (phase 1)~~ — done, 2026-10-30.
2. ~~Coverage expansion (phase 2)~~ — done, 2026-10-31.
3. Mechanical extractions (schema, routes, conformance split, test harness)
   interleaved with the targeted tests they enable.
4. ~~Benchmarks and measured performance work~~ — done, 2026-10-31.
5. ~~`docs/commands.md`~~ — done, 2026-10-31.

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
