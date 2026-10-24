# Publishing: remaining work

*Open items only. The current state and the operating rules — canonical host, mirror, CI, the release ritual, and the discipline that keeps it publishable — are in [`docs/publishing.md`](../docs/publishing.md).*

## Open

1. **GitHub repository cosmetics.** Set the description to *"Canonical: https://codeberg.org/rickhull/org-hats — a small, reusable organization model"*; disable **Issues**, **Wiki**, **Discussions** on the mirror (PRs can't be disabled); add topics — `rbac`, `authorization`, `access-control`, `permissions`, `typescript`, `sqlite`, `cloudflare-d1`, `organization`.

2. **Registry publication.** `org-hats` is unclaimed on npm and `@rickhull/org-hats` is free on JSR. Decide whether to publish to either:
   - **npm:** add `"main": "./dist/index.js"`, an `"engines"` field, and `"publishConfig": { "access": "public" }`. **Provenance** (`--provenance`) comes free here — CI now runs on GitHub.
   - **JSR:** publish TypeScript directly; consumers use `npx jsr add`. Needs a scope and a small `jsr.json`.
   - **Neither:** keep the git tag, which is already working.

3. **Consumer handoff.** Send the pin — `git+https://codeberg.org/rickhull/org-hats.git#v0.4.4` — and note that the `OH-QM-01`…`11` ids are unchanged.

4. **~~The 1.0 core freeze~~ — superseded.** The consumer has chosen a
   clean-slate second system, and 1.0 now means the authority-subsystem
   redesign: one clean breaking version, rough edges accepted. See
   [plans/v1.md](v1.md). The v0.4 tags and the `OH-QM-01…11` ids remain
   frozen as published; the v1 work happens on a fresh branch with a new
   conformance id scheme.
