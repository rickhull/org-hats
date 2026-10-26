# Publishing

*Where `org-hats` is published, how it mirrors, how a release is cut, and the rules that keep it publishable.*

## Canonical and mirror

- **Codeberg is canonical** — <https://codeberg.org/rickhull/org-hats>. The `repository`, `homepage`, and `bugs` fields point there; issues and pull requests live there.
- **GitHub is a release mirror** — <https://github.com/rickhull/org-hats>. It is updated only when a release is cut, and is a hand-off copy for reach, not a second place to work.

## Mirroring to GitHub

GitHub is updated by the release mechanism, not by a per-commit or periodic
mirror. `bin/release ... --push` pushes the release commit and its tag to
`origin`, then the same branch and tag to `github`. There is no separate
mirror push step.

Set the remote once per clone:

```sh
git remote add github git@github.com:rickhull/org-hats.git
```

If `--push` finds no `github` remote, it still pushes `origin` and says the
mirror was skipped. If the GitHub push fails after `origin` succeeded,
retry:

```sh
git push github HEAD
git push github <tag>
```

The pre-push gate runs on both pushes; the per-commit gate cache reuses the
Codeberg pass for the mirror push when the tree is unchanged and clean. A
first catch-up validates every tag except the historical `v0.4.3` mis-tag,
which the hook skips explicitly (below).

Verify both hosts:

```sh
git ls-remote --heads origin main
git ls-remote --heads github main
```

A Forgejo push mirror may still be configured on Codeberg. Treat it as an
optional convenience, not the mechanism: when its PAT expires it stops
silently, and a stalled mirror stops GitHub CI with it. The release push is
the supported path.

Keep these true:

- **GitHub is push-only.** Never commit or tag there. A commit on the mirror
desyncs it, and the next push is rejected or would clobber it.
- **A rewrite needs both hosts.** If history is ever rewritten, force-push
Codeberg and then force-push the GitHub mirror; GitHub follows only when
told.
- **Codeberg is the truth.** GitHub holds no authority, only a copy.

**Current status:** GitHub carries every `bin/release --push`; branch commits
after the last release wait for the next one.

