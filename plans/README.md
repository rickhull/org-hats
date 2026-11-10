# Plans — what's next

A plan names forward work or a decision, its done-when, and the evidence that
closes it.  A plan is retired by implementing it and is removed when it lands;
durable facts live in `docs/` or `specs/`, not here.  When you do not know
what to do next, take a plan with a clear next action; if none has one, the
answer is a decision for Rick, not a new plan.  Do not park deferred items in
a miscellaneous file, or keep a plan alive to justify work.

## The plans

The operation snapshot cache is deferred until a consumer approaches the
scaled bench's state; the measured verdict, the consumer-agreed design
(model-scoped epoch, trigger-backed), and the done-when are in
[`snapshot_cache.md`](snapshot_cache.md).

The assurance frictions are closed: all four decisions are recorded as
postures with their triggers and shelf conditions in
[`../docs/assurance.md`](../docs/assurance.md), which is the durable
statement and needs no plan beside it.

Durable decisions and completed work live in [`docs/`](../docs/README.md),
[`specs/`](../specs/README.md), and commit history. Retired plans are removed;
the index contains current forward work only.
