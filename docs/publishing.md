# Publishing

*Where `org-hats` is published, how it mirrors, how a release is cut, and the rules that keep it publishable to its subscribers.*

## Canonical forge and public mirrors

- **The NAS forge is canonical** — remote `origin` at
  `ssh://forge@nas/home/forge/repos/org-hats.git`. Its bare repository is
  the release authority, and `main` tracks `origin/main`.
- **Codeberg is a public release mirror** —
  <https://codeberg.org/rickhull/org-hats>, remote `codeberg`. Public project
  metadata and reporting intake remain there because the NAS forge is not a
  public web service.
- **GitHub is a public release mirror** —
  <https://github.com/rickhull/org-hats>, remote `github`.

The public mirrors are reach and availability copies, not places to work.
`bin/release` first atomically publishes the release branch and new tag to
`origin`. Only after that succeeds does it push `HEAD --follow-tags` to each
configured mirror. A missing or unavailable mirror warns but does not
invalidate the canonical release. The next successful release push advances
the mirror branch and sends every reachable annotated tag it missed.

`nas` is the LAN name; the Tailscale alias `nas-ts` reaches the same host.

### Provisioning the NAS authority (one-time; NAS owner)

The maintainer does not create this repository. The NAS owner creates it as
root on `nas` with the forge task:

```sh
rake forge:repo[org-hats]
```

The task initializes a bare repository, sets `core.logAllRefUpdates true`, and
chowns it to `forge`. It leaves `HEAD` on an unborn `master`, so set it to the
branch this repository publishes before seeding:

```sh
sudo -u forge git -C /home/forge/repos/org-hats.git symbolic-ref HEAD refs/heads/main
```

The task does not set `receive.denyDeletes` or
`receive.denyNonFastForwards`; tag immutability is a release-process rule
unless the owner adds those two settings. No web UI, Caddy route, or hosted
mirror is involved, and the owner pushes no content.

### Configure a maintainer clone

A clone that predates the migration has `origin` pointing at Codeberg:

```sh
git remote rename origin codeberg
git remote add origin ssh://forge@nas/home/forge/repos/org-hats.git
git remote add github git@github.com:rickhull/org-hats.git   # if absent
git config push.followTags true
```

A fresh clone adds `origin`, `codeberg`, and `github` with the same URLs and
sets the same `push.followTags` default. Then seed the authority once and set
the upstream. `--all` and `--tags` are mutually exclusive, so the seed is two
pushes:

```sh
git push --atomic origin --all
git push --atomic origin --tags
git fetch origin
git branch --set-upstream-to=origin/main main
```

The seed is the only push that carries every ref. The pre-push hook
validates every tag in the second push (the historical `v0.4.3` is skipped).
`cloudflare-v0.5.0` is not reachable from `main`, so the `--tags` push
carries it; the ordinary release `--follow-tags` path would not.

`push.followTags true` makes every plain `git push <remote>` carry the
annotated tags reachable from the pushed refs that the remote lacks — the same
behavior as `--follow-tags`. All release tags are annotated. It does not carry
tags outside the pushed history, so the one-time seed still needs `--tags`.
The release script passes `--follow-tags` explicitly and does not depend on
this clone setting.

For a release created with `--no-push`, publish in authority order:

```sh
git push --atomic origin HEAD <tag>
git push codeberg HEAD --follow-tags
git push github HEAD --follow-tags
```

If the NAS push fails, `bin/release` exits nonzero, leaves the local release
commit and tag intact, and does not advance either mirror. Retry the exact NAS
command, then catch up the mirrors. Mirror failure is deliberately non-fatal;
it may be retried immediately with the command above or left for the next
release.

Verify authority and mirrors independently:

```sh
git ls-remote --symref origin HEAD
git ls-remote --heads origin main
git ls-remote --heads codeberg main
git ls-remote --heads github main
```

No hosted push-mirror feature is part of the design. Tokens expire and hosted
mirroring failures can be silent; the repository-owned release command is the
auditable replication path.

Keep these true:

- **NAS is the authority.** A public mirror never substitutes for a failed
  NAS publication.
