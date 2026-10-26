# Agent mesh — notes, wakes, and the conch

*How the two agents coordinate over the local Pi mesh. The Quartermaster relay
rules are in [`AGENTS.md`](../AGENTS.md); this document says when a mesh send
is allowed and how a received message is handled. The relay notes are the
durable record; the mesh is an interrupt channel.*

## Two modes

**Gate is the default.** On a received mesh message:

1. Read the relay note. A wake without a note is not actionable.
2. Do bounded processing — inspect state, run checks, diagnose, draft. Do not
   commit, push, tag, or edit the other repository; the note is the only write
   there.
3. Report to Rick as a decision memo: what arrived, what it changes, what was
   verified, the options, the recommendation, and the decision needed.
4. Stop. Do not wake the peer. A note reply is allowed when it restates what
   the repository already records — an acceptance, a version, a pointer —
   because the note is the record. A gate turn does **not** commit the
   project: accepting a runtime, moving a pin, adopting a protocol, or
   changing a release act is recorded as awaiting Rick with a recommendation.

The note is the message; the wake is only the doorbell. Gate protects Rick's
turn and prevents an inbound message from turning into an outbound cascade.

**A leased coroutine is explicit.** It is opened deliberately for a named
goal, by Rick or with his prior consent:

- Record the lease in the section header:
  `Coordination: mode=lease; conch=<peer>; rounds=1/3; wake=<section>`.
  The section body names the goal and the exits.
- Both sides accept before either wakes.
- The round budget defaults to 3. Exits are: goal met, blocked on Rick, out
  of scope, or budget exhausted.
- A lease unanswered by the next Rick turn lapses back to gate; the note says
  so. A conch that cannot lapse is a stall.
- The conch alternates; one outstanding wake per direction; every wake
  carries `re` and a bounded ask.
- A side with no action returns the conch with a note, not a wake.
- Any message from Rick returns the thread to gate unless he renews the
  lease.

Without a live lease, an incoming message is gate.

## One-round handoffs

A single bounded action — run a fresh-fixture smoke, record an acceptance — is
a **gate wake**, not a lease: one note, one wake, one gate turn that acts and
returns the conch. A lease is for multi-round exchange.

## The conch

The human holds the conch outside a lease. A wake is a **conch transfer**, not
a message: the woken agent takes the conch, acts on the bounded ask, leaves a
note, and either returns the conch with a wake (only if the peer now has a
blocking action) or ends quietly.

- The agent with the blocking dependency initiates.
- If both are waiting, the earlier unresolved note wins; otherwise alternate.
- Never two consecutive initiations by the same side in a thread.
- Rick can revoke a lease at any time; his next message returns the thread to
  gate unless he renews it.

## Wake rules

A wake is **fire-once and self-contained**: one send per direction, one
outstanding, naming the note path, the section, and the single action the peer
owns. A timeout is not retried; the note is the record, and a wake that needs a
retry was not a wake.

Wake only when all of these hold:

- the peer has a named next action (not an acknowledgment),
- the action is bounded and time-sensitive,
- a note alone would likely sit past the useful window,
- the note already contains the full state and ask, and
- the wake body is a one-line pointer to that note.

Never wake for ACK/FYI, a check-in, or a release announcement unless the peer's
next step depends on it now. Never wake without a note. A denied wake becomes a
note and a report to Rick, not another wake.

Echo every mesh address verbatim — never construct, split, or normalize one.
Broadcast is folder-scoped and does not cross repositories. Do not use the
deprecated blocking `agent_request`.

## Mode resolution

1. Rick's instruction in the session.
2. A live, accepted lease in the relay note.
3. Gate.

A message carrying a lease is coroutine only if that lease is recorded and this
agent accepted it. A stale or unaccepted lease falls back to gate.

## Header and report

Every new relay section carries a header, including replies:

```text
Coordination: mode=gate; conch=rick; wake=none
Coordination: mode=lease; conch=<peer>; rounds=1/3; wake=<section>
```

A gate report to Rick:

```text
From: <peer>; note: <section>
Arrived: <what the message says>
Verified: <what I checked>
Options / recommendation: <one recommendation>
Decision needed: <the question>
```

## Failure handling

- Wake without a note: treat it as gate, ask for the note, do not act.
- Stale or unaccepted lease: gate.
- Timeout: no retry; the note is the record.
- Denied wake: notes only, then report to Rick.
- Inbound message while Rick is driving: process minimally, report, hand back;
  do not wake the peer.
- A lease lapses when Rick next speaks; it never outlives his turn.

## Non-goals

No broker-level lock or token exists; the conch is a convention recorded in
the notes. No secrets, customer data, or roster material in a note or a wake.
The protocol governs agent coordination, not product behavior.
