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
4. Stop. Do not send a substantive reply or a wake in that turn. A pure
   receipt note ("received; Rick reviewing") is allowed only when the peer
   would otherwise be blocked waiting.

The note is the message; the wake is only the doorbell. Gate protects Rick's
turn and prevents an inbound message from turning into an outbound cascade.

**Coroutine is a lease.** It is opened deliberately for a named goal, by Rick
or with his prior consent:

- Record it in the relay note: `mode=coroutine; lease=<id>; goal=…;
  budget=<rounds>; exits=…; conch=<agent>`.
- Both sides accept before either wakes.
- The conch alternates; one outstanding wake per direction; every wake
  carries `re` and a bounded ask.
- A side with no action returns the conch with a note, not a wake.
- Exit on completion, a blocker, the round budget, or any message from Rick.
  Exit with a final note: `mode=gate`.

Without a live lease, an incoming message is gate.

## The conch

The human holds the conch outside a coroutine. A wake is a **conch transfer**,
not a message: the woken agent takes the conch, acts on the bounded ask,
leaves a note, and either returns the conch with a wake (only if the peer now
has a blocking action) or ends quietly.

- The agent with the blocking dependency initiates.
- If both are waiting, the earlier unresolved note wins; otherwise alternate.
- Never two consecutive initiations by the same side in a thread.
- Rick can revoke a lease at any time; his next message returns the thread to
  gate unless he renews it.

## Wake rules

Wake only when all of these hold:

- the peer has a named next action (not an acknowledgment),
- the action is bounded and time-sensitive,
- a note alone would likely sit past the useful window,
- the note already contains the full state and ask, and
- the wake body is a one-line pointer to that note.

Never wake for ACK/FYI, a check-in, or a release announcement unless the peer's
next step depends on it now. Never wake without a note. Keep one outstanding
wake per direction; a denied or unanswered wake becomes a note and a report to
Rick, not another wake.

Echo every mesh address verbatim — never construct, split, or normalize one.
Broadcast is folder-scoped and does not cross repositories. Do not use the
deprecated blocking `agent_request`.

## Mode resolution

1. Rick's instruction in the session.
2. A live, accepted coroutine lease in the relay note.
3. Gate.

A message carrying `lease=<id>` is coroutine only if that lease is recorded
and this agent accepted it. A stale or unaccepted lease falls back to gate.

## Header and report

At the top of the relay note, or at the start of a thread:

```text
Coordination: mode=gate; conch=rick; wake=none
Coordination: mode=coroutine; lease=<id>; goal=<...>; budget=<rounds>; exits=<...>; conch=<agent>
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
- Denied or unanswered wake: notes only, then report to Rick.
- Inbound message while Rick is driving: process minimally, report, hand back;
  do not wake the peer.
- A lease never outlives a message from Rick.

## Non-goals

No broker-level lock or token exists; the conch is a convention recorded in
the notes. No secrets, customer data, or roster material in a note or a wake.
The protocol governs agent coordination, not product behavior.
