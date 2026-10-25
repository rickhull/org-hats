# Plans — what's next

Strictly forward-looking. A plan names work to do, a decision to make, or a
gate to clear. It describes intent, not current behavior. When a plan is
realized it is removed or rewritten; the result belongs in `docs/` and in
commit messages. The v1 delivery plan (`v1.md`) is retired: the line it
planned is released, adopted, and documented in `docs/`.

- `code_review.md` — whole-tree code review and crystallization, one
  major subdirectory at a time. Slice 1 (`src/`) is reconciled against the
  released 2.0 line; the fixed R1/R2/R3 items are checked, and the remaining
  R1/R2/R3 findings plus R4/R5 are live.
- `type_leverage.md` — remaining type-layer follow-ups: Cloudflare
  compiler parity and the conditional numeric time brand. Provenance
  honesty, `isFailed`, the compile-only surface tests, the shared Cloudflare
  `Failure`, and the `ActiveGrant` refinement landed 2026-10-25.
- `test_suite_review.md` — the test-suite fanout: fragility and dependency
  findings, the rings, and the remaining coverage gaps in priority order.
  The typecheck gate is landed; the coverage slice follows.
- `v2_release.md` — Quartermaster acceptance of the released 2.0 / 0.3 line:
  deployment, binding smoke, schema-2 export → schema-4 restore, routing
  backfill, and the policy/fixture acceptance. No source release work here.

Retired: `claude_review.md` — P0-P3 landed in the 2.0 line.
`typechecked_tests.md` — realized 2026-10-25; the gate now runs in
`bin/check`. Delete both files when convenient.

Completed work is not kept here. What exists is in `docs/`; how it got here
is in the commit history.
