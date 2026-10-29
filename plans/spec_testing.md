# Spec-driven test suite

**Status:** active 2026-10-29. The suites are the executable specification;
`specs/` is the named one. This plan makes the link explicit: every
invariant gets a witness, the witness's tier is visible, and the cheap tiers
carry as much of the proof as they honestly can.

## Goal

- One test-side index over `A1–A17`, `E1–E8`, and `P1–P10`.
- At least one named witness per invariant, at the cheapest tier that can
  actually falsify it.
- Unit and smoke witnesses preferred; platform, concurrency, and release
  witnesses segmented and declared instead of silently skipped.
- A gate that fails when a spec loses its witness, a tag names no spec, or a
  static witness rots.

This does not add authority features, and it does not duplicate the domain
suites. Existing tests are tagged; new tests are written only for gaps.

## Linkage

The canonical key is the spec heading: `### A7 — …`, `### E3 — …`,
`### P6 — …` across `specs/*.md`.

A witness is one of:

1. **Tagged test** — a test title carries the id in brackets, for example
   `test("[A7] a revoking command kills its refresh records", …)` or
   `it("[A13] refresh re-resolves the actor at the organization", …)`.
   Multiple tags are allowed (`[A7][E7]`), but each id must be one the test
   would fail on; tag stuffing is a review rejection.
2. **Conformance citation** — a case id named in the static/review table
   (`OH-AUTH-04`, `OH-CMD-02`), for invariants proved only through the public
   inventory.
3. **Static witness** — a command or file that enforces the invariant without
   a runtime assertion: `bin/check`, `pnpm typecheck:tests`, `tsconfig.*`,
   `tests/fixtures/*`, the release scripts.
4. **Review witness** — for claims that are architectural rather than
   executable. It needs a reason, a named document, and an owner; the list
   stays short and visible.

The tier is inferred from the witness location, not declared twice:

- `tests/spec-*.test.ts` — **P**, portable: pure unit or in-memory smoke;
- other `tests/*.test.ts` — **S**, in-memory smoke, except the tool/static
  files named in `tests/spec-witnesses.ts` (`docs`, `types`, `release-tools`,
  `artifact-check`, `ci-run`, `gate-cache`, `tooling-policy`, `git-guards`),
  which are **X/I4**;
- `packages/cloudflare/test/*.test.ts` — **I**, workerd integration,
  split into I1 single-coordinator, I2 cross-coordinator/outbox, and I3
  adversarial concurrency;
- static/review table — **X** or **R**.

A spec whose only witness is I must be listed in `integrationOnly` with a
one-line reason. The list is expected to shrink, never to become the default.

For example, A7 can be witnessed by the existing portable engine test that a
revoked grant kills its refresh records (`[A7]`, S), the workerd disable flow
(`[A7]`, I2), and `OH-AUTH-04` in the table (X). The gate reports all three;
the test bodies stay where they already are.

## The suite

- `tests/specs.test.ts` — the link gate. It discovers spec headings and
  tagged test titles, checks the static/review table, and prints the matrix
  (`SPEC_REPORT=1` prints it on success). It runs in the portable ring and
  needs no platform.
- `tests/spec-authority.test.ts` — new portable witnesses for authority gaps.
- `tests/spec-envelope.test.ts` — new unit witnesses for projection gaps.
- `tests/spec-portability.test.ts` — new unit/static witnesses for fence,
  fixture, parser, and world gaps.
- `tests/spec-witnesses.ts` — the static, conformance, and review witness
  table, with the `integrationOnly` reasons.
- Existing tests gain `[A#]`/`[E#]`/`[P#]` titles; no test is copied into the
  new files to earn a tag.

## Gate behavior

`tests/specs.test.ts` fails on:

- a spec heading with a duplicate or unparseable id;
- a spec id with no witness;
- a tagged id that names no spec;
- a static/review witness whose file or command no longer exists;
- an integration-only id without a reason, or a reason without an id;
- a review witness without a named document.

It reports, for every id: the cheapest witness tier, all witnesses, and
whether the id is integration-only. The gate is static; the suites remain the
proof that a tagged test passes. A tag is a claim about failure mode, not a
coverage number.

## Tiers by family

The first pass aims for these cheapest tiers; I is added where the fact only
exists across a coordinator boundary or under workerd.

| Family | Portable first | I where needed | X/R |
| --- | --- | --- | --- |
| A1, A4, A5, A14 | contract, claims, access, engine | — | — |
| A2 | outbox partial states | I2: delivery, retry, alarms | — |
| A3, A11 | public-surface/type assertions | — | X: fence |
| A6, A7, A8, A9, A15, A16 | claims, engine, activation, roster | A7/A13: disable/refresh race (I3) | — |
| A10 | conflicting-link smoke | I1: subject guard | — |
| A12 | routing-facts smoke | I1: registry projection | — |
| A13 | lost-disable smoke | I2: outbox delay | — |
| A17 | teams smoke | I1: schema and retirement effects | — |
| E1–E6, E8 | contract, claims, access, keyset | — | — |
| E7 | engine expiry and revocation window | I2: delayed revocation | — |
| P1, P2, P7, P8 | — | — | X: `bin/check`, `tsconfig.*` |
| P3, P4 | — | — | R: named architecture claim |
| P5 | fixture scan | — | X: test-only key and synthetic fixtures |
| P6 | — | I4/X: tags, artifact, release | X: release scripts |
| P9 | parser/decoder tables | I1: row and body decoders | X: fence |
| P10 | `defineWorld` refusals | — | — |