- **Both public hosts are push-only mirrors.** Never commit or tag there.
- **Mirror lag is acceptable and self-repairing.** A later release catches up
  the branch and reachable annotated tags.
- **Tags are never rewritten.** Repair by adding a release or replaying the
  ordinary catch-up push, never by moving or deleting a published tag.

**Historical anomaly:** `v0.4.3` points at `8d2551d` ("docs update /
cleanup"), whose `package.json` is `0.4.2`; `v0.4.4` is the commit that fixes
the release metadata. The tag is immutable and already published. The
pre-push hook skips it explicitly so a catch-up can validate every other tag;
`bin/check-version v0.4.3` still fails it by design.

## CI

Codeberg hosted Forgejo Actions runs
[`.forgejo/workflows/check.yml`](../.forgejo/workflows/check.yml) only on
`workflow_dispatch`, on `codeberg-small`:

- checkout with tags (`fetch-depth: 0`), pnpm 11.21.0, Node 24;
- `CI=1 ci/run portable` — the repository-owned contract performs the
  root-only frozen install, build-freshness check, portable gate, and static
  Cloudflare artifact check. Workerd and vitest stay off the light runner.

The workflow is manual only. Codeberg is a release mirror, and a mirror push
schedules no run: the git path and the shared runner pool stay independent.
An administrator dispatches the witness from the Codeberg Actions UI or with
`fj actions dispatch -r rickhull/org-hats check.yml main -H codeberg.org`.

The first run was green: 96 portable tests in about 1m25s, well inside the
5-minute cap. Workerd is not on this runner; it stays in the local and
release rings.

GitHub Actions remains the **release-mirror backstop**: it runs only when
a release updates GitHub. Its portable and workerd jobs call
`CI=1 ci/run portable` and `CI=1 ci/run cloudflare`; the latter performs the
full workspace install, rebuild, typecheck, and workerd suites. A tag push
also runs the tag-specific artifact audit. Its runner is pinned
(`ubuntu-24.04`) rather than `ubuntu-latest`, because a workflow that runs
only at release time must not meet a new runner image under a release.

Its distinct contribution is the workerd suites on a clean machine: `pnpm
verify` already runs every gate locally, but only through the nix-ld loader,
so CI is the one execution of the deployable artifact outside it.

The Codeberg manual job runs the portable gate only. The workerd suites run in
ring 2 locally and at release on GitHub. Both hosted results are evidence, not
prerequisites for the already-published NAS release.

A `cloudflare-v*` tag job restores the tag ref before the artifact gate reads
it. The checkout action force-writes the peeled commit into `refs/tags/<tag>`,
so the annotated object the gate requires is absent until it is re-fetched;
`bin/check-artifact` never touches the network, so the workflow repairs the
ref and the gate stays offline.

The live gate for a working checkout is the local pre-push hook and `pnpm
verify`; public-host CI is asynchronous mirror evidence.

`ci/run` is the backend-independent CI contract. In `CI=1` mode it requires
a clean, full checkout before installing anything; a local dirty run is
allowed but says plainly that it is not CI evidence. It removes inherited
Cloudflare credentials and never deploys. Forgejo and GitHub workflow files
provide checkout and tool versions, then delegate the gates to this script.

### Codeberg CI setup

Actions must be enabled in the repository (Settings → Units → Overview →
Enable Actions). The CLI path is:

```sh
# once per clone; use an application token, not the OAuth browser flow
fj auth add-token -H codeberg.org   # token from codeberg.org/user/settings/applications
fj auth list
fj repo units rickhull/org-hats actions --enable true -H codeberg.org
fj repo units rickhull/org-hats actions --enable false -H codeberg.org
```

Pass `-H codeberg.org` for Codeberg operations in a maintainer clone whose
`origin` is the NAS: without it, `fj` derives the host from the current remote
and sends the request to the NAS API.

The workflow is `workflow_dispatch` only, so enabling the unit does not schedule
a run on a mirror push. Dispatch it from the Actions UI or with the
`fj actions dispatch` command below. The trigger is read from the pushed ref:
tags cut before this change still carry their original push trigger, so do not
re-push a historical tag while the Actions unit is enabled.

The actions unit is the emergency kill switch: disabling it is a repository
setting, not an in-repo flag, and it is reversible the same way. The normal
posture is manual-only in the workflow itself (`workflow_dispatch`); changing
that trigger is a CI policy change and needs a push, while a job-level
condition would still enqueue a run.

Grant the token `repository` read/write (and `user` read if you want
`fj whoami`). `fj auth login` waits for an OAuth callback on
`127.0.0.1:26218`; it hangs in a headless or remote session. The token and
host are stored durably in `~/.local/share/forgejo-cli/keys.json` (mode 600),
so `-H` is only needed to override the repository's host.

The run history is at <https://codeberg.org/rickhull/org-hats/actions> and
through `GET /api/v1/repos/rickhull/org-hats/actions/runs`.
`fj actions tasks -r rickhull/org-hats -H codeberg.org` shows the task list and
status — the first run was `success` in 1m25s. A manual dispatch is
`fj actions dispatch -r rickhull/org-hats check.yml main -H codeberg.org`.

## The release

Releases are cut with `bin/release` (bump → verify → build → commit → tag; the tag comes from the manifest). It publishes to NAS, then catches up both public mirrors by default; `--no-push` keeps a release local. `v0.4.4` is the last v0.4 release; `v1.0.0` is historical; the current line is v3.x, with v2.x the previous line. The Cloudflare reference runtime is released from the same script with `--package cloudflare`.

A consumer pins one of:

| Host | Dependency spec |
| --- | --- |
| Codeberg (public mirror) | `git+https://codeberg.org/rickhull/org-hats.git#vX.Y.Z` |
| GitHub (public mirror) | `github:rickhull/org-hats#vX.Y.Z` |

Replace `vX.Y.Z` with the release tag. `v0.4.4` remains the last frozen v0.4 pin; the latest tag is the pin target — no plan tracks it. The Cloudflare package releases on its own cadence as `cloudflare-vX.Y.Z`; the same guard validates it against `packages/cloudflare/package.json`. Either public mirror may temporarily lag the NAS authority. A consumer that needs the newest release verifies the requested tag exists before updating its pin; the `github:` shorthand resolves only GitHub.

Pick the bump from the surface: `minor` for an additive public export or model
fact, `patch` for a fix within the released surface, and `major` when the
authority interface breaks. The Cloudflare package follows its own 0.x
cadence and ships its fixes as patches; a root release does not move a
Cloudflare tag.  A docs-only change, or a `dist/` rebuild whose only change
is comments, does not warrant a tag; the functional release remains the last
source change.

## Deployment is the host's act

Cutting and publishing an immutable `cloudflare-v*` tag is the upstream
release act; deploying it is the consuming host's act. Publication is to
subscribers ([lexicon.md](lexicon.md) § Delivery): org-hats publishes to
the canonical forge and public mirrors, whose audience happens to be the public. The
host verifies the tag and the production configuration at that commit,
snapshots state, uploads a Worker Version, activates it, and verifies it.
The shape is in
[cloudflare.md](cloudflare.md#the-hosts-deployment-contract).

Upstream provides no deploy porcelain: the Cloudflare account, Worker,
secrets, traffic, and service binding belong to the deploying host. The
live deployment facts live only in
[binding-conformance.md](binding-conformance.md); the host's ops
porcelain owns `publish` / `promote` / `configure` / `smoke`, with its
one-step form as the host's *deploy*; in the shared lexicon
([lexicon.md](lexicon.md) § Delivery) that verb is not this repository's.
The registry projection is the porcelain's
follow-on. State restore and the routing-facts
backfill are acceptance acts, not deploy steps.

## Release ritual

From a clean `main`:

1. Cut and push it:
   ```sh
   bin/release patch                         # root: vX.Y.Z
   bin/release --package cloudflare minor
   ```
   That bumps the selected manifest, runs `bin/check-dist` and `bin/check`
   (plus the Cloudflare suites for a root release), rebuilds `dist/`, commits
   the manifest and generated output, and tags the commit. It re-checks the
   new tag with `bin/check-version` before anything is pushed — the tag and
   manifest cannot disagree. It then atomically publishes the branch and tag
   to `origin`. Only after that succeeds does it catch up configured `codeberg`
   and `github` mirrors. A NAS failure is fatal and preserves the local
   release; a mirror failure warns and is repaired by a later release.
   `--no-push` stops before publication. `--dry-run`
   previews; `--no-cloudflare` skips the workspace suites on a root release.
   **Tag only through `bin/release`** — it keeps the tag and the manifest
   equal by construction; a hand-made tag (the agent exception in
   `AGENTS.md`) must still pass `bin/check-version <tag>` before it is
   pushed.  A Cloudflare release also runs
   `bin/check-artifact` before the commit and tag; the host-neutral sequence is
   in [`deploy_runbook.md`](deploy_runbook.md).

   Docs that name the artifacts move with the window: the README version table
   and the additive note in `migration-v2.md` move before the root tag; the
   live-deployment references in `cloudflare.md`, `binding-conformance.md`,
   the deployment paragraph in this file, `positioning.md`,
   `personas/practitioner.md`, and `migration-v2.md` move after the host
   deploy, because they describe what is running.
2. If the release was cut with `--no-push`, publish it in authority order. If
   NAS failed, retry its command before either mirror; a failed mirror may be
   retried now or left for the next release:
   ```sh
   git push --atomic origin HEAD <tag>
   git push codeberg HEAD --follow-tags
   git push github HEAD --follow-tags
   ```
3. Verify NAS shows the release. Check mirrors separately; lag is a warning,
   not a reason to rewrite or recut the tag:
   ```sh
   git ls-remote --heads origin main
   git ls-remote --heads codeberg main
   git ls-remote --heads github main
   ```
   Public-host CI runs when each mirror receives the release; it is
   release-time evidence, not the publication authority.

## Discipline

- **Tags are immutable.** Never move or delete `v0.1.0`; release by *adding* `v0.1.1`, never by rewriting a tagged commit. Force-pushing over a tag a consumer pinned is the one failure that breaks them silently.
- **A release tag must match its manifest.** `bin/check-version` validates both families: `vX.Y.Z` against `package.json`, `cloudflare-vX.Y.Z` against `packages/cloudflare/package.json` (it also audits any tag: `bin/check-version v0.4.3`, `bin/check-version cloudflare-v0.2.0`). `bin/check` runs it, so CI enforces it on every mirror push; `bin/release` keeps the two equal by construction and re-checks the tag it just made. The committed `.githooks/pre-push` runs the root gate before a push leaves the machine — install it once with `git config core.hooksPath .githooks`. CI remains the backstop.
- **`dist/` must be fresh.** `bin/check` runs the fence but does not emit; `pnpm build` does. `bin/check-dist` builds and fails if `git status --porcelain -- dist` is non-empty; the pre-push hook and **CI** both run it, so the local gate and the remote gate answer the same question in the same order.
- **A gated commit is recorded locally.** A passing pre-push gate writes a marker under `.git/org-hats-gates/` keyed by the commit and a fingerprint of the runtime, compiler, and installed tree. Later pushes of the same clean commit to NAS and the mirrors reuse it; a dirty tree, a new commit, or a changed toolchain does not. The marker is local and never a release authority — `bin/release` and CI run their own gates.
- **The local gate protects the canonical push.** Codeberg Actions are admin-triggered; GitHub Actions runs when its release mirror catches up. Workerd stays in the local and release rings.
- **Know which host the consumer pins.** Both public mirrors may lag NAS. Verify the tag before changing a consumer pin.

## Metadata

`package.json` carries `license: MIT`, `author: Rick <rick@thinkpad>`, and the three Codeberg URLs; those name the public mirror deliberately, because the private NAS authority is not a public URL. `files: ["dist", "SECURITY.md"]` means the installable tarball is `dist/` plus the README, LICENSE, SECURITY.md, and `package.json`. Zero runtime dependencies.

## Open

- **Public mirror cosmetics.** Give each mirror the same description — *"Public mirror of the private NAS release authority — a portable organizational authority subsystem"*. On GitHub, disable **Issues**, **Wiki**, and **Discussions** (PRs can't be disabled) and add topics — `authorization`, `access-control`, `rbac`, `permissions`, `typescript`, `cloudflare-workers`, `ed25519`.
