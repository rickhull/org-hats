# Assurance and audit evidence

*What an operator being assessed against SOC 2 or TISAX can get from
`org-hats`, what they still own, and where this library makes their evidence
harder than it needs to be. The [threat model](threat_model.md) is about
attackers; this is about assessors.*

`org-hats` is a library. SOC 2 and TISAX assess an **organization and its
environment** — people, policies, physical sites, suppliers, change
management, monitoring — and no library is in scope for either. There is no
"SOC 2 compliant" version of this repository, and a claim to the contrary
would be false on its face.

What a library can be is **friendly**: when the operator's assessor asks for
evidence about the authority layer, the answer should already exist, be
exportable without collateral disclosure, and attribute actions to someone.
That is the standard this document holds the repository to.

## What this repository supplies

These are design properties an operator can point an assessor at, with the
artifact that evidences each.

| What an assessor asks | What exists here |
| --- | --- |
| How is access decided, and is it deterministic? | The authority engine computes claims once; verifiers compare ids and never recompute policy ([`authority_redesign.md`](authority_redesign.md), `A5`). |
| Is the behaviour specified, or emergent? | Named invariants in [`../specs/`](../specs/), each with `Held by`, `If it breaks`, and a test-side witness. An invariant without a witness fails the suite. |
| How are authorization changes made? | Typed commands with a declared owner, scope, standing, and mode ([`commands.md`](commands.md)). |
| Is privileged action recorded? | Audit rows `(seq, at, actor, fact)` on both coordinators, written in the same transaction as the mutation. |
| Can the audit trail be produced on its own? | `GET /ops/audit?coordinator=…&id=…` returns those rows and nothing else — secret-free by construction, unlike `/ops/export` ([`cloudflare.md`](cloudflare.md)). |
| Is a restore recorded? | Yes, and it is the one audit row a snapshot cannot supply: restore writes it after replacing the tables, so the act cannot erase its own trace. |
| Who performed a privileged action? | The identity the caller claimed on `x-ops-operator`, or the literal `operator` when none was sent. A claim, not proof — see below. |
| Are retries safe? | Idempotency claims commit with their mutation; a reused key with a different payload is named misuse (`A8`). |
| Is access revoked promptly? | Actor disable or unlink, participation or grant revocation, and team retirement revoke affected refresh records; an issued envelope stands only to its expiry ([`consumer-session.md`](consumer-session.md), `A7`, `A13`). |
| Are secrets stored? | Activation secrets are stored as digests only; refresh handles are hashed at rest ([`activation.md`](activation.md), `A16`). |
| Who owns which control? | The threat model names the library, host, operator, and consumer per row, and the non-goals are explicit. |
| How is a key compromise handled? | [`key_compromise.md`](key_compromise.md): detection, containment, the owning authority, and verification per asset. |
| How are vulnerabilities reported and fixed? | [`../SECURITY.md`](../SECURITY.md): private intake, acknowledgement and triage targets, coordinated disclosure, supported release lines. |
| What is shipped, and from where? | Immutable tags, tracked `dist/`, `bin/check-version`, and a documented release path with no registry publication. |
| What does it depend on? | The portable source has no runtime dependencies and compiles with `types: []`; the fence is enforced by `bin/check` (`P1`). |
| What third-party code reaches our runtime? | None. The root declares no dependencies and the Cloudflare package's sole dependency is the workspace sibling; the entire lockfile is build and test tooling that never ships. Reachability of a third-party advisory into a deployment is zero by construction. |
| Are install scripts controlled? | Deny-by-default: `pnpm-workspace.yaml` carries an explicit `allowBuilds` allowlist with a written reason per entry (`esbuild` and `workerd` admitted, `sharp` refused). CI installs `--frozen-lockfile` with pnpm pinned exactly. |
| How are dependency advisories triaged? | `pnpm audit` reports against 0 production and 160 development dependencies, so an advisory is triaged by reachability first: into a consumer's runtime it is nil by construction, and into our build it is weighed against what the tool actually does. An advisory is not closed because an upgrade exists — where the fix is pinned by an upstream package, the acceptance and its re-check trigger are recorded rather than forced through an override. The latest audit and resolved triage are below. |

