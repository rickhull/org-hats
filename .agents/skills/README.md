# Skills

Every skill this repository offers comes from the **shared agent-skills
library** at `~/.agents/packs`.  Nothing here is vendored and nothing here is
tracked: this directory holds generated symlinks, one per skill, and this
README.  Readers ignore root `.md` files, so the README is not a skill.

```sh
bin/wire-skills        # generate the links; run by .envrc on shell entry
```

## The selection

`cloudflare` and `typescript`, per the shared library's repo-to-pack mapping —
12 and 5 skills, with no name collision between them or with the library's
core skills.  One skill is selected singly: `design/modern-web-guidance`, for
the browser playground, without taking the rest of the `design` pack.  Change
the selection in `bin/wire-skills` and `.pi/settings.json` together; they are
the two places this repository names what it wires.

## Why links, and why one per skill

A symlink cannot hold `~`, so a committed link would carry one machine's
absolute home path.  The links are therefore machine-local and gitignored, and
the **generator** is the tracked part.

The layout is one link per **skill**, never one per **pack**, because the three
harnesses discover differently:

| Harness | Discovery | What it needs |
| --- | --- | --- |
| Claude Code | does **not** recurse a linked pack directory | per-skill links; a `.agents/skills/cloudflare` pack link loads **zero** skills |
| Codex | recurses whatever is under `.agents/skills` | either, so per-skill is fine |
| pi | reads pack paths from config | `.pi/settings.json`, which holds `~` paths and is tracked |

Per-skill links are the one layout all three accept, reached through the
single tracked `.claude/skills -> ../.agents/skills` symlink.  Never create
real files under `.claude/skills/`: they would be invisible to the other
harnesses.

`bin/wire-skills` is idempotent, prunes links whose target is gone, refuses to
overwrite a real path, and **fails loudly when a pack is missing** rather than
leaving a clone silently offering no skills.

## House skills

None.  A skill this repository would own belongs in the shared library, where
every harness discovers it globally and every repository can use it.  A local
skill tree is a second copy with no drift check.

Modern Web Guidance is the one skill taken from outside the mapped packs.  It
is wired from `design/modern-web-guidance` alone, not the whole `design` pack,
because only that guidance applies here.  Its runtime is the project-local,
exact-pinned `modern-web-guidance` dev dependency; invoke it from the project
root as `env DISABLE_TELEMETRY=1 pnpm exec modern-web-guidance <command>`.
Never use `npx`, `pnpx`, `@latest`, or a global executable, and never point an
upstream installer at `~/.agents` or this link tree.
