# Forgejo Actions — the third-party build witness

Codeberg's hosted Forgejo Actions run the portable gate on every push. The
run is assurance that a third party can build and test the repository from a
clean checkout — not a gate of record. The local rings in
[`tests/README.md`](../tests/README.md) are the authority; remote red without
local red means the *environment* broke, and that reading has held exactly
once (see the incident below).

Woodpecker CI — Codeberg's primary hosted CI — is deliberately not used: it
is application-gated and a second system to operate, and this repository
already carries extensive local gating. Forgejo Actions is the smaller
moving part, and its limitations are acceptable for one modest job.

## The environment

The hosted offer is **open alpha**; Codeberg's own docs say to prefer
Woodpecker when Codeberg must host CI. We accept the tradeoff knowingly:
one job, one workflow, no secrets, nothing release-critical.

- Runners: `codeberg-tiny` (1 CPU / 2 GB / 2 min), `codeberg-small`
  (2 CPU / 4 GB / 5 min — what we use), `codeberg-medium` (4 CPU / 8 GB /
  10 min). A `-lazy` suffix defers scheduling; useless for push assurance.
- The RAM quota **counts filesystem writes**; the full images below are
  impossible under it.
- The default job image is `ghcr.io/catthehacker/ubuntu:act-latest`, chosen
  by Codeberg for GitHub-Actions familiarity. It is a moving tag (it has
  been `act-24.04`; the family now builds `act-26.04`), so only the
  documented base contents may be relied on.
- Base contents (verified from the image history): Ubuntu 24.04 userland
  with `grep`, `git`, `curl`/`wget`, a full C toolchain, and a node
  toolcache. **Not included: `rg`, `jq`, `python3`.** The GitHub mirror's
  `ubuntu-24.04` runners do not ship `rg` either (`jq` is in the installed-
  software list, ripgrep is not), so both workflows install it.
- Forgejo Actions strives for *familiarity, not compatibility*: some
  `github` context keys are missing, and `permissions` /
  `continue-on-error` are ignored.
- Codeberg's rules for the hosted offer: public, copyleft-licensed repos
  (this one is MIT); don't jam the queue; use the minimum resources; no
  pipelines that assist LLM-driven workflows.

## The tool contract

`ci/run` fences exactly the tools its modes invoke — `node`, `pnpm`,
`git`, `rg` — and the workflows install the one the base images lack (the
  pinned `rg` step below). Everything else is the workflow's job: runner
  setup belongs in the workflow files, next to the `pnpm` and `node` setup
  actions, not in the repository scripts. A fence that names a tool no step
  installs is a CI outage waiting for the next push.

### The incident that fixed this

Commit `e325237` ("harden repo gates; centralize CI") switched
`bin/check`'s fences from `grep` to `rg` and fenced
`node pnpm git rg jq python3` — none of the latter three installed by the
workflow. Every Codeberg run from `#92` (2026-10-28) through `#133` failed
in ~40 s at `ci: rg is required`, before any gate executed; `jq` and
`python3` were fenced but used by nothing. Local gates stayed green
throughout — the remote was reporting its own missing tool, not a defect.
The repair restored `grep` (present in every base image) and trimmed the
fence to what is invoked; `rg` then returned deliberately, in the same
cycle, with totality flags and the pinned install below — the lesson
applied, not the tool banished.

## Provisioning a tool beyond the base image

In order of preference:

1. **Use what the base image ships** — when the image actually ships it.
   The incident above is what assuming this looks like. (`jq` is present
   on GitHub's runners and absent on Codeberg's act image; `rg` is absent
   on both.)
2. **Setup actions**, mirrored at `code.forgejo.org/actions/*` — already
   used for `pnpm` (11.21.0) and `node` (24). Prefer these when an official
   action exists; pin the version.
