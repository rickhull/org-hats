# Repository instructions

## Git policy

Rick makes every commit and every push.  `git commit`, `push`, `reset`,
`checkout`, `switch`, `merge`, `rebase`, `stash`, `tag`, `cherry-pick`,
`revert`, and `clean` are off limits; a denial is an answer, not an obstacle
to route around.

`git add`, `git rm`, `git mv`, and `git restore` change the index or the
working tree, so they proceed only with Rick's approval — ask for specific
paths and say what each file is.  Never `git add -A` or `git add .`.

Codeberg is canonical (remote `origin`); GitHub is a release mirror, updated
by `bin/release --push`, never a second place to work.  The authority redesign
is `main`'s line; the v0.4 surface stays frozen at its tags.

## The Quartermaster relay

Cross-repository work with Quartermaster uses exactly two ignored note files:
write only `~/git/quartermaster/notes/from-org-hats.md`; read only
`notes/from-quartermaster.md`.  Do not edit anything else in that repository
— not source, tests, docs, or its dependency pin.  A change obviously right
from this side is still a change made without its owner's review; ask in the
note and let Quartermaster make it.

Check the tail of `notes/from-quartermaster.md` twice every turn: at the
start, before planning work, and again before handing off — a reply can
land mid-turn.  A new section is incorporated or answered, never left
unread in a handoff; if the work it needs does not fit this turn, say so
in the handoff.

Append dated sections, newest last, or clear a finished thread.  Read before
appending: a wiped note is a different conversation.  Nothing binding lives
only in a note; contracts move into `docs/` or `plans/` here, and into
Quartermaster's `docs/`, `specs/`, or `plans/` there.  Assume both notes are
publishable: `notes/` is gitignored, but a gitignore is one `git add -f` from
not applying.  No customer names, roster material, secrets, or key material.

## Tooling

- Node + pnpm come from nixpkgs (thinkpad flake, `nixos/devbox.nix`).
  Never install pnpm through corepack or npm.
- Use `rg`, not `grep`.
- No project flake: a routine tool belongs in the thinkpad devbox; an
  occasional one comes from `nix shell nixpkgs#<pkg>`.  When the Cloudflare
  package arrives (M6), its pnpm-installed foreign binaries (workerd,
  esbuild) run through the system nix-ld loader — extend
  `programs.nix-ld.libraries` in the thinkpad flake if one fails to exec;
  do not add a per-project FHS wrapper.

## Checks before handing work back

- When a change affects executable code, configuration, or tests, run
  `pnpm check` and `pnpm typecheck`; report what both said.  `pnpm check`
  runs the compiler fence, the cloudflare-import guard, and the `node --test`
  suites; a single suite is `node --test tests/<file>.test.ts`.  The full
  local gate is `pnpm verify` — `bin/check-dist` (build and dist freshness),
  `pnpm check`, and `pnpm check:cloudflare`.
- When every changed path is documentation (`*.md`), do not run application
  typechecks or tests; inspect the changed text and report that no automated
  check applies.
- After changing anything under `src/`, run `pnpm build` so the tracked
  `dist/` matches, and hand both back — `dist/` is part of the change, not
  a local artifact.
- The portable packages' suites must run without workerd or a Cloudflare
  account; runtime-specific tests belong to the future Cloudflare package.
- When a handoff carries a commit-sized chunk of work, propose a one-line
  commit message for it.

## Conventions

- The portable fence is law: everything under `src/` compiles with
  `types: []` and imports nothing Cloudflare.  `bin/check` enforces it; when
  code and the fence disagree, fix the code.
- The v1 line is a clean break with v0.4: the old model, port, spine,
  adapter, examples, and docs live at their tags, and content returns only
  by being re-specified against `docs/authority_redesign.md` — never copied
  from the old tree.
- This is a public repository.  No customer or real-person names, no real
  rosters or manifests, anywhere — design tests are the synthetic twins
  (Professional Operation, Festival, and the public-history Berlin Airlift
  twin), and real fixtures live in the consumer's private repository.
- `docs/authority_redesign.md` is the normative architecture; read the
  relevant section before changing the seam, the authority engine, or the
  access module.  The v0.4 public
  surface is frozen at its tags; post-alpha interface changes are
  additive-only or re-reviewed with the consumer.
- Distribution stays on git tags; no registry publication.
- Commentary states the invariant that must hold, present tense; history
  stays in commit messages.

## Where agent configuration lives

`AGENTS.md` is the instructions every agent reads — pi and Codex directly,
Claude Code through `CLAUDE.md`, which is one line, `@AGENTS.md`.  Content
placed in `CLAUDE.md` is content no other agent sees; add nothing there.

Repository knowledge does not belong in this file: the model and its
documentation live in `docs/`, named invariants in `specs/`, and
forward-looking plans in `plans/`.
`AGENTS.md` carries directives only.

Each agent enforces the Git policy with its own guard, because no shared
mechanism exists: `.claude/settings.json` (deny + ask), `.codex/config.toml`
with `.codex/git-guard.sh`, and `.pi/extensions/git-guard.ts`.  Their lists
mirror this file's "Git policy" and must stay in lockstep with it.
