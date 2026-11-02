# Plans — what's next

A plan names forward work or a decision, its done-when, and the evidence that
closes it.  A plan is retired by implementing it and is removed when it lands;
durable facts live in `docs/` or `specs/`, not here.  When you do not know
what to do next, take a plan with a clear next action; if none has one, the
answer is a decision for Rick, not a new plan.  Do not park deferred items in
a miscellaneous file, or keep a plan alive to justify work.

## The plans

The authority, Cloudflare runtime, release path, and compromise procedures
need one bounded adversarial campaign.  Its local-only rules of engagement,
phases, evidence, stop conditions, and done-when are in
[`red-team.md`](red-team.md).

The operation snapshot cache is deferred until a consumer approaches the
scaled bench's state; the measured verdict, the consumer-agreed design
(model-scoped epoch, trigger-backed), and the done-when are in
[`snapshot_cache.md`](snapshot_cache.md).

The NAS release-authority migration is in
[`nas-migration.md`](nas-migration.md): the NAS repository is seeded and
`main` tracks it; the remaining work is the Codeberg catch-up and retiring
the plan.

The specs-driven witness suite landed; its durable convention lives in
`tests/README.md` and `specs/README.md`.

The activation, roster, and team slices landed on 2026-10-28 and 2026-10-29;
their durable facts are in `docs/activation.md`, `docs/roster.md`,
`docs/teams.md`, and `specs/`.

Durable decisions live in `docs/` and `specs/`; the lexicon register is
[`docs/lexicon_use_concerns.md`](../docs/lexicon_use_concerns.md).

Retired plans are removed; their results live in `docs/` and the commit
history. Completed work is not kept here.
