# Agent mesh protocol — adoption with Quartermaster

**Status (2026-10-25):** local convention written in
[`docs/agent_mesh.md`](../docs/agent_mesh.md) and [`AGENTS.md`](../AGENTS.md).
The proposal is in the relay outbox; QM has not answered it yet. Gate is the
default; coroutine is an explicit lease.

## Goal

Two agents can hand off blocking work without stealing Rick's turn: notes are
always the record, wakes are deliberate interrupts, and the conch makes the
initiative explicit whether or not there is a broker-level lock.

## Steps

- [x] Write the gate/coroutine protocol and the conch rules.
- [x] Add the directive to `AGENTS.md` and the descriptive protocol to
      `docs/agent_mesh.md`.
- [x] Propose the protocol in the relay note and wake QM once with a pointer.
      Delivered 2026-10-25; QM has not replied yet.
- [ ] QM agrees or amends the header and the gate default in the relay note.
- [ ] Apply it to the `cloudflare-v0.3.2` handoff: when the tag is live, leave
      the note, send one wake under a one-round lease, QM runs the fresh smoke
      and records acceptance, then the thread returns to gate.
- [ ] Record the agreed standing rules in the relay note and close this plan.

## Open questions

- Does QM want a standing lease for any workstream, or gate per message?
- Does QM accept the `Coordination:` header, or prefer a simpler note-plus-wake
  convention?
- What is QM's default when both agents are active? Our side defaults to gate
  unless a lease is open.

## Non-goals

No broker token or lock; the conch is a convention recorded in the notes, not
a mechanism. No broadcast across repositories. No secrets, customer data, or
roster material in a note or a wake. No change to the product surface.

No secrets or customer data in this plan.
