# Plans — what's next

A plan names forward work or a decision, its done-when, and the evidence that
closes it.  A plan is retired by implementing it and is removed when it lands;
durable facts live in `docs/` or `specs/`, not here.  When you do not know
what to do next, take a plan with a clear next action; if none has one, the
answer is a decision for Rick, not a new plan.  Do not park deferred items in
a miscellaneous file, or keep a plan alive to justify work.

## The plans

The access review's next work is isolated verified claims, Ed25519 signer
validation, expiry parsing, and an explicit E4 failure order. The ordered
slices, regression evidence, and lower-priority key-set compatibility witness
are in [`access_integrity.md`](access_integrity.md).

The operation snapshot cache is deferred until a consumer approaches the
scaled bench's state; the measured verdict, the consumer-agreed design
(model-scoped epoch, trigger-backed), and the done-when are in
[`snapshot_cache.md`](snapshot_cache.md).

Four decisions stand between this library and an operator's SOC 2 or TISAX
assessment going smoothly, and the first is upstream of the rest: whether an
operator action has an owner in the model at all, before retention, erasure,
and release signing.  The durable posture is
[`../docs/assurance.md`](../docs/assurance.md); the decisions and their
done-whens are in [`assurance.md`](assurance.md).

The specs-driven witness suite landed; its durable convention lives in
`tests/README.md` and `specs/README.md`.

The red-team campaign landed on 2026-11-02 and is retired.  Its conclusions
are where they belong rather than in a plan: the invariants it sharpened are
E2, E4, and E7 in [`../specs/envelope.md`](../specs/envelope.md); the
reachable-input list, the amplification review, the advisory triage, and the
severity bands are in [`../docs/threat_model.md`](../docs/threat_model.md),
[`../docs/performance.md`](../docs/performance.md),
[`../docs/assurance.md`](../docs/assurance.md), and
[`../SECURITY.md`](../SECURITY.md); the tabletop corrections are in
[`../docs/key_compromise.md`](../docs/key_compromise.md); the recurring
practices it produced are conventions in `AGENTS.md`; and the regression
evidence is in the suites.

The activation, roster, and team slices landed on 2026-10-28 and 2026-10-29;
their durable facts are in `docs/activation.md`, `docs/roster.md`,
`docs/teams.md`, and `specs/`.

Durable decisions live in `docs/` and `specs/`; the lexicon register is
[`docs/lexicon_use_concerns.md`](../docs/lexicon_use_concerns.md).

Retired plans are removed; their results live in `docs/` and the commit
history. Completed work is not kept here.