3. **A pinned static binary**, fetched and checksum-verified in a step —
   the adopted path for `rg`, live in both workflows. The fleet is amd64;
   the musl build is static; ~2.3 MB; `github.com` release downloads are
   proven reachable (`setup-node` itself fetches from there). Codeberg's
   jobs run as root; the mirror's runners need `sudo` for `/usr/local/bin`,
   so the step probes writability:

   ```yaml
   - name: Install ripgrep (pinned)
     run: |
       curl -fsSL -o /tmp/rg.tar.gz \
         https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz
       echo "33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c  /tmp/rg.tar.gz" | sha256sum -c -
       tar xzf /tmp/rg.tar.gz -C /tmp
       SUDO=""
       [ -w /usr/local/bin ] || SUDO="sudo"
       $SUDO install -m 0755 /tmp/ripgrep-15.2.0-x86_64-unknown-linux-musl/rg /usr/local/bin/rg
   ```

   Upstream publishes the `.sha256` alongside the tarball; the digest above
   matches it. Re-pin deliberately.
4. **`apt-get` in a step** (jobs run as root): `ripgrep` on the 24.04 base
   is 14.1.0-1. Simpler than a fetch, but unpinned and pays an
   `apt-get update` (~10–20 s) on every run.
5. **A different `container:` image — rejected.** The `catthehacker`
   `full-*` images are copies of GitHub's real runner images at
   ~60 GB extracted: impossible under a 4 GB quota that counts disk. An
   Alpine-style image breaks the glibc binaries that `setup-*` actions
   download.

## rg in the fences

`rg` is the repository's search tool for people and agents, and the fences
use it too — with one carve-out spelled out in flags: a fail-closed fence
reads **every** file, while rg's interactive defaults skip gitignored,
hidden, and binary content. Verified divergence on a probe file containing
`cloudflare:`:

| file                | `grep -R` | `rg` defaults | `rg --no-ignore --hidden --text` |
| ------------------- | --------- | ------------- | -------------------------------- |
| gitignored          | fires     | silently passes | fires                          |
| hidden              | fires     | silently passes | fires                          |

So the fences in `bin/check` carry `--no-ignore --hidden --text`, which was
verified byte-identical to the prior `grep -R` fences on the real `src/`
and `dist/` trees. The cost of uniformity is one pinned 2.3 MB fetch per
run — the same dependency class as `setup-node`'s own Node download — and
`tests/tooling-policy.test.ts` lints the new invocations against the
short `-r` pitfall (see `AGENTS.md`) the moment they exist.

## Workflow guidelines

- Keep the job whole and short: one `CI=1 ci/run portable` invocation,
  ~90 s, well inside the `codeberg-small` five-minute cap.
- Pin what the workflow installs: action versions, `pnpm` 11.21.0,
  `node` 24, and any fetched binary's version **and** digest.
- `fetch-depth: 0` is required: the release-metadata and tag gates read
  history and tag objects, and CI mode refuses a shallow or dirty checkout.
- `cloudflare-v*` tag pushes carry the annotated-tag repair step (the
  checkout action replaces the annotated object with a lightweight ref) and
  the artifact gate; see [`publishing.md`](publishing.md) for the release
  side.
- Watch runs with `fj actions tasks`. Logs are not exposed by `fj` 0.7;
  the Codeberg API serves them read-only:
  `/api/v1/repos/<owner>/<repo>/actions/runs` (list; note the `id`) →
  `/actions/runs/<id>/jobs` (job id) → `/actions/jobs/<job id>/logs`,
  authenticated with the `fj` token.
- After changing either workflow, validate the mirror with a one-shot
  `gh workflow run check --ref main` on `rickhull/org-hats`: a release push
  is the only other thing that triggers it, and the wrong time to learn a
  step is broken.
- A red remote with a green local ring means the environment changed:
  suspect the moving `act-latest` tag first, then a missing tool, then the
  runner fleet's status page referenced from
  [Codeberg's actions meta](https://codeberg.org/actions/meta).