**Historical anomaly:** `v0.4.3` points at `8d2551d` ("docs update /
cleanup"), whose `package.json` is `0.4.2`; `v0.4.4` is the commit that fixes
the release metadata. The tag is immutable and already published. The
pre-push hook skips it explicitly so a catch-up can validate every other tag;
`bin/check-version v0.4.3` still fails it by design.

## CI

Codeberg is the per-push CI. Hosted Forgejo Actions runs
[`.forgejo/workflows/check.yml`](../.forgejo/workflows/check.yml) on every
push and on `workflow_dispatch`, on `codeberg-small`:

- checkout with tags (`fetch-depth: 0`), pnpm 11.21.0, Node 24;
- `pnpm install --frozen-lockfile --filter org-hats` — root only, so workerd
  and vitest stay off the light runner;
- `bin/check-dist` and `bin/check`.

The first run was green: 96 portable tests in about 1m25s, well inside the
5-minute cap. Workerd is not on this runner; it stays in the local and
release rings.

GitHub Actions remains the **release-mirror backstop**: it runs only when
`bin/release --push` updates GitHub. It installs the workspace, runs
`bin/check-dist` and `bin/check`, and runs the workerd suites in a separate
job; a tag push also runs `bin/check-version`.

The live gate for a working checkout is still the local pre-push hook and
`pnpm verify`; CI is the remote evidence.

### Codeberg CI setup

Actions must be enabled in the repository (Settings → Units → Overview →
Enable Actions). The CLI path is:

```sh
# once per clone; use an application token, not the OAuth browser flow
fj auth add-token          # token from codeberg.org/user/settings/applications
fj auth list
fj repo units rickhull/org-hats actions --enable true
```

Grant the token `repository` read/write (and `user` read if you want
`fj whoami`). `fj auth login` waits for an OAuth callback on
`127.0.0.1:26218`; it hangs in a headless or remote session. The token and
host are stored durably in `~/.local/share/forgejo-cli/keys.json` (mode 600),
so `-H` is only needed to override the repository's host.

The run history is at <https://codeberg.org/rickhull/org-hats/actions> and
through `GET /api/v1/repos/rickhull/org-hats/actions/runs`.
`fj actions tasks -r rickhull/org-hats` shows the task list and status — the
first run was `success` in 1m25s. A manual dispatch is
`fj actions dispatch -r rickhull/org-hats check.yml main`.

## The release

Releases are cut with `bin/release` (bump → verify → build → commit → tag; the tag comes from the manifest) and `--push` sends the release commit and tag to both hosts; GitHub receives release updates only. `v0.4.4` is the last v0.4 release; `v1.0.0` is historical; the current line is v2.x. The Cloudflare reference runtime is released from the same script with `--package cloudflare`.

A consumer pins one of:

| Host | Dependency spec |
| --- | --- |
| Codeberg (canonical, immediate) | `git+https://codeberg.org/rickhull/org-hats.git#vX.Y.Z` |
| GitHub (mirror, lagging) | `github:rickhull/org-hats#vX.Y.Z` |

Replace `vX.Y.Z` with the release tag. `v0.4.4` remains the last frozen v0.4 pin; the latest tag is the pin target — no plan tracks it. The Cloudflare package releases on its own cadence as `cloudflare-vX.Y.Z`; the same guard validates it against `packages/cloudflare/package.json`. Prefer the Codeberg pin: the mirror's lag then never affects the consumer. The `github:` shorthand resolves only GitHub; a consumer whose CI is already GitHub-native may pin the mirror.

Pick the bump from the surface: `minor` for an additive public export or model
fact, `patch` for a fix within the released surface, and `major` when the
authority interface breaks. The Cloudflare package follows its own 0.x
cadence and ships its fixes as patches; a root release does not move a
Cloudflare tag.

## Deployment is not publishing

A `cloudflare-v*` tag is the upstream release act; deploying it is the
consuming host's act. The host verifies the tag and the production
configuration at that commit, snapshots state, uploads a Worker Version,
activates it, and verifies it. The shape is in
[cloudflare.md](cloudflare.md#deployment-contract).

Upstream does not ship a deploy porcelain: the Cloudflare account, Worker,
secrets, traffic, and service binding belong to the deploying host. The
reference deployment is live at `cloudflare-v0.4.0`; the host's ops
porcelain owns `candidate` / `release` / `configure` / `smoke`, with the
registry projection as its follow-on. State restore and the routing-facts
backfill are acceptance acts, not deploy steps.

## Release ritual

From a clean `main`:

1. Cut and push it:
   ```sh
   bin/release patch --push                    # root: vX.Y.Z
   bin/release --package cloudflare minor --push
   ```
   That bumps the selected manifest, runs `bin/check-dist` and `bin/check`
   (plus the Cloudflare suites for a root release), rebuilds `dist/`, commits
   the manifest and generated output, and tags the commit. It re-checks the
   new tag with `bin/check-version` before anything is pushed — the tag and
   manifest cannot disagree. `--push` then sends the branch and tag to
   `origin`, and the same to `github` when that remote exists. `--dry-run`
   previews; `--no-cloudflare` skips the workspace suites on a root release.
   **Never tag by hand.**  A Cloudflare release also runs
   `bin/check-deploy` before the commit and tag; the host-neutral sequence is
   in [`deploy_runbook.md`](deploy_runbook.md).

   Docs that name the artifacts move with the window: the README version table
   and the additive note in `migration-v2.md` move before the root tag; the
   live-deployment references in `cloudflare.md`, `binding-conformance.md`,
   the deployment paragraph in this file, `positioning.md`, `from_ldap.md`,
   and `migration-v2.md` move after the host deploy, because they describe
   what is running.
2. If the release was cut without `--push`, send it to both hosts:
   ```sh
   git push origin HEAD
   git push origin <tag>
   git push github HEAD
   git push github <tag>
   ```
3. Verify both hosts show the same commit and tag:
   ```sh
   git ls-remote --heads origin main
   git ls-remote --heads github main
   ```
   GitHub CI runs when the release is pushed; it is a release-time backstop.

## Discipline

- **Tags are immutable.** Never move or delete `v0.1.0`; release by *adding* `v0.1.1`, never by rewriting a tagged commit. Force-pushing over a tag a consumer pinned is the one failure that breaks them silently.
- **A release tag must match its manifest.** `bin/check-version` validates both families: `vX.Y.Z` against `package.json`, `cloudflare-vX.Y.Z` against `packages/cloudflare/package.json` (it also audits any tag: `bin/check-version v0.4.3`, `bin/check-version cloudflare-v0.2.0`). `bin/check` runs it, so CI enforces it on every mirror push; `bin/release` keeps the two equal by construction and re-checks the tag it just made. The committed `.githooks/pre-push` runs the root gate before a push leaves the machine — install it once with `git config core.hooksPath .githooks`. CI remains the backstop.
- **`dist/` must be fresh.** `bin/check` runs the fence but does not emit; `pnpm build` does. `bin/check-dist` builds and fails if `git status --porcelain -- dist` is non-empty; the pre-push hook and **CI** both run it, so the local gate and the remote gate answer the same question in the same order.
- **A gated commit is recorded locally.** A passing pre-push gate writes a marker under `.git/org-hats-gates/` keyed by the commit and a fingerprint of the runtime, compiler, and installed tree. A second push of the same clean commit (origin, then the mirror) reuses it; a dirty tree, a new commit, or a changed toolchain does not. The marker is local and never a release authority — `bin/release` and CI run their own gates.
- **Codeberg CI is the per-push gate; GitHub CI is release-time.** `.forgejo/workflows/check.yml` runs on every Codeberg push; GitHub Actions runs only when the release mirror is updated. Workerd stays in the local and release rings.
- **Know which host the consumer pins.** Codeberg is canonical and immediate; GitHub trails until the next release push. Prefer Codeberg.

## Metadata

`package.json` carries `license: MIT`, `author: Rick <rick@thinkpad>`, and the three Codeberg URLs. `files: ["dist", "SECURITY.md"]` means the installable tarball is `dist/` plus the README, LICENSE, SECURITY.md, and `package.json`. Zero runtime dependencies.

## Open

- **GitHub repository cosmetics.** Set the mirror's description to *"Canonical: https://codeberg.org/rickhull/org-hats — a portable organizational authority subsystem"*; disable **Issues**, **Wiki**, **Discussions** on the mirror (PRs can't be disabled); add topics — `authorization`, `access-control`, `rbac`, `permissions`, `typescript`, `cloudflare-workers`, `ed25519`.
