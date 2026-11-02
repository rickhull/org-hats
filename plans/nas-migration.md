# NAS release authority — migration in progress

`docs/publishing.md` § Canonical forge and public mirrors is the durable
design: the bare repository on the NAS is the release authority; Codeberg and
GitHub are best-effort public mirrors. The release tooling, tests, and docs
are written. The remaining work is out-of-band.

## Blocking fact

As of 2026-11-02, `forge@nas-ts` (the same host as `forge@nas`, git 2.55.0)
answers as a `git-shell` account, but
`ssh://forge@nas-ts/home/forge/repos/org-hats.git` does not exist:
`git ls-remote` reports “does not appear to be a git repository”. The NAS
runs only Caddy, Samba, and SSH; there is no Forgejo or Gitea service, so
there is nothing to provision through a web UI. The `forge` home is
`0700 forge:forge`, and the maintainer SSH key is already authorized.

## Owner action

The NAS owner runs the one-time provisioning in `docs/publishing.md`
§ Provisioning the NAS authority. The maintainer does not run it, and the
owner pushes no content. The owner confirms when the bare repository exists
and is owned by `forge`.

## Maintainer action after confirmation

1. Rick commits the in-tree migration change (release tooling, tests, docs).
2. Rename `origin` to `codeberg`, add `nas`, seed every branch and tag,
   fetch, and set `main` to track `nas/main` (commands in
   `docs/publishing.md` § Configure a maintainer clone).
3. Catch Codeberg up with `git push codeberg HEAD --follow-tags`. It is two
   commits and the `cloudflare-v0.12.1` tag behind; GitHub is already
   current.
4. Tell Quartermaster the public-mirror contract is unchanged and when the
   tag is available on Codeberg.

## Done when

- `git ls-remote --symref nas HEAD` reports `refs/heads/main`.
- `git ls-remote nas` matches local `refs/heads/*` and `refs/tags/*` (one
  branch, 41 tags), including `cloudflare-v0.5.0`, which is not reachable
  from `main`.
- `git status -sb` reports `## main...nas/main`.
- `git ls-remote --heads codeberg main` reports `f94fb47` (or a later
  commit), and `git ls-remote --tags codeberg cloudflare-v0.12.1` reports
  the tag.
- `pnpm check` passes on the committed change.