The invariant-and-witness structure is the unusual part, and it is the one an
assessor can use most directly: a control statement with a named test behind
it is the shape both regimes ask for and most codebases cannot produce.

## What the operator owns regardless

Neither regime lets a library discharge these, and the threat model's
assumptions already say so. Listed here because an assessor will ask and the
answer is "the operator", not "upstream":

- identity provision, authentication strength, and session UX;
- custody of `OPS_TOKEN`, signing secrets, and the provider client secret;
- who may reach the ops surface and the Durable Object bindings;
- transport security, cookie attributes, CSRF defences, and step-up policy;
- rate limiting and volumetric availability;
- log shipping, retention, alerting, and monitoring;
- backup schedule, restore drills, and recovery objectives;
- personnel, physical, and supplier controls;
- the product response to every closed failure kind.

TISAX adds prototype protection and a data-protection module, and SOC 2 adds
the Privacy criteria when in scope; both land on the operator's deployment,
not on this library. What this library owes them is not getting in the way.

## Standing advisory triage

`pnpm audit`, 2026-11-04, after the ordinary Cloudflare toolchain refresh: no
known vulnerabilities across 0 production and 160 development dependencies.
No override or forced remediation is present.

An earlier audit on 2026-11-02 found five high and four moderate advisories across
two development-only transitives of the Cloudflare package:

- **`undici`** (eight advisories), reached through `miniflare` from both
  `@cloudflare/vitest-plugin` and `wrangler`, resolved by `undici` 7.30.1 in
  `miniflare` 5.20261101.0-beta;
- **`zod`** (one high), reached through `@cloudflare/vitest-plugin`, resolved
  by `zod` 4.6.6 in `@cloudflare/vitest-plugin` 1.4.12.

Disposition: **resolved when the recorded re-check trigger fired.** The direct
tools move to `wrangler` 4.156.1 and `@cloudflare/vitest-plugin` 1.4.12;
`@cloudflare/workers-types` moves with Wrangler's peer contract. Consumer
runtime reachability remains nil: neither published artifact carries any of
these development dependencies.

## Where this repository makes evidence harder

Recorded as facts, not promises. Each is a friction an operator will meet, and
the owner of the fix.

**Operator attribution is a claim, not proof — and that is the decided
posture, not a gap.** An ops caller may send
`x-ops-operator: <id>`, and the audit row records it in place of the bare
literal `operator`. That is worth having — an assessor asking "which
administrator ran this restore?" now gets a name — but the ops token remains
all-or-nothing, so anyone holding it can claim any identity. The trail is
therefore exactly as trustworthy as the operator's control over who holds the
token, and no further.

This is deliberate and permanent unless its named trigger fires: operator
identity is **transport-owned**, and the model will not grow an operator
actor. An identity worth recording is one worth authenticating, and an
authenticated operator principal would bring issuance, rotation, revocation,
and a permission model onto the highest-privilege surface — a larger
assurance surface than the one it answers, for an audience of one operator
today. What an operator does instead, at their own edge: per-operator tokens
at a proxy in front of the ops surface, mTLS client identity, a bastion with
its own authentication, or address allowlists — controls assessors already
know how to examine. The revisit triggers are concrete: a second operator
appears, or a consumer needs separation of duties inside the ops surface.
Either turns this paragraph into a plan; neither has happened.

**The audit log is not tamper-evident.** This is an explicit non-goal, and it
is the right call for a library that does not own storage — but it is a stated
gap rather than an absent one. Audit rows are ordinary rows: an authorized
restore or direct storage access can rewrite them, and nothing detects it.
Operators needing log integrity must ship rows to an append-only store they
control, and should expect an assessor to test that path rather than this one.

