# Publishing

*Where `org-hats` is published, how it mirrors, how a release is cut, and the rules that keep it publishable.*

## Canonical and mirror

- **Codeberg is canonical** — <https://codeberg.org/rickhull/org-hats>. The `repository`, `homepage`, and `bugs` fields point there; issues and pull requests live there.
- **GitHub is a push mirror** — <https://github.com/rickhull/org-hats>. It is a copy for reach, not a second place to work.

## The mirror

Mechanism: a **Forgejo push mirror**, configured on Codeberg under *Settings → Repository → Push mirrors*.

- **Remote:** `https://github.com/rickhull/org-hats.git`
- **Auth:** a GitHub **fine-grained PAT**, `Contents: Read and write`, scoped to that one repository. The token lives in **Codeberg**, never in this repo. Rotate it on your normal schedule — a revoked or expired token makes the mirror stop *silently*, so check it after any credential change.
- **Interval:** 6 hours, **with sync-on-commit on** — a push mirrors within minutes; the interval is a backstop. (Turn sync-on-commit off if you ever want the deliberate lag back.)
- **Scope:** push mirrors carry **branches and tags**.

Keep these true:

- **GitHub is push-only.** Never commit or tag there. A commit on the mirror desyncs it, and the next mirror run is rejected or would clobber it.
- **A rewrite needs both hosts.** If history is ever rewritten, force-push Codeberg and let the mirror resync; GitHub follows the mirror.
- **Codeberg is the truth.** GitHub holds no authority, only a copy.

## CI

CI runs on the **mirror**: GitHub Actions, [`.github/workflows/check.yml`](../.github/workflows/check.yml). On every push it installs, builds, **fails if the committed `dist/` is stale**, and runs `bin/check`; a tag push additionally fails if the tag does not match `package.json` — `bin/check-version`, run by `bin/check` and as its own early step. Because it lives on the mirror, a stalled sync stops CI as well as reach — check the mirror after any credential change.

## The release

Releases are cut with `bin/release` (bump → build → commit → tag; the tag comes from `package.json`) and pushed to both hosts. The current release is `v0.4.4`; `v0.1.0` was the first.

A consumer pins one of:

| Host | Dependency spec |
| --- | --- |
| Codeberg (canonical, immediate) | `git+https://codeberg.org/rickhull/org-hats.git#v0.4.4` |
| GitHub (mirror, lagging) | `github:rickhull/org-hats#v0.4.4` |

Prefer the Codeberg pin: the mirror's interval then never affects the consumer. The `github:` shorthand resolves only GitHub; a consumer whose CI is already GitHub-native may pin the mirror.

## Release ritual

From a clean `main`:

1. Cut it:
   ```sh
   bin/release patch        # or minor, major, or an explicit X.Y.Z
   ```
   That bumps `package.json`, updates every doc that pins the version, runs
   `bin/check`, rebuilds `dist/`, commits `vX.Y.Z`, and tags it — the manifest,
   the docs, and the tag in one act. `--dry-run` previews; `--push` also pushes.
   **Never tag by hand:** the tag comes from the manifest, so the two cannot
   disagree.
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

## Discipline

- **Tags are immutable.** Never move or delete `v0.1.0`; release by *adding* `v0.1.1`, never by rewriting a tagged commit. Force-pushing over a tag a consumer pinned is the one failure that breaks them silently.
- **A version tag must match the manifest.** `bin/check-version` fails if a `vX.Y.Z` tag disagrees with `package.json` (it also audits any tag: `bin/check-version v0.4.3`). `bin/check` runs it, so CI enforces it on every push; `bin/release` keeps the two equal by construction. The committed `.githooks/pre-push` runs the whole gate before a push leaves the machine — install it once with `git config core.hooksPath .githooks`. CI remains the backstop.
- **`dist/` must be fresh.** `bin/check` runs the fence but does not emit; only `pnpm build` does. **CI enforces it** on the mirror (`.github/workflows/check.yml`, GitHub Actions): on every push it builds, fails if `git status --porcelain -- dist` is non-empty, then runs `bin/check`.
- **CI rides the mirror.** sync-on-commit makes it timely, but the CI system *is* the mirror — a rotated PAT or a stalled sync silently stops CI as well as reach. Check the mirror after any credential change.
- **Know which host the consumer pins.** Codeberg is canonical and immediate; GitHub trails by the sync. Prefer Codeberg.

## Metadata

`package.json` carries `license: MIT`, `author: Rick <rick@thinkpad>`, and the three Codeberg URLs. `files: ["dist"]` means the installable tarball is `dist/` plus the README, LICENSE, and `package.json`. Zero runtime dependencies.
