# v2.0.0 release gate

**Status:** the source break is landed in the working tree; no tag is cut.
This file is the remaining gate. The phased plan that drove the source work
is dissolved here: its results live in `docs/authority_redesign.md` § State
ownership, `docs/cloudflare.md`, and `plans/claude_review.md` P0-P3, and
what remains is below.

## What must hold

- `AUTHORITY_INTERFACE_VERSION` is 2. `grant-hat` carries
  `target: GrantTarget` instead of `teamId?`/`siteId?`, so a 1.x caller must
  get `wrong-interface-version` before its command body is read.
- `ACCESS_ENVELOPE_VERSION` stays 1. Verification gates on the envelope
  version pair — `format`, the envelope's `v`, and the claims' own `v` — and
  treats the claims' `interfaceVersion` as issuer provenance. An envelope
  issued by a 1.x runtime keeps reading across the break.
- `cloudflare-v0.1.0` is not safe for real-provider login. The
  `token_endpoint` fix rides the next `cloudflare-v*` tag.

## Steps

- [x] Write the 2.0.0 migration note (`docs/migration-v2.md`): the
      `grant-hat` target shape (and `HatSummary.target`), the
      interface-version break, the unchanged envelope format and the
      provenance rule, and the Cloudflare schema and ops changes since
      1.2.0. Linked from `README.md` and `docs/README.md`.
- [ ] Run the end-to-end demo smoke: bootstrap a twin, sign in with the
      fixed dev evidence, verify a real signed envelope, then disable an
      actor and confirm the next decision denies.
- [ ] Cut `v2.0.0` with `bin/release major` (Rick). The source tree is green:
      `pnpm check`, `pnpm typecheck`, `pnpm build`, and
      `pnpm check:cloudflare` (90 portable tests, 46 Cloudflare tests) pass.
- [ ] Post the tag and the migration note to
      `~/git/quartermaster/notes/from-org-hats.md`. The source-break
      correction and the fixture change (`fixtures/bootstrap/operation.json`
      grants → `target`) were already sent on 2026-10-25.
- [ ] Cut the next `cloudflare-v*` tag carrying the exchange fix and the
      roster projection.

The out-of-scope review items — the `engine.ts` coordinator split, the
remaining R1/R2/R3 findings, and the typechecked-test-suite pass — stay in
`plans/code_review.md`; they are not release blockers for 2.0.0.
