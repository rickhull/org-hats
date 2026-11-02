# NAS release authority — migration in progress

`docs/publishing.md` § Canonical forge and public mirrors is the durable
design: the bare repository on the NAS is the release authority (remote
`origin`); Codeberg and GitHub are best-effort public mirrors. The NAS
repository is seeded and current. The remaining work is the Codeberg catch-up
and retiring this plan.

## Current state

The NAS owner created the repository with `rake forge:repo[org-hats]` and set
`HEAD` to `refs/heads/main`. It is owned by `forge` at
`/home/forge/repos/org-hats.git`. The task sets `core.logAllRefUpdates true`;
it does not set `receive.denyDeletes` or `receive.denyNonFastForwards`.

The NAS is seeded: `origin/main` is the local `main` commit and the authority
carries all 41 tags, including `cloudflare-v0.5.0`. The maintainer clone has
`origin` at the NAS, `codeberg` at Codeberg, and `github` at GitHub; `main`
tracks `origin/main`.

GitHub has every tag and `main` at `f94fb47` (the two migration commits are
not there). Codeberg is at `a9ab3f2`, missing the two release commits, the
migration commits, and the `cloudflare-v0.12.1` tag.

## Owner action

The remaining owner decision is whether to add `receive.denyDeletes` and
`receive.denyNonFastForwards`. The forge task intentionally relies on reflogs
instead; tag immutability is a release-process rule unless those are set. The
owner pushes no content.

## Maintainer action

1. Catch Codeberg up. This sends `main` through the migration commits and the
   `cloudflare-v0.12.1` tag:

   ```sh
   git push codeberg HEAD --follow-tags
   ```

   Keep the Actions unit disabled for this push: the tag still carries the old
   push-triggered workflow. Re-enable Actions afterward and dispatch the
   manual-only workflow from `main`.

2. Optionally catch GitHub up with `git push github HEAD`; its tags are
   already current, and the next release would do this anyway.
3. Tell Quartermaster when Codeberg is current, then remove this plan.

## Done when

- `git ls-remote --heads codeberg main` reports the local `main` commit, and
  `git ls-remote --tags codeberg cloudflare-v0.12.1` reports the tag.
- `git status -sb` reports `## main...origin/main`.
- `git ls-remote origin` matches local `refs/heads/*` and `refs/tags/*` (one
  branch, 41 tags), including `cloudflare-v0.5.0`.
- `pnpm check` passes on the committed change.
