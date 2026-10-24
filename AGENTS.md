# Repository instructions

## Git policy

Rick makes every commit and every push.  `git commit`, `push`, `reset`,
`checkout`, `switch`, `merge`, `rebase`, `stash`, `tag`, `cherry-pick`,
`revert`, and `clean` are off limits; a denial is an answer, not an obstacle
to route around.

`git add`, `git rm`, `git mv`, and `git restore` change the index or the
working tree, so they proceed only with Rick's approval — ask for specific
paths and say what each file is.  Never `git add -A` or `git add .`.

Codeberg is canonical (remote `origin`); GitHub is a push mirror.  The v0.4
line is `main` (frozen at its tags); the authority redesign work happens on
`v1`.

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
  runs the compiler fences, the cloudflare-import guard, the examples, and
  the `node --test` suites; a single suite is
  `node --test tests/<file>.test.ts`.
- When every changed path is documentation (`*.md`), do not run application
  typechecks or tests; inspect the changed text and report that no automated
  check applies.
- After changing anything under `src/`, run `pnpm build` so the tracked
  `dist/` matches, and hand both back — `dist/` is part of the change, not
  a local artifact.
- The portable packages' suites must run without workerd or a Cloudflare
  account; runtime-specific tests belong to the future Cloudflare package.

## Conventions

- The portable fence is law: `src/core.ts` and everything under
  `src/authority/` and `src/access/` compile with `types: []` and import
  nothing Cloudflare.  `bin/check` enforces it; when code and the fence
  disagree, fix the code.
- This is a public repository.  No customer or real-person names, no real
  rosters or manifests, anywhere — design tests are the synthetic twins
  (Professional Operation, Festival), and real fixtures live in the
  consumer's private repository.
- `docs/authority_redesign.md` is the normative architecture and
  `plans/v1.md` the development plan; read the relevant section before
  changing the seam, the authority engine, or the access module.  The v0.4
  public surface is frozen at its tags; post-M1 interface changes are
  additive-only or re-reviewed with the consumer.
- Distribution stays on git tags; no registry publication.
- Commentary states the invariant that must hold, present tense; history
  stays in commit messages.

## Where agent configuration lives

`AGENTS.md` is the instructions every agent reads — pi and Codex directly,
Claude Code through `CLAUDE.md`, which is one line, `@AGENTS.md`.  Content
placed in `CLAUDE.md` is content no other agent sees; add nothing there.

Repository knowledge does not belong in this file: the model and its
documentation live in `docs/`, forward-looking plans in `plans/`.
`AGENTS.md` carries directives only.

Each agent enforces the Git policy with its own guard, because no shared
mechanism exists: `.claude/settings.json` (deny + ask), `.codex/config.toml`
with `.codex/git-guard.sh`, and `.pi/extensions/git-guard.ts`.  Their lists
mirror this file's "Git policy" and must stay in lockstep with it.
