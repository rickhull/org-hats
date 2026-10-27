# Repository instructions

## Git policy

Rick makes every commit and every push.  `git commit`, `push`, `reset`,
`checkout`, `switch`, `merge`, `rebase`, `stash`, `cherry-pick`, `revert`,
and `clean` are off limits; a denial is an answer, not an obstacle to route
around.  Tags are the exception: agents may and should create them with
`git tag` — annotated, named by a release family (`vX.Y.Z` from
`package.json`, `cloudflare-vX.Y.Z` from `packages/cloudflare/package.json`),
then verified with `bin/check-version <tag>`.  Do not move, force, or delete
a tag; pushing a tag is a push, and stays Rick's.

`git add`, `git rm`, `git mv`, and `git restore` change the index or the
working tree, so they proceed only with Rick's approval — ask for specific
paths and say what each file is.  Never `git add -A` or `git add .`.

Codeberg is canonical (remote `origin`); GitHub is a release mirror, updated
by `bin/release --push`, never a second place to work.  The authority redesign
is `main`'s line; the v0.4 surface stays frozen at its tags.

## The Quartermaster relay

Cross-repository work with Quartermaster uses writer-owned outboxes.  We
write `notes/to-quartermaster.md` **in this repository**; Quartermaster
writes `notes/to-org-hats.md` **in its repository**.  Never write in the
other repository; the one mirrored cutover entry is the last write there, and
that clone is read-only after it.  Our inbox is
`~/git/quartermaster/notes/to-org-hats.md`.  `notes/to-org-hats.md` must not
exist in this repository, and `notes/to-quartermaster.md` must not exist in
Quartermaster's; either is the wrong relay.  This assumes both clones are on
one machine; a cross-PC relay needs the agent mesh or a shared path.  The old
`notes/from-quartermaster.md` here and `notes/from-org-hats.md` there are
read-only history after the cutover; do not read the stale
`notes/from-quartermaster.md` inside quartermaster.  Do not edit anything
else in that repository — not source, tests, docs, or its dependency pin.  A
change obviously right from this side is still a change made without its
owner's review; ask in the note and let Quartermaster make it.

Quartermaster's detailed protocol is `~/git/quartermaster/specs/notes_relay.md`;
this section is the directive.

Every entry is prepended, newest first, and begins with
`## <ISO-8601> — <subject>`, then the body; keep a `Coordination:` line when
coordination matters.  The first line of the file is always the newest
entry's timestamp and subject; no static title sits above it.  Entries are
separated by a blank line; the body ends at the next `## ` heading.  Read the
first entry in `~/git/quartermaster/notes/to-org-hats.md` at the start of
every turn and again before handing off — a reply can land mid-turn.  Read
newer entries from the top until the last timestamp already seen.  A new
entry is incorporated or answered, never left unread in a handoff; if the
work it needs does not fit this turn, say so in the handoff.

Read the inbox again before prepending, and read your own outbox's first line
first; do not write from a stale copy.  Prepend atomically (write a temp file,
then rename) so a reader never sees a half-written entry.  Keep the outbox at
or below 850 lines (roughly 40 KB); the line count is the rule and the byte
figure is an approximation.  When prepending would exceed the cap, discard
the oldest half by line count, to at most 425 lines, snapped to an entry
boundary so no entry is split; if the newest entry alone exceeds 425 lines,
keep it whole and let the cap yield to it.  The old `from-*` files keep
whatever size they reached; the cap applies to the `to-*` outboxes.
Quartermaster keeps its own outbox to the same cap.

Nothing binding lives only in a note; contracts move into `docs/` or `plans/`
here, and into Quartermaster's `docs/`, `specs/`, or `plans/` there.  Assume
both notes are publishable: `notes/` is gitignored, but a gitignore is one
`git add -f` from not applying.  No customer names, roster material, secrets,
or key material.

## The agent mesh

The local Pi mesh is an interrupt channel, not a second relay.  Follow
[`docs/agent_mesh.md`](docs/agent_mesh.md).

- Write the relay outbox entry first; a mesh send is only a wake that points
  at it.
- Default mode is gate: process a received message within bounds, report to
  Rick with a recommendation and the decision needed, then stop.  A gate turn
  may leave a note that restates recorded facts; it does not commit the
  project.  No wake in a gate turn.
