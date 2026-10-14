# Publishing: remaining work

*Open items only. The current state — canonical host, mirror, CI, tag, and pin — is in [`docs/publishing.md`](../docs/publishing.md).*

## Open

1. **GitHub repository cosmetics.** Set the description to *"Canonical: https://codeberg.org/rickhull/org-hats — a small, reusable organization model"*; disable **Issues**, **Wiki**, **Discussions** on the mirror (PRs can't be disabled); add topics — `rbac`, `authorization`, `access-control`, `permissions`, `typescript`, `sqlite`, `cloudflare-d1`, `organization`.

2. **Registry publication.** `org-hats` is unclaimed on npm and `@rickhull/org-hats` is free on JSR. Decide whether to publish to either:
   - **npm:** add `"main": "./dist/index.js"`, an `"engines"` field, and `"publishConfig": { "access": "public" }`. **Provenance** (`--provenance`) comes free here — CI now runs on GitHub.
   - **JSR:** publish TypeScript directly; consumers use `npx jsr add`. Needs a scope and a small `jsr.json`.
   - **Neither:** keep the git tag, which is already working.

3. **Consumer handoff.** Send the pin — `git+https://codeberg.org/rickhull/org-hats.git#v0.1.0` — and note that the `OH-QM-01`…`10` ids are unchanged.

## Discipline now that something depends on us

- **Tags are immutable.** Never move or delete `v0.1.0`; release by *adding* `v0.1.1`, never by rewriting a tagged commit. Force-pushing over a tag a consumer pinned is the one failure that breaks them silently.
- **`dist/` must be fresh.** `bin/check` runs the fence but does not emit; only `pnpm build` does. **CI enforces it** on the mirror (`.github/workflows/check.yml`, GitHub Actions): on every push it builds, fails if `git diff --quiet -- dist` is non-empty, then runs `bin/check`.
- **CI rides the mirror.** sync-on-commit makes it timely, but the CI system *is* the mirror — a rotated PAT or a stalled sync silently stops CI as well as reach. Check the mirror after any credential change.
- **Know which host the consumer pins.** Codeberg is canonical and immediate; GitHub trails by the sync. Prefer Codeberg.

## Release ritual

1. Bump `version` in `package.json`.
2. `pnpm build`, then commit **source, `dist/`, and the version together**.
3. Tag and push to the canonical host:
   ```sh
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```
4. Let the mirror sync (immediate on commit; otherwise *Sync now*), confirm **CI is green**, then verify both hosts show the same commit and tag:
   ```sh
   git ls-remote --heads --tags git@codeberg.org:rickhull/org-hats.git
   git ls-remote --heads --tags https://github.com/rickhull/org-hats.git
   ```
