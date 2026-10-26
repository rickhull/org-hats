# Agent mesh protocol — adoption with Quartermaster

**Status (2026-10-26):** QM's four amendments are accepted and deployed in the
local protocol. `cloudflare-v0.3.2` is live at 100%; the relay note and one
gate wake asked QM for the fresh-fixture smoke and acceptance record. Gate is
the default; `mode=lease` is the header for a multi-round leased coroutine.

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
- [x] When `cloudflare-v0.3.2` went live: leave the relay note and send one
      gate wake naming the fresh-fixture smoke and the acceptance record.
      Delivered 2026-10-26; waiting on QM's one-turn smoke and acceptance.
- [ ] Close this plan after QM records the v0.3.2 acceptance. If the smoke
      fails, QM stops and reports; the rollback is
      `qm ops authority release cloudflare-v0.3.1 --percentage 100`.

## Non-goals

No broker token or lock; the conch is a convention recorded in the notes, not
a mechanism. No broadcast across repositories. No secrets, customer data, or
roster material in a note or a wake. No change to the product surface.

No secrets or customer data in this plan.
