# Publishing org-hats

*Ship the package to **Codeberg** as the canonical public repository, with
**GitHub as an automatic, lagging mirror**. The anti-leak work is done; this is
the plan for the push, the mirror, and the handoff.*

## Status: sanitization complete

- History squashed to a **single root commit**; the old objects purged.
- Fixtures substituted to an obviously fictional world — operation **Acme Freight**, organizations **Atlas / Beacon / Cobalt**, sites **Northport / Southport**, and invented personal names.
- The previous consumer's confidential tier removed (product name, private paths, internal doc names, decision ids); the **`OH-QM` initialism kept**, with one line explaining it.
- **MIT** license; the **Ruby appendix dropped** from the public repo.

Decisions, as taken:

| # | Decision | Taken |
| --- | --- | --- |
| D1 | License | MIT — `Copyright (c) 2026 Rick <rick@thinkpad>` |
| D2 | Ruby appendix | dropped |
| D3 | `docs/concerns.md` | sanitized in place, kept public |
| D4 | the integration memo | deleted |
| D5 | Package name | `org-hats` |

## Where it publishes

- **Codeberg is canonical.** The `repository`, `homepage`, and `bugs` fields point there, and issues and pull requests live there.
- **GitHub is a push mirror.** Codeberg holds a GitHub token and pushes to it on a schedule, so GitHub **trails Codeberg by the mirror interval**. The lag is deliberate: one place to commit, one set of credentials, no CI in this repo.

Consumers may pin either host — the tag is on both.

## The mirror, and why the lag is fine

Mechanism: a **Forgejo push mirror** (Codeberg runs Forgejo), configured under
*Settings → Repository → Push mirrors*.

- **Remote:** `https://github.com/rickhull/org-hats.git`
- **Auth:** a GitHub **fine-grained PAT**, `Contents: Read and write`, scoped to that one repository. The token lives in **Codeberg**, never in this repo. Rotate it on your normal schedule, and check the mirror after any credential change — a revoked token makes it stop silently.
- **Interval:** the default is hours. That is the transitive lag; a release appears on GitHub after the next sync, or when you press *Sync now*.
- **Scope:** push mirrors carry **branches and tags**.

Keep these true:

- **GitHub is push-only.** Never commit or tag there. A commit on the mirror desyncs it, and the next mirror run is rejected or would clobber it.
- **A rewrite needs both hosts.** If history is ever rewritten, force-push Codeberg and let the mirror resync; GitHub's copy follows the mirror.
- **The mirror is not a backup of authority.** Codeberg is the truth; GitHub is a copy for reach.

## Steps

1. **Metadata.** Add the Codeberg URLs to `package.json`:

   ```json
   "repository": { "type": "git", "url": "git+https://codeberg.org/rickhull/org-hats.git" },
   "homepage": "https://codeberg.org/rickhull/org-hats",
   "bugs": { "url": "https://codeberg.org/rickhull/org-hats/issues" }
   ```

   Then **amend** the root commit — it is not pushed, so no second commit:

   ```sh
   git add package.json && git commit --amend --no-edit
   ```

2. **Create the Codeberg repo** `org-hats`: public, default branch `main`, **no** forge-provided README or license (both exist here).

3. **Push `main` and the tag:**

   ```sh
   git remote add origin git@codeberg.org:rickhull/org-hats.git
   git push -u origin main
   git tag -a v0.1.0 -m "v0.1.0"
   git push origin v0.1.0
   ```

4. **Configure the push mirror:** add the GitHub remote URL and the fine-grained token; set the interval; press *Sync now* for the first run.

5. **Settle the GitHub side:** confirm `main` and `v0.1.0` arrived; set the description to *"Canonical repository: https://codeberg.org/rickhull/org-hats"*; disable **Issues**, **Wiki**, and **Discussions** (PRs cannot be disabled — a note in the description is the pointer).

6. **Hand off** to the consumer: the ids are unchanged (`OH-QM-01`…`10`), and here is the tag to pin.

## What consumers pin

The tag is on both hosts; the URL forms differ.

| Host | Dependency spec |
| --- | --- |
| Codeberg (canonical) | `git+https://codeberg.org/rickhull/org-hats.git#v0.1.0` |
| GitHub (mirror) | `github:rickhull/org-hats#v0.1.0` |

The `github:` shorthand resolves only GitHub; a consumer whose CI already clones from GitHub can pin the mirror while Codeberg stays canonical.

## Acceptance

- **Codeberg:** one commit, clean tree, `v0.1.0` present.
- **GitHub mirror:** `main` and `v0.1.0` present; description points to Codeberg; issues/wiki/discussions off.
- **Either host:** `git clone` → `pnpm install` → `bin/check` green.
- **The sweep:** no forbidden string in the tree (the `.sweep-patterns` check, or its manual equivalent) — run once against Codeberg before **Step 4**, since the mirror copies whatever Codeberg has.
