# Publishing: remaining work

*Open items only. The current state — canonical host, mirror, CI, tag, and pin — is in [`docs/publishing.md`](../docs/publishing.md).*

## Open

1. **GitHub repository cosmetics.** Set the description to *"Canonical: https://codeberg.org/rickhull/org-hats — a small, reusable organization model"*; disable **Issues**, **Wiki**, **Discussions** on the mirror (PRs can't be disabled); add topics — `rbac`, `authorization`, `access-control`, `permissions`, `typescript`, `sqlite`, `cloudflare-d1`, `organization`.

2. **Registry publication.** `org-hats` is unclaimed on npm and `@rickhull/org-hats` is free on JSR. Decide whether to publish to either:
   - **npm:** add `"main": "./dist/index.js"`, an `"engines"` field, and `"publishConfig": { "access": "public" }`. **Provenance** (`--provenance`) comes free here — CI now runs on GitHub.
   - **JSR:** publish TypeScript directly; consumers use `npx jsr add`. Needs a scope and a small `jsr.json`.
   - **Neither:** keep the git tag, which is already working.

3. **Consumer handoff.** Send the pin — `git+https://codeberg.org/rickhull/org-hats.git#v0.4.4` — and note that the `OH-QM-01`…`11` ids are unchanged.

4. **The 1.0 core freeze** (on the roadmap at the consumer's request — do not cut yet). Freezes: the five entities, `SCHEMA`'s shape, the port, `decide`/`DecideRequest`/`Decision`, `heldCarries`, and the `OH-QM` ids — additions-only after. **Entry criteria** (the consumer's):
   - the write-side conference — **done** ([docs/writes.md](../docs/writes.md));
   - the **landing rule** settled at the session layer: one primary per organization, so a multi-organization actor's landing hat is a host decision — the spine takes a position (`organizationId` as request context) but the interaction is the host's;
   - the **multi-organization read rule** decided: the site half is structural (read reach follows team-bearing grants at the site); whether to union every organization served or follow the worn hat is host policy, settled by a real read policy.
   Until then: deliberate 0.x changes with a consumer conference, which has served both sides.

5. **Tag hygiene.** Never tag by hand — use `bin/release`, which takes the tag from `package.json` and sweeps every doc that pins the version, so the manifest, the docs, and the tag are one act. The `v4.0.0` and `v0.4.3` misfires were a hand-set tag and an unbumped manifest.

## Discipline now that something depends on us

- **Tags are immutable.** Never move or delete `v0.1.0`; release by *adding* `v0.1.1`, never by rewriting a tagged commit. Force-pushing over a tag a consumer pinned is the one failure that breaks them silently.
- **A version tag must match the manifest.** `bin/check-version` fails if a `vX.Y.Z` tag disagrees with `package.json` (it also audits any tag: `bin/check-version v0.4.3`). `bin/check` runs it, so CI enforces it on every push; `bin/release` keeps the two equal by construction.
- **`dist/` must be fresh.** `bin/check` runs the fence but does not emit; only `pnpm build` does. **CI enforces it** on the mirror (`.github/workflows/check.yml`, GitHub Actions): on every push it builds, fails if `git diff --quiet -- dist` is non-empty, then runs `bin/check`.
- **CI rides the mirror.** sync-on-commit makes it timely, but the CI system *is* the mirror — a rotated PAT or a stalled sync silently stops CI as well as reach. Check the mirror after any credential change.
- **Know which host the consumer pins.** Codeberg is canonical and immediate; GitHub trails by the sync. Prefer Codeberg.

## Release ritual

From a clean `main`:

1. Cut it:
   ```sh
   bin/release patch        # or minor, major, or an explicit X.Y.Z
   ```
   That bumps `package.json`, updates every doc that pins the version, runs
   `bin/check`, rebuilds `dist/`, commits `vX.Y.Z`, and tags it — the manifest,
   the docs, and the tag in one act. `--dry-run` previews; `--push` also pushes.
2. Push to the canonical host (skip if `--push`ed):
   ```sh
   git push origin main
   git push origin vX.Y.Z
   ```
3. Let the mirror sync (immediate on commit; otherwise *Sync now*), confirm **CI is green**, then verify both hosts show the same commit and tag:
   ```sh
   git ls-remote --heads --tags git@codeberg.org:rickhull/org-hats.git
   git ls-remote --heads --tags https://github.com/rickhull/org-hats.git
   ```
