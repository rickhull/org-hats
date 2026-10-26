# Specs — what must hold

A spec here is a **named invariant of the working system**: a statement we
expect to remain true, what holds it (a fence, a closed surface, a test),
and what follows if it stops holding. Specs are written *after* the fact,
distilled from the system and its docs — not before it. They are not
design-stage contracts: a contract that is not yet ours to make belongs in
`plans/` or in the consumer relay until it is settled, and then lands in
`docs/` with the change that implements it.

The split, one line each:

- `docs/` — what **is**: the architecture and format contracts as built.
- `specs/` — what must **hold**: the invariants, with their implications.
- `plans/` — what is **next**: forward work, removed when realized.

## The protocol

- Every entry carries a stable id (`A#` authority, `E#` envelope, `P#`
  portability), a present-tense statement, *Held by* — the enforcement a
  regression has to get past — and *If it breaks* — the consequence to
  predict before choosing to break it.
- A change that breaks an invariant names the id in its rationale and
  rewrites the entry in the same commit. Breaking one is allowed; breaking
  one silently is not.
- Adding an invariant requires only that it holds now and that its
  enforcement is named. An invariant nothing enforces is a hope; write it
  in `plans/` instead.

## The files

- [`authority.md`](authority.md) — the seam: authentication, ownership,
  reach, refresh, idempotency, administration.
- [`envelope.md`](envelope.md) — the projection: canonical bytes, one
  algorithm, additive growth, closed verification, key rotation.
- [`portability.md`](portability.md) — the fence, the one reference
  runtime, the world-fixture boundary, and the public-repository and
  release posture.

Quartermaster's `specs/` is a different genre — design-stage consumer
contracts for unbuilt product surface. Neither directory mirrors the other;
the seam contract itself lives here, in `docs/` and the shipped types.
