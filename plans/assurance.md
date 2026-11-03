# Assurance frictions — making an operator's assessment easier

[`docs/assurance.md`](../docs/assurance.md) records what an operator assessed
against SOC 2 or TISAX can evidence from this library, what stays theirs, and
the frictions this repository imposes. That document is the durable statement;
this plan is the forward work it implies.

Framing that does not change: no library is in scope for either regime, and
nothing here moves toward a compliance claim. The goal is narrow — when an
assessor asks about the authority layer, the operator should not have to
apologise for us.

The audit-trail friction is already closed: `GET /ops/audit` returns
`{ seq, at, actor, fact }` and nothing else, so producing an audit trail no
longer discloses the sealed provider configuration that `/ops/export` carries.
What remains needs decisions, not just work.

## Decision 1 — operator attribution on privileged actions

Every ops-token action records the literal actor `"operator"`. The token is
all-or-nothing by design, so there is no identity to record and no separation
of duties inside the surface. An assessor asking which administrator ran a
restore gets no answer from the audit rows.

The options are not equivalent, and the choice is the consumer's as much as
ours:

- an optional caller-supplied operator identifier on ops requests, recorded in
  the audit `actor` column — cheap, additive, and unauthenticated, so it is an
  attribution aid and must not be described as proof;
- per-operator tokens, which turns `OPS_TOKEN` into a token set and makes the
  surface no longer all-or-nothing — a real custody and rotation change for the
  operator, and a larger change here;
- leave it, and document that attribution for the ops surface comes from the
  operator's transport logs rather than from `org-hats`.

**Decision needed:** which of these, and whether an unauthenticated identifier
is worth having. **Done when:** the audit rows either carry an operator
identity with its trust level stated, or `docs/assurance.md` says plainly that
attribution is transport-owned and why.

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
