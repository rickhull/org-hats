# v2.0.0 release gate

**Status:** `v2.0.0` is tagged and pushed at `dccba61`; the root release gate
is clear. What remains is the Cloudflare tag and the consumer's adoption.
The phased plan that drove the source work is dissolved here: its results
live in `docs/authority_redesign.md` § State ownership,
`docs/cloudflare.md`, and `plans/claude_review.md` P0-P3.

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
- [x] Run the end-to-end demo smoke. Against a live `wrangler dev`:
      `/demo/bootstrap`, `/demo/login`, and `/demo/access` all succeed; the
      issued envelope carries `interfaceVersion: 2`, verifies through
      `org-hats/access`, and yields the expected neutral allow/deny checks.
      The disable-and-deny half is pinned by
      `packages/cloudflare/test/roster.test.ts` under workerd (a disabled
      actor is not admitted).
- [x] Cut `v2.0.0` (Rick): tag pushed at `dccba61`, and
      `bin/check-version v2.0.0` matches `package.json` 2.0.0. The source
      tree is green: `pnpm check`, `pnpm typecheck`, `pnpm build`, and
      `pnpm check:cloudflare` (90 portable tests, 46 Cloudflare tests) pass.
- [x] Post the tag and the migration note to
      `~/git/quartermaster/notes/from-org-hats.md`. The source-break
      correction and the fixture change (`fixtures/bootstrap/operation.json`
      grants → `target`) were already sent on 2026-10-25.
- [ ] Cut `cloudflare-v0.2.0` (package bumped from 0.1.0 to 0.2.0): the
      `token_endpoint` exchange fix, the roster projection and schema 2 → 3,
      and the 2.0.0 command surface. Rick commits the bump and tags.
- [ ] Confirm Quartermaster's adoption/re-record and answer anything they
      raise about the fixture shape or the envelope handover.

The out-of-scope review items — the `engine.ts` coordinator split, the
remaining R1/R2/R3 findings, and the typechecked-test-suite pass — stay in
`plans/code_review.md`; they are not release blockers for 2.0.0.
