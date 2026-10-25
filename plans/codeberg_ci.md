# Codeberg CI — hosted Forgejo Actions on `codeberg-small`

**Status:** decided 2026-10-25. Use Codeberg's hosted Forgejo Actions for the
portable gate on `codeberg-small`; the workflow is in
`.forgejo/workflows/check.yml`. Enabling Actions and the first dispatch are
the remaining manual steps.

## Why this shape

- Codeberg can host Forgejo Actions directly; no self-hosted runner and no
  Woodpecker approval form. Actions are disabled on this repository today
  (`has_actions: false`; `/actions` is 404).
- `codeberg-small` is amd64, 2 CPU, 4 GB RAM, 5 min. A root-only run of the
  portable gate fits comfortably: with only the root package installed,
  `pnpm install --filter org-hats` took ~5s with a warm store, `bin/check-dist`
  ~4s, and `bin/check` ~5s in a throwaway clone. The first hosted run is the
  cold evidence.
- The root-only install is the important part: it installs TypeScript and
  `@types/node` only — `workerd`, `vitest`, and `wrangler` stay absent, so the
  Cloudflare workspace does not consume the light runner.
- Workerd remains on the local/release rings. If it ever needs hosting, use a
  separate tag/manual workflow on `codeberg-medium` (10 min), not this job.
- The GitHub Actions job remains the release-mirror backstop. Once this gate
  is green, Codeberg becomes the canonical per-push CI.

## The workflow

`.forgejo/workflows/check.yml`:

- triggers on every push (branches and tags) and on `workflow_dispatch`;
- `runs-on: codeberg-small`, `timeout-minutes: 5`;
- checks out with `fetch-depth: 0` so `bin/check-version` sees tags;
- installs pnpm 11.21.0 and Node 24 from the Forgejo action mirrors;
- runs `pnpm install --frozen-lockfile --filter org-hats`;
- runs `bin/check-dist` (build and dist freshness) and `bin/check`
  (fence, portable suites, pilot, tag audit).

`fj` uses Forgejo Actions, not Woodpecker. It is installed but has no login
here, so it can only report commands until the application token is added.

## Setup walkthrough

1. **Authenticate `fj` with an application token, not the OAuth browser
   flow.** `fj auth login` opens a browser and waits for a callback on
   `127.0.0.1:26218`; in a headless/SSH session, or when that port is not
   reachable from the browser, it hangs. Use the token flow instead:
   - Create a token at
     <https://codeberg.org/user/settings/applications>. Grant `repository`
     read/write (and `user` read if you want `fj whoami`).
   - From this repository, where the `origin` remote supplies the host:
     ```sh
     fj auth add-token
     ```
     Paste the token at the prompt. Do not pass it as an argument; that puts
     it in shell history. If there is no Forgejo remote in the current
     directory, use `fj -H codeberg.org auth add-token` instead.
   - The token and host are stored durably in
     `~/.local/share/forgejo-cli/keys.json` (mode 600), keyed by host. `-H` is
     only needed to override the repo's host or when there is no repo.
   - Verify:
     ```sh
     fj auth list
     fj whoami
     ```
2. **Enable Actions** (UI alternative: repository settings → Units →
   Overview → Enable Actions):
   ```sh
   fj repo units rickhull/org-hats actions --enable true
   ```
   If the host is not inferred, prefix it: `fj -H codeberg.org ...`.
3. **Commit and push the workflow** (Rick): a push to Codeberg triggers the
   workflow automatically because of `on: push`.
4. **Watch the first run**:
   ```sh
   fj actions tasks -r rickhull/org-hats
   ```
   The first run is also the action-resolution test: the workflow references
   `https://code.forgejo.org/actions/checkout@v4`,
   `https://code.forgejo.org/pnpm/action-setup@v4`, and
   `https://code.forgejo.org/actions/setup-node@v4`. If one does not resolve,
   adjust that reference rather than weakening the gate.
5. **Manual dispatch** (optional):
   ```sh
   fj actions dispatch -r rickhull/org-hats check.yml main
   ```
   Confirm whether `fj` wants the workflow file name or the `name:` field
   after the first run.
6. If the 5-minute cap is ever tight, change `runs-on` to `codeberg-medium`
   before changing what the job proves. Do not add workerd to this runner
   without measuring.

## Open questions

- Do the three Forgejo-mirrored actions resolve on Codeberg's runner as
  written? The first push answers it.
- Is `codeberg-small`'s 5-minute cap stable with a cold pnpm store and Node
  download? The local root-only run says yes; the first hosted run is the
  evidence.
- Does `fj actions dispatch` take `check.yml` or the workflow `name:`?
- Should the job run on all branches or only `main` and release tags? It runs
  on all refs for now; the repo is small and the job is light. Narrow it if
  the queue or fair-use guidance asks.
