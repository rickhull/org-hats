# Spec-driven test suite

**Status:** active 2026-10-29. The suites are the executable specification;
`specs/` is the named one. This plan makes the link explicit: every
invariant gets a witness, the witness's traits and strength are visible, and
the cheapest honest witness carries as much of the proof as it can.

## Goal

- One test-side index over `A1–A17`, `E1–E8`, and `P1–P10`.
- At least one named witness per invariant, preferring an executable
  example and otherwise the cheapest witness that can falsify it.
- Portable witnesses preferred; platform, concurrency, and release witnesses
  segmented and declared instead of silently skipped.
- A gate that fails when a spec loses its witness, a tag names no spec, or a
  static witness rots.

This does not add authority features, and it does not duplicate the domain
suites. Existing tests are tagged; executable examples are added where a
compact, honest one exists; new tests are written only for gaps.

## Linkage

The canonical key is the spec heading: `### A7 — …`, `### E3 — …`,
`### P6 — …` across `specs/*.md`.

A witness is one of:

1. **Executable example** — a fenced `spec` block in the invariant's
   Markdown, executed by the spec runner. This is the preferred witness: the
   spec text and the test expression are one artifact. The block names its id
   and traits; an unknown id or trait fails the gate.
2. **Tagged test** — a test title carries the id in brackets, for example
   `test("[A7] a revoking command kills its refresh records", …)` or
   `it("[A13] refresh re-resolves the actor at the organization", …)`.
   Multiple tags are allowed (`[A7][E7]`), but each id must be one the test
   would fail on; tag stuffing is a review rejection. This remains the
   fallback for witnesses that cannot be a compact example.
3. **Conformance citation** — a case id named in the supplementary table
   (`OH-AUTH-04`, `OH-CMD-02`), for invariants proved only through the public
   inventory.
4. **Static witness** — a command or file that enforces the invariant without
   a runtime assertion: `bin/check`, `pnpm typecheck:tests`, `tsconfig.*`,
   `tests/fixtures/*`, the release scripts.
5. **Review witness** — for claims that are architectural rather than
   executable. It needs a reason, a named document, and an owner; the list
   stays short and visible.

The legacy test tiers are inferred from location, not declared twice:
`tests/spec-*.test.ts` is **P** portable; other `tests/*.test.ts` is **S**,
except the tool/static files named in `tests/spec-witnesses.ts`, which are
**X/I4**; `packages/cloudflare/test/*.test.ts` is **I**, split into I1
single-coordinator, I2 cross-coordinator/outbox, and I3 adversarial
concurrency. They are a starting hint, not the target model.

The target model is **traits**: `unit`, `smoke`, `integration`,
`concurrency`, `static`, and `review`. A witness may carry several, and the
same test may run in more than one suite. Suites are selectors over traits,
not exclusive folders: the spec suite can include an integration example, and
the smoke suite can include an in-memory command walk. The operational gates
(`pnpm check`, `pnpm check:cloudflare`) remain the real rings.

A spec whose only witness is I must be listed in `integrationOnly` with a
one-line reason. The list is expected to shrink, never to become the default.

For example, A7 can be witnessed by the existing portable engine test that a
revoked grant kills its refresh records (`[A7]`, S), the workerd disable flow
(`[A7]`, I2), and `OH-AUTH-04` in the table (X). The gate reports all three;
the test bodies stay where they already are.

## The suite

- `tests/specs.test.ts` — the link gate. It discovers spec headings, test
  titles, and executable blocks, checks the supplementary table, and prints
  the matrix (`SPEC_REPORT=1` prints it on success). It runs in the portable
  ring and needs no platform.
- `tests/spec-runtime.ts` — the injected harness for portable `spec` blocks
  (next phase). It exposes domain use cases; it does not reimplement policy.
- `tests/spec-authority.test.ts` — portable witnesses for authority gaps.
- `tests/spec-envelope.test.ts` — unit witnesses for projection gaps.
- `tests/spec-portability.test.ts` — unit/static witnesses for fence,
  fixture, parser, and world gaps.
- `tests/spec-witnesses.ts` — the static, conformance, and review witness
  table, with the `integrationOnly` reasons.
- Existing tests gain `[A#]`/`[E#]`/`[P#]` titles; no test is copied into the
  new files to earn a tag.

## Prior art

- **Elixir `ExUnit.DocTest`** extracts `iex>` examples from `@doc` and
  `@moduledoc` and runs them with `doctest`. Examples are part of the docs and
  fail the suite when they drift.
  <https://hexdocs.pm/ex_unit/ExUnit.DocTest.html>
- **Rust rustdoc** compiles and runs code fences in documentation; attributes
  such as `ignore`, `no_run`, `should_panic`, and hidden `#` setup lines let
  authors control what is shown and what is executed.
  <https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html>