- A leased coroutine (`mode=lease`) requires a named goal, a round budget
  (default 3), exit conditions, and both sides' agreement.  A lease unanswered
  by the next Rick turn lapses to gate.  The conch alternates; one outstanding
  wake per direction.
- A single bounded action is a gate wake, not a lease.
- Wakes are fire-once and self-contained: one send, one outstanding, a note
  path, a section, and the single action the peer owns.  A timeout is not
  retried; never wake for ACK/FYI, and never while Rick is driving.
- Rick holds the conch outside a lease and can revoke one at any time.
- Every new relay entry carries a timestamped heading and a `Coordination:`
  header.
- Echo mesh addresses verbatim; do not use the deprecated blocking
  `agent_request`.

## Delegation

Work that splits into three or more weakly-coupled areas, each needing real
judgment, runs through Quartermaster's `moshpit` skill: one orchestrator
liaises with Rick, plans, and outsources execution to the cheapest capable
subagents, retiring each before its context fills.  The layers are `me`,
`orchestrator`, `specialist`, `helper`.

The skill is `~/git/quartermaster/.agents/skills/moshpit/SKILL.md`; read it
there.  It is Quartermaster's file: do not edit it, and do not vendor a copy
here, because two copies of one pattern drift.  This assumes both clones are
on one machine, as the relay does.  Invoke it deliberately — below three
areas, or for a mechanical sweep, do the work inline.  It opens by mapping
this machine's models to the layers, asked once with a default per question,
and only after the entry test passes; a failing test means no questionnaire.

## Tooling

- The project flake (`flake.nix`) provides Node 24, pnpm 11, `git`, `rg`,
  `jq`, Python 3, and `fj` 0.7+; `.envrc` enters it with `use flake`.  Run
  `direnv allow` once per clone.  Never install pnpm through corepack or npm.
- `rg` searches recursively by default.  Never pass its short `-r` flag:
  it means output replacement, not recursion.  Spell a real replacement as
  `--replace`; ordinary recursive searches need no recursion flag.
- CI still uses the workflow's pinned pnpm and Node; the flake is the local
  development shell, not a second release path.  `flake.lock` is tracked and
  updated deliberately with the change that needs it.
- Use `rg`, not `grep`.
- Keep the flake minimal.  A routine tool belongs in the thinkpad devbox or
  the project flake when contributors need it; an occasional tool comes from
  `nix shell nixpkgs#<pkg>`.  The Cloudflare package's pnpm-installed foreign
  binaries (workerd, esbuild) run through the system nix-ld loader — extend
  `programs.nix-ld.libraries` in the thinkpad flake if one fails to exec; do
  not add a per-project FHS wrapper.

## Checks before handing work back

- When a change affects executable code, configuration, or tests, run
  `pnpm check` and report.  `pnpm check` runs the compiler fence, the
  cloudflare-import guard, the tests/examples typecheck, and the
  `node --test` suites; a single suite is `node --test tests/<file>.test.ts`.
  It fails closed when its required TypeScript tooling is absent; install
  dependencies before invoking it.
  `pnpm typecheck` is a fast standalone source check; `bin/check`'s
  `tsconfig.tests` pass and `bin/check-dist`'s build already cover it, so it
  is a convenience, not a separate gate.  The full local gate is
  `pnpm verify` (`bin/verify`: `bin/check-dist`, `pnpm check`, and
  `pnpm check:cloudflare`); a clean commit that passes records the local gate
  cache, so pre-push does not repeat the portable gate.  The rings are in
  `tests/README.md`.
- Do not run `pnpm check` concurrently with `bin/check-dist`, `bin/verify`,
  or `pnpm verify` in the same checkout: the build cleans `dist/`, and the
  consumer fence would read a missing tree.
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
- The redesign line is a clean break with v0.4: the old model, port, spine,
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
- `plans/` is forward work: each plan names the work or decision, its
  done-when, and the evidence that closes it.  Retire a plan by implementing
  it; remove it when it lands.  Durable facts belong in `docs/` or `specs/`,
  not in a plan.  When you do not know what to do next, read `plans/` and
  take a plan with a clear next action; if none has one, ask Rick for the
  decision.  Do not park deferred items in a miscellaneous file, and do not
  keep a plan alive to justify work.

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