**Audit rows and idempotency claims grow linearly, by formula, and the
retention policy is the operator's.** This is the decided answer: the
library offers no pruning mechanism, states the growth exactly, and the
growth is linear in privileged activity with no amplification:

- **one idempotency-claim row per admitted command** — applied, replayed,
  or idempotent no-op alike; a command refused before its handler commits
  no claim (`A8`: a denied command cannot poison its key), and a replay
  adds nothing, since its row already exists;
- **one audit row per mutating act**, and none for no-ops, replays, the
  session surface (issue, refresh, context, the roster read), or ops
  reads; a restore writes exactly one, after it replaces the tables.

Rows are O(1) writes inside the mutation's own transaction — no command
writes a row per grant, per team, or per participant. Where the operator
reads the ledger: both coordinators' `/status` report live `audit` counts
(the operation's also reports `refreshRecords`, the other table sessions
grow), and claims are carried by export for offline counting. An operator
who must bound storage prunes at their own storage layer with one
contract in view: **a claim is what makes a retry safe**, so a pruning
window shorter than a caller's retry horizon reopens double-application
for keys still in flight. Retention is therefore the operator's to own
and to state, with this formula as the growth expectation.

**Name clearing exists; a complete erasure workflow does not — and the
boundary is now stated.** This is the decided boundary, not an open
decision:

- `update-actor` with `displayName: null` clears an actor's display name
  through the ordinary authority command, and no second name-clearing
  command will be added;
- `unlink-principal` removes the person-to-actor binding — the
  identity-bearing rows (provider, subject) — after which refresh fails
  closed and no new session issues for that binding;
- the library never deletes an actor, a grant, an audit row, or a team:
  actor ids are addresses rather than personal data by rule (a host must
  not encode a name or mail fact into one), audit history is
  authority-relevant, and retention follows the formula above.

What stays with the deployment, and is the operator's to answer in an
erasure request: backups and exports already taken (an export carries
links and names as they stood), downstream consumer data, and the
identity provider's own records of the subject. The library's erasure
reach ends at the live tables, and an assessor should be told exactly
that.

**Release integrity rests on policy, not cryptography — and that is the
recorded choice.** Tags are immutable by repository rule and
`bin/check-version` checks agreement, but a git tag is a name. There is no
signed tag, no provenance attestation, and no reproducible-build claim. The
recorded answer to "how is an upstream artifact authenticated" is:
**pin the commit hash, not the tag** — the NAS forge is the release
authority, the mirrors are best-effort convenience, and the consumer's own
pin check (resolved hash against manifest, as the current consumer's
`pin_state` does) is the control that exists in practice. Signed tags are
declined for now: they would aim squarely at the weakest leg — the
best-effort mirrors — at the standing cost of a signing key's custody,
rotation, and compromise response. The shelf condition is concrete: an
assessor who rejects commit-pinning, or a consumer who wants to verify
signatures, turns this paragraph into a small slice (`bin/check-version`
verification plus a documented key); neither has happened.

**Nothing in a release records that it passed its gate.** `bin/verify` writes
a marker, but deliberately as local convenience — its own comment says "never
a release" — and it lives in `.git/`, so it is never published. A release cut
with `bin/release --no-verify` is therefore indistinguishable from a verified
one, and the honest answer to "how do you know what shipped was tested" is the
repository's policy plus the branch's CI run, not a property of the artifact.
Codeberg's CI witness is manual-dispatch only; GitHub's release-mirror CI
runs on push and provides separate portable, workerd, and tag-artifact
evidence as described in [publishing.md](publishing.md#ci). Those run logs
are not an attestation carried by the release artifact. This is decided with
the release-signing question above: the witnesses are the branch's CI runs
and the release discipline, an attestation field would ride the same signed
tag that paragraph declines, and the same shelf condition covers both.

## How to read this

An operator should treat the first table as evidence they may cite, the second
section as their own control scope, and the third as known findings to disclose
rather than discover mid-assessment. Nothing here is a certification, a
readiness assertion, or advice from an assessor.
