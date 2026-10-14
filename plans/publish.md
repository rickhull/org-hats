# Publishing: remaining work

*Open items only. The current state — canonical host, mirror config, tag, and pin — is in [`docs/publishing.md`](../docs/publishing.md).*

## Open

1. **Sync-on-commit.** Off today, so the mirror trails by up to the 6h interval and a release tag reaches GitHub only on the next sync. Decide: **enable it** (a near-real-time mirror; the interval stays as a backstop), or **keep it off** and make *Sync now* a step in the release ritual below.

2. **GitHub repository cosmetics.** Set the description to *"Canonical: https://codeberg.org/rickhull/org-hats — a small, reusable organization model"*; disable **Issues**, **Wiki**, **Discussions** (PRs can't be disabled); add topics — `rbac`, `authorization`, `access-control`, `permissions`, `typescript`, `sqlite`, `cloudflare-d1`, `organization`.

3. **Registry publication.** `org-hats` is unclaimed on npm, and `@rickhull/org-hats` is free on JSR. Decide whether to publish to either:
   - **npm:** simple, but ESM-only and needs Node ≥ 22.5 for the adapter; add `"main": "./dist/index.js"`, an `"engines"` field, and `"publishConfig": { "access": "public" }`. **Provenance** (`--provenance`) needs a GitHub Action — unavailable from a Codeberg-only CI.
   - **JSR:** the open alternative; publishes TypeScript and serves `.d.ts`; consumers use `npx jsr add`. Needs a scope (`@rickhull`) and a small `jsr.json`.
   - **Neither:** keep the git tag, which is already working.

4. **Consumer handoff.** Send the pin: `git+https://codeberg.org/rickhull/org-hats.git#v0.1.0` — and the note that the `OH-QM-01`…`10` ids are unchanged.

## Release ritual (for future versions)

1. Bump `version` in `package.json`.
2. Commit it.
3. Tag and push to the canonical host:
   ```sh
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```
4. Let the mirror sync (or press *Sync now*), then **verify**: `git ls-remote --tags --heads` on both hosts should show the same commit and tag.
