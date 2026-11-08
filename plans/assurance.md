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

Actors can be created, renamed, and disabled; administrator standing can be
retired. `update-actor` already accepts `displayName: null`, clearing the
name while retaining the actor id. That is implemented behavior, not a
future model change. It does not clear principal links, grants, audit actor
references, exported snapshots, or downstream data.

The remaining question is what broader erasure contract this library owns.
Keeping identifiers for history and removing identifying data need an
explicit boundary, including which facts remain deployment-owned; name
clearing alone does not settle it.

**Decision needed:** whether this library owns additional erasure behavior
beyond name clearing, and the retained facts and deployment obligations in
either case. **Done when:** either the chosen behavior is documented and
witnessed with its effects on links, grants, refresh, participation, and
audit, or `docs/assurance.md` explicitly bounds the existing command and
records what stays with the deployment, including backups and downstream
data. Do not add a second name-clearing command to close this decision.

## Decision 4 — cryptographic release integrity

Tags are immutable by repository rule and `bin/check-version` checks
agreement, but a git tag is a name. There is no signed tag, no provenance
attestation, and no reproducible-build claim. "Pin a commit" is sound and is
what the threat model already says; it is weaker than a signature when an
assessor asks how upstream artifacts are authenticated.

The red-team campaign found a second item of the same shape: nothing in a
release records that it passed its gate. `bin/verify`'s marker is local
by design and never published, so a `--no-verify` release is
indistinguishable from a verified one. Both questions are "what can a
consumer verify about an artifact without trusting us", and both are answered
by the same mechanism if one is built.

**Decision needed:** whether release signing is worth its key-custody cost,
given that the NAS forge is the release authority and the mirrors are
best-effort — and if it is built, whether the signed object also attests that
the gate passed. **Done when:** either annotated tags are signed with a
documented key and verification step, covering both claims, or
`docs/assurance.md` records the deliberate choice and the commit-pinning
alternative.

## Not in scope here

Tamper-evident audit logging stays an explicit non-goal: this library does not
own storage, and a log integrity claim it cannot enforce would be worse than
the honest gap. `docs/assurance.md` tells operators needing log integrity to
ship rows to an append-only store they control. Revisit only if the authority
ever owns its own storage.

The incident-response half of both regimes is the compromise runbook,
[`../docs/key_compromise.md`](../docs/key_compromise.md), which the red-team
campaign walked scenario by scenario and corrected. Do not restate it here;
cite it.
