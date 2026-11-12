# Plans — what's next

A plan names forward work or a decision, its done-when, and the evidence that
closes it.  A plan is retired by implementing it and is removed when it lands;
durable facts live in `docs/` or `specs/`, not here.  When you do not know
what to do next, take a plan with a clear next action; if none has one, the
answer is a decision for Rick, not a new plan.  Do not park deferred items in
a miscellaneous file, or keep a plan alive to justify work.

## The plans

The type-safety plan is retired: all four slices landed with red-first
regressions (claims shape gate, world/snapshot ownership, outbox union,
route flag parsing); the durable findings live in
[`docs/type_safety.md`](../docs/type_safety.md).

The operation snapshot cache is deferred until a consumer approaches the
scaled bench's state; the measured verdict, the consumer-agreed design
(model-scoped epoch, trigger-backed), and the done-when are in
[`snapshot_cache.md`](snapshot_cache.md).

Durable decisions and completed work live in [`docs/`](../docs/README.md),
[`specs/`](../specs/README.md), and commit history. Retired plans are removed;
the index contains current forward work only.