- **Python `doctest`** runs `>>>` sessions from docstrings and compares
  output, with `testmod` and `testfile` entry points.
  <https://docs.python.org/3/library/doctest.html>
- **Scala `mdoc`** typechecks and runs Markdown code fences; **mdBook**
  `test` runs code blocks in a Markdown book. These are the closest fit for a
  standalone `specs/` directory rather than source comments.
  <https://scalameta.org/mdoc/> and
  <https://rust-lang.github.io/mdBook/cli/test.html>
- **Cucumber/Gherkin** keeps feature files human-readable and binds steps in
  code; it is strong for integration language but the step layer can drift
  from the prose unless the steps are as small as the examples.

The lesson: embedded examples work when they are small, deterministic, and
exercise the public surface. They are weak for setup-heavy integration,
concurrency, and output that is not stable; those stay trait-tagged tests.

## Executable examples

A spec block is a fenced code block whose info string carries the id and
traits:

````md
```js spec=A7 traits=portable,smoke
const s = spec.world();
const issued = await s.issue("crew");
await s.disable("crew");
await s.expectFailure(s.refresh(issued), "not-admitted");
```
````

The runner extracts `spec=`, verifies the id exists, and executes portable
blocks in the portable ring. Block bodies start as JavaScript against a typed
harness; generating and typechecking a TypeScript file is a later option if
the examples need it. The harness exposes domain use cases, fixtures,
and assertions; it never reimplements reach, selection, or policy. The prose
stays normative; the block is an example and a witness, not the whole
invariant. A block that needs a coordinator declares `traits=integration` and
is run by the workerd harness, or remains a tagged integration test until that
runner exists. Skipping a block requires a review witness and a reason; there
is no silent `ignore`.

Coverage has strengths, not just presence:

1. executable block — the spec text and test expression are one artifact;
2. tagged test — a claim about the test that must fail on the invariant;
3. conformance/static/review — the enforcement is elsewhere, and the table
   says where.

A tag-only id is indexed, not executable. The gate must not report an example
as executable until the runner has actually passed it.

## Gate behavior

`tests/specs.test.ts` fails on:

- a spec heading with a duplicate or unparseable id;
- a spec id with no witness;
- a tagged id that names no spec;
- an executable block with an unknown id or trait, or one that fails to run;
- a static/review witness whose file or command no longer exists;
- an integration-only id without a reason, or a reason without an id;
- a review witness without a named document.

It reports, for every id: all witnesses, their traits, and their strength
(executable, tagged, conformance, static, review). The gate is static; the
suites remain the proof that a tagged test passes. A tag is a claim about
failure mode, not a coverage number.

## Tiers by family

The first pass used these as location hints; they are not the coverage model.
Executable blocks and traits are the target. The table still shows where a
cheap first example or test belongs.

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

## Suites as selectors

The suite names are views over traits, not moving files into new folders:

- `spec:unit` — `unit` witnesses;
- `spec:smoke` — `unit`, `smoke`, and portable executable blocks;
- `spec:integration` — `integration` and `concurrency`;
- `spec:static` — `static` and `review`.

A test or block may be selected by more than one. `pnpm check` and
`pnpm check:cloudflare` remain the actual rings; the spec suites are focused
loops. A spec id is covered when at least one witness exists, and
*executable-covered* when at least one block runs.

## First examples and tests to add

Tag existing witnesses first. Then fill only the gaps the matrix shows; these
are the likely ones:

- **First executable block** — A7: issue, disable, refresh fails; E3: an
  unknown optional claim still verifies; E7: the envelope dies at `exp`.
  Prototype A7 first and make the runner prove it.
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
2. **Executable examples and portable gaps.** Prototype `tests/spec-runtime.ts`
   and one `spec` block for A7; make the gate execute portable blocks and
   report them as executable. Then add the portable tests from the gap list;
   prefer in-memory engine and pure functions; leave I witnesses where the
   fact is platform-bound.
   *Done when:* the A7 block fails when the invariant is broken, the matrix
   marks it executable, every A/E id has a portable or executable witness
   except the declared integration-only set, and `pnpm check` is green.
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
- At least one portable executable block exists for A7, E3, and E7; examples
  that would hide setup or require a coordinator are declared as tagged tests
  with a reason instead.
- `tests/README.md` documents the executable-block, trait, and tag
  conventions, and the portable, integration, static, and review views.
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
| Tag convention becomes bureaucracy | Developers route around it | One bracket in the title, traits, one report command |
| Executable examples are samples, not proof | A green example is mistaken for a proof of the invariant | Prose stays normative; adversarial and integration tests still carry the hard cases |
| Hidden setup makes specs worse | The readable example is mostly scaffolding, or the example is unreadable | Keep setup in the harness; a block that needs more than a few lines stays a tagged test |
| Integration blocks need another runner | The portable gate claims coverage it cannot execute | Declare `traits=integration`; do not mark executable until the workerd runner passes it |
