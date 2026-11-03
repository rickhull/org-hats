# Assurance frictions — making an operator's assessment easier

[`docs/assurance.md`](../docs/assurance.md) records what an operator assessed
against SOC 2 or TISAX can evidence from this library, what stays theirs, and
the frictions this repository imposes. That document is the durable statement;
this plan is the forward work it implies.

Framing that does not change: no library is in scope for either regime, and
nothing here moves toward a compliance claim. The goal is narrow — when an
assessor asks about the authority layer, the operator should not have to
apologise for us.

Two frictions are already closed. `GET /ops/audit` returns
`{ seq, at, actor, fact }` and nothing else, so producing an audit trail no
longer discloses the sealed provider configuration that `/ops/export` carries;
and privileged actions now carry the operator identity the caller claimed,
including the restore that previously recorded nothing at all. What remains
needs decisions, not just work.

## Decision 1 — the operator is not an actor

The built part is settled; the concept underneath it is not, and it is upstream
of all three decisions below.

**The absent concept.** The attribution and restore-audit gaps share one cause,
and it is not an oversight in either function. The ops surface is deliberately
all-or-nothing, so it has no identity to record — and nothing in the design
forced the question "who did this?" to have an answer. `actor` exists in the
model for authority commands and does not exist for operator actions. The
header below records a *claim* where the model has no *concept*, which is why
it cannot be more than an aid however carefully it is validated.

That ordering matters for the rest of this plan. Retention, erasure, and log
integrity all become easier to reason about once a privileged act has an
owner, and harder to specify while it does not: a retention window on
unattributed rows is a storage policy rather than an accountability one, and an
erasure request cannot be traced to who served it. Take this decision before
the other three, not after.

**Decision needed:** whether operator actions get a first-class actor in the
model — with the custody consequences that implies, since an identity worth
recording is one worth authenticating — or whether this library states
permanently that operator identity is transport-owned and the audit `actor` is
an aid. **Done when:** either the model carries an operator actor with its
authentication stated, or `docs/assurance.md` records the deliberate absence
and what an operator must do instead.

**What is already built,** and keeps its value either way: the cheap, additive
option. An ops caller may send `x-ops-operator`,
validated at the edge (1–64 characters of `A-Za-z0-9._:@-`, refused rather
than dropped so attribution is never silently lost), forwarded inward on the
same header, and recorded as the audit row's `actor`. Absent header keeps the
previous behaviour exactly. It is attribution and never authorization: no
handler branches on it, and `docs/assurance.md` states plainly that anyone
holding the all-or-nothing token can claim any identity.

Per-operator tokens remain unbuilt and are the only thing that would make
attribution resist its own holders. Revisit if a consumer needs separation of
duties inside the ops surface; it is a custody and rotation change for them,
not only a change here.

**A finding came out of implementing it, and is fixed in the same change.**
Neither coordinator recorded a restore at all. The most destructive privileged
act in the system — replacing every table, the audit table included — left no
trace, and a row written before the tables would have been erased by the act
it recorded. Both coordinators now write that row *after* `restoreTables`,
inside the same transaction, attributed to the claimed identity. It is the one
audit row a snapshot cannot supply, so a restored export now differs from its
snapshot by exactly that row; `withoutRestoreAudit` in the test helpers states
that refined round-trip property rather than loosening the comparison.

Two platform behaviours worth not re-deriving: a newline cannot be placed in
the header at all (the fetch API refuses to construct it), so log injection by
that route is unexpressible rather than merely validated; and `audit.seq` is
`AUTOINCREMENT`, so an insert after a restore of explicit seq values cannot
collide.

## Decision 2 — retention of audit rows and idempotency claims

Both grow without bound: one claim row per successful command, one audit row
per privileged act, retained forever, with no pruning and no documented growth
expectation. Retention is a question both regimes ask directly.

Pruning claims is not free — a claim is what makes a retry safe, so discarding
one reopens double-application for any caller still retrying that key. Pruning
audit rows discards the evidence the regimes want. A retention window is
therefore a contract, not a cleanup.

**Decision needed:** whether this library offers a retention mechanism at all,
or states that retention is the operator's and that growth is linear in
privileged activity. **Done when:** either a documented, tested retention
boundary exists with the safe-retry window it preserves, or the growth
expectation and the operator's ownership are stated in `docs/assurance.md` with
the measured per-command cost.

## Decision 3 — erasure of personal data

Actors can be created, updated, disabled, and retired, never deleted. Actor
display names are personal data, and audit facts embed actor ids. An operator
facing a GDPR erasure request, or TISAX's data-protection module, cannot
satisfy it through the authority surface; the deployment must edit storage
directly, which bypasses every control the rest of this repository provides.

The tension is real: erasure and a tamper-resistant audit trail pull against
each other, and the model deliberately keeps tombstones so ids are never
reused. Pseudonymisation — clearing the display name while keeping the id and
its audit history — is probably the shape that satisfies both, but it is a
model change and needs the consumer's view.

**Decision needed:** whether erasure is in scope for this library, and if so
whether it is deletion or pseudonymisation. **Done when:** either a typed
command exists with its effect on grants, refresh, participation, and audit
specified and witnessed, or `docs/assurance.md` states that erasure is
storage-owned and names what the deployment must do.

## Decision 4 — cryptographic release integrity

Tags are immutable by repository rule and `bin/check-version` checks
agreement, but a git tag is a name. There is no signed tag, no provenance
attestation, and no reproducible-build claim. "Pin a commit" is sound and is
what the threat model already says; it is weaker than a signature when an
assessor asks how upstream artifacts are authenticated.

**Decision needed:** whether release signing is worth its key-custody cost,
given that the NAS forge is the release authority and the mirrors are
best-effort. **Done when:** either annotated tags are signed with a documented
key and verification step, or `docs/assurance.md` records the deliberate choice
and the commit-pinning alternative.

## Not in scope here

Tamper-evident audit logging stays an explicit non-goal: this library does not
own storage, and a log integrity claim it cannot enforce would be worse than
the honest gap. `docs/assurance.md` tells operators needing log integrity to
ship rows to an append-only store they control. Revisit only if the authority
ever owns its own storage.

The incident-response half of both regimes is the red-team campaign's Phase 5
([`red-team.md`](red-team.md)), which walks the compromise runbook and fixes
what it finds. Do not duplicate that work here.
