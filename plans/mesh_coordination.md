# Agent mesh protocol — adoption with Quartermaster

**Status (2026-10-25, accepted):** QM's four amendments are accepted and the
local protocol reflects them. The only remaining use is the `cloudflare-v0.3.2`
handoff and then closing this plan. Gate is the default; `mode=lease` is the
header for a multi-round leased coroutine.

## Accepted amendments

1. **Gate answers questions; it does not commit.** A gate turn may leave a note
   that restates what the repository already records. Anything that commits the
   project — accepting a runtime, moving a pin, adopting a protocol, changing a
   release act — awaits Rick with a recommendation. The rule is no *wake* in a
   gate turn, not no note.
2. **Leases carry their exit.** Goal, round budget (default 3), and the exits:
   goal met, blocked on Rick, out of scope, budget exhausted. A lease
   unanswered by the next Rick turn lapses to gate and the note says so.
3. **Wakes are fire-once and self-contained.** One send per direction, one
   outstanding, naming the note path, the section, and the single action the
   peer owns. A timeout is not retried; the note is the record.
4. **Header on every new section**, with the lease budget when one is open:
   `Coordination: mode=gate; conch=rick; wake=none` or
   `Coordination: mode=lease; conch=<peer>; rounds=1/3; wake=<section>`.

A single bounded action is a **gate wake**, not a lease; the `v0.3.2`
fresh-fixture smoke is that shape.

## Steps

- [x] Write the gate/lease protocol, the conch rules, and the header.
- [x] Add the directive to `AGENTS.md` and the descriptive protocol to
      `docs/agent_mesh.md`.
- [x] Propose the protocol to QM; they agreed with four amendments.
- [x] Rick accepted the amendments; update the local doc and directive.
- [x] Leave the confirmation note for QM; no wake.
- [ ] When `cloudflare-v0.3.2` is live: leave the relay note and send one gate
      wake naming the fresh-fixture smoke and the acceptance record. QM runs
      it in one gate turn and hands the conch back to Rick. If the smoke fails,
      QM stops and reports rather than amending the acceptance.
- [ ] Close this plan after the handoff and the v0.3.2 acceptance record.

## Non-goals

No broker token or lock; the conch is a convention recorded in the notes, not
a mechanism. No broadcast across repositories. No secrets, customer data, or
roster material in a note or a wake. No change to the product surface.

No secrets or customer data in this plan.
