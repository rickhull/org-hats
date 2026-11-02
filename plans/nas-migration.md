# NAS release authority — migration in progress

`docs/publishing.md` § Canonical forge and public mirrors is the durable
design: the bare repository on the NAS is the release authority (remote
`origin`); Codeberg and GitHub are best-effort public mirrors. The release
tooling, tests, and docs are written. The NAS repository now exists; the
remaining work is its `main` HEAD, the seed, the clone remotes, and the
Codeberg catch-up.

## Current state

The NAS owner created the repository with `rake forge:repo[org-hats]`. It is
empty at `/home/forge/repos/org-hats.git` and owned by `forge`. The forge task
sets `core.logAllRefUpdates true` and leaves `HEAD` on an unborn `master`; the
owner has set `HEAD` to `refs/heads/main`. The task does not set
`receive.denyDeletes` or `receive.denyNonFastForwards`.

The maintainer clone now has `origin` at the NAS and `codeberg` at Codeberg.
`main` still tracks `codeberg/main` until the seed and fetch create
`origin/main`. Local `main` is two commits ahead of Codeberg at the release
point, plus the migration commits; GitHub has the release commit but not the
migration commits.

## Owner action

`HEAD` is set. The remaining owner decision is whether to add
`receive.denyDeletes` and `receive.denyNonFastForwards`. The forge task
intentionally relies on reflogs instead; tag immutability is a release-process
rule unless those are set. The owner pushes no content.

## Maintainer action

1. Rick commits the in-tree migration change (release tooling, tests, docs).
2. Seed every branch and tag, then set the upstream:

   ```sh
   git push --atomic origin --all --tags
   git fetch origin
   git branch --set-upstream-to=origin/main main
   ```

   `--tags` is required: `cloudflare-v0.5.0` is not reachable from `main`, so
   the ordinary release `--follow-tags` path would not carry it.

3. Catch Codeberg up with `git push codeberg HEAD --follow-tags`. It is two
   release commits and the `cloudflare-v0.12.1` tag behind, plus the
   migration commits.
4. Tell Quartermaster the public-mirror contract is unchanged and when the
   tag is available on Codeberg.

## Done when

- `git ls-remote --symref origin HEAD` reports `refs/heads/main`.
- `git ls-remote origin` matches local `refs/heads/*` and `refs/tags/*` (one
  branch, 41 tags), including `cloudflare-v0.5.0`.
- `git status -sb` reports `## main...origin/main`.
- `git ls-remote --heads codeberg main` reports `f94fb47` (or a later
  commit), and `git ls-remote --tags codeberg cloudflare-v0.12.1` reports
  the tag.
- `pnpm check` passes on the committed change.