## First tests to add

Tag existing witnesses first. Then fill only the gaps the matrix shows; these
are the likely ones:

- **Authority unit/smoke** — evidence that resolves to no link creates no
  actor, participation, or grant (A1); a denied command leaves its
  idempotency key unused (A8); request-access creates no admission relation
  (A15); activation inspection exposes only usability (A16).
- **Envelope unit** — an unknown descriptive claim does not change
  verification (E3); `interfaceVersion` mismatch still verifies while the
  envelope version pair does not (E8); key-set overlap accepts the retired
  key until its last envelope expires (E5).
- **Portability unit/static** — every untrusted decoder refuses a named
  malformed shape (P9); every fixture is synthetic and every test key is
  test-only (P5); the fence and the two-ring split are named by the gate
  (P1, P2).
- **Integration tags** — the existing outbox, roster, runtime, operation,
  organization, and routing suites for A2, A7, A10, A12, A13, A17; no new
  workerd file until a gap is named.

## Segmentation

- **Ring 0** — one tagged portable file while iterating.
- **Ring 1** — the link gate plus every portable witness; no platform.
- **Ring 2** — the I1/I2 witnesses: workerd, split into single-coordinator
  and outbox/alarm/reconciliation. Run whole, per `tests/README.md`.
- **I3** — adversarial concurrency: disable/revoke/unlink against refresh,
  two refreshes of one handle, issuance racing revocation, delayed outbox.
  This is the existing `plans/refactor.md` item 6; it is not folded into the
  link gate and needs a controllable pause at the organization read.
- **I4/X** — release, artifact, tag, CI, and fence checks; these are tool
  witnesses, not workerd suites.
- **R** — P3/P4 only unless a new architectural claim appears; each carries
  its reason in the table.

## Staging

1. **Gate and tag sweep.** Build `tests/specs.test.ts` and
   `tests/spec-witnesses.ts`; tag the existing portable and workerd
   witnesses; add the `integrationOnly` reasons. A temporary unwitnessed
   list is allowed only during this phase and is removed before the phase
   closes.
   *Done when:* the gate passes; deleting a tag makes it fail; the matrix
   lists every id.
2. **Portable gaps.** Add the portable tests from the gap list; prefer in-memory
   engine and pure functions; leave I witnesses where the fact is
   platform-bound.
   *Done when:* every A/E id has a portable witness except the declared
   integration-only set, and `pnpm check` is green.
3. **Integration tags.** Tag the workerd witnesses, record I1/I2, and keep I3
   separate.
   *Done when:* `pnpm check:cloudflare` is green and every integration witness
   names its setup.
4. **Static and review table.** Record the fence, typecheck, fixture, release,
   and architecture witnesses; make the gate check that their files and
   commands still exist.
   *Done when:* no static/review entry is stale, and the review list holds
   only P3/P4 or a named new claim.
5. **Adversarial pass.** Implement the I3 cases from `plans/refactor.md` item
   6 and tag them by invariant.
   *Done when:* every stated bound has an interleaving test or a recorded
   reason why the runtime cannot express it.

## Done when

- `tests/specs.test.ts` is a fail-closed, portable gate with a readable
  matrix.
- Every spec id has at least one witness; integration-only ids have reasons.
- New unit and smoke tests close the portable gaps; workerd witnesses are
  tagged and segmented.
- `tests/README.md` documents the tag convention and the portable,
  integration, static, and review tiers.
- `specs/README.md` names the witness convention as the test-side link.
- `pnpm verify` is green, including the new suite.
- This plan is removed when those hold; the durable convention lives in
  `tests/README.md` and `specs/README.md`.

## Risks

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Tags overstate coverage | Green matrix, wrong assurance | Reviewer checks the tagged test would fail on the invariant; no tag stuffing |
| Gate is static only | A skipped or broken test still looks covered | The suites run in the rings; the gate is an index, not proof |
| Integration work hides in the matrix | Platform setup leaks into the cheap ring | `integrationOnly` requires a reason; I1/I2 run only in ring 2 |
| Static witnesses rot | A gate command disappears unnoticed | The gate checks the file/command exists; CI runs the real gate |
| Duplicate tests | Two suites drift | Tag existing tests first; add only where no witness exists |
| Tag convention becomes bureaucracy | Developers route around it | One bracket in the title, inferred tier, one report command |
