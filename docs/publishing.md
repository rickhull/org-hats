# Publishing

*Where `org-hats` is published, how it mirrors, and how a consumer pins it.*

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

CI runs on the **mirror**: GitHub Actions, [`.github/workflows/check.yml`](../.github/workflows/check.yml). On every push it installs, builds, **fails if the committed `dist/` is stale**, and runs `bin/check`. Because it lives on the mirror, a stalled sync stops CI as well as reach — check the mirror after any credential change.

## The release

`v0.1.0` — a single sanitized commit, tagged on both hosts.

A consumer pins one of:

| Host | Dependency spec |
| --- | --- |
| Codeberg (canonical, immediate) | `git+https://codeberg.org/rickhull/org-hats.git#v0.1.0` |
| GitHub (mirror, lagging) | `github:rickhull/org-hats#v0.1.0` |

Prefer the Codeberg pin: the mirror's interval then never affects the consumer. The `github:` shorthand resolves only GitHub; a consumer whose CI is already GitHub-native may pin the mirror.

## Metadata

`package.json` carries `license: MIT`, `author: Rick <rick@thinkpad>`, and the three Codeberg URLs. `files: ["dist"]` means the installable tarball is `dist/` plus the README, LICENSE, and `package.json`. Zero runtime dependencies.

## How this repo was made publishable

Recorded here so no one has to reconstruct it:

- **History was squashed to a single root commit** and the old objects purged, so no prior state (or the names in it) survives in the published object store.
- **Fixtures were substituted** to an obviously fictional world — operation **Acme Freight**, organizations **Atlas / Beacon / Cobalt**, sites **Northport / Southport**, and invented personal names — across `examples/`, the narrative docs, and (before it was dropped) the Ruby appendix.
- **The previous consumer's confidential tier was removed**: its product name, private repo path, internal doc names, and decision ids. Only the **`OH-QM` initialism** was kept, with one line explaining it, because the conformance ids are a shared interface.
- **The Ruby appendix was dropped** from the public repo.

Decisions taken:

| # | Decision | Taken |
| --- | --- | --- |
| D1 | License | MIT — `Copyright (c) 2026 Rick <rick@thinkpad>` |
| D2 | Ruby appendix | dropped |
| D3 | `docs/concerns.md` | sanitized in place, kept public |
| D4 | the integration memo | deleted |
| D5 | Package name | `org-hats` |

## Verified

- A fresh clone of Codeberg, with no dependencies installed, runs `node examples/check.ts` → all examples pass (including the ten conformance cases).
- `main` and `v0.1.0` are **identical on both hosts** (same commit, same annotated tag).
- The tree is free of the forbidden strings (the consumer's tier and the old fixtures).

See [package.md](package.md) for what the package ships, and [`../plans/publish.md`](../plans/publish.md) for the work that remains.
