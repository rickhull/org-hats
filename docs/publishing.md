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

**Current status (2026-10-25): the mirror is down and being repaired.**
GitHub is frozen at the repository's root commit with only `v0.1.0`
tagged; the standing mirror has effectively never run, most likely on an
expired PAT. Canonical hosting and Codeberg-first consumer pins are
unaffected. The repair is [`plans/gh_mirror.md`](../plans/gh_mirror.md);
until it lands, Codeberg is the only live host and mirror CI is dark.

## CI

CI runs on the **mirror**: GitHub Actions, [`.github/workflows/check.yml`](../.github/workflows/check.yml). On every push it installs, runs **`bin/check-dist`** (build and fail if the committed `dist/` is stale), then runs `bin/check`. A tag push additionally fails if the tag does not match the manifest for its family — `bin/check-version`, run by `bin/check` and as its own early step. The workerd suites run in a separate job, after the same build. Because CI lives on the mirror, a stalled sync stops CI as well as reach — check the mirror after any credential change.

## The release

Releases are cut with `bin/release` (bump → verify → build → commit → tag; the tag comes from the manifest) and pushed to both hosts. `v0.4.4` is the last v0.4 release; `v1.0.0` is historical; the current line is v2.x. The Cloudflare reference runtime is released from the same script with `--package cloudflare`.

A consumer pins one of:

| Host | Dependency spec |
| --- | --- |
| Codeberg (canonical, immediate) | `git+https://codeberg.org/rickhull/org-hats.git#vX.Y.Z` |
| GitHub (mirror, lagging) | `github:rickhull/org-hats#vX.Y.Z` |

Replace `vX.Y.Z` with the release tag. `v0.4.4` remains the last frozen v0.4 pin; the latest tag is the pin target — no plan tracks it. The Cloudflare package releases on its own cadence as `cloudflare-vX.Y.Z`; the same guard validates it against `packages/cloudflare/package.json`. Prefer the Codeberg pin: the mirror's interval then never affects the consumer. The `github:` shorthand resolves only GitHub; a consumer whose CI is already GitHub-native may pin the mirror.

## Release ritual

From a clean `main`:

1. Cut it:
   ```sh
   bin/release patch                    # root: vX.Y.Z
   bin/release --package cloudflare minor
   ```
   That bumps the selected manifest, runs `bin/check-dist` and `bin/check`
   (plus the Cloudflare suites for a root release), rebuilds `dist/`, commits
   the manifest and generated output, and tags the commit. It re-checks the
   new tag with `bin/check-version` before anything is pushed — the tag and
   manifest cannot disagree. `--dry-run` previews; `--push` also pushes.
   `--no-cloudflare` skips the workspace suites on a root release.
   **Never tag by hand.**
2. Push to the canonical host (skip if `--push`ed):
   ```sh
   git push origin <branch>
   git push origin vX.Y.Z
   ```
3. Let the mirror sync (immediate on commit; otherwise *Sync now*), confirm **CI is green**, then verify both hosts show the same commit and tag:
   ```sh
   git ls-remote --heads --tags git@codeberg.org:rickhull/org-hats.git
   git ls-remote --heads --tags https://github.com/rickhull/org-hats.git
   ```

## Discipline

- **Tags are immutable.** Never move or delete `v0.1.0`; release by *adding* `v0.1.1`, never by rewriting a tagged commit. Force-pushing over a tag a consumer pinned is the one failure that breaks them silently.
- **A release tag must match its manifest.** `bin/check-version` validates both families: `vX.Y.Z` against `package.json`, `cloudflare-vX.Y.Z` against `packages/cloudflare/package.json` (it also audits any tag: `bin/check-version v0.4.3`, `bin/check-version cloudflare-v0.2.0`). `bin/check` runs it, so CI enforces it on every push; `bin/release` keeps the two equal by construction and re-checks the tag it just made. The committed `.githooks/pre-push` runs the root gate before a push leaves the machine — install it once with `git config core.hooksPath .githooks`. CI remains the backstop.
- **`dist/` must be fresh.** `bin/check` runs the fence but does not emit; `pnpm build` does. `bin/check-dist` builds and fails if `git status --porcelain -- dist` is non-empty; the pre-push hook and **CI** both run it, so the local gate and the remote gate answer the same question in the same order.
- **CI rides the mirror.** sync-on-commit makes it timely, but the CI system *is* the mirror — a rotated PAT or a stalled sync silently stops CI as well as reach. Check the mirror after any credential change.
- **Know which host the consumer pins.** Codeberg is canonical and immediate; GitHub trails by the sync. Prefer Codeberg.

## Metadata

`package.json` carries `license: MIT`, `author: Rick <rick@thinkpad>`, and the three Codeberg URLs. `files: ["dist", "SECURITY.md"]` means the installable tarball is `dist/` plus the README, LICENSE, SECURITY.md, and `package.json`. Zero runtime dependencies.

## Open

- **GitHub repository cosmetics.** Set the mirror's description to *"Canonical: https://codeberg.org/rickhull/org-hats — a portable organizational authority subsystem"*; disable **Issues**, **Wiki**, **Discussions** on the mirror (PRs can't be disabled); add topics — `authorization`, `access-control`, `rbac`, `permissions`, `typescript`, `cloudflare-workers`, `ed25519`.
