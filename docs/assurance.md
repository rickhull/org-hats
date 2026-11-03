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
| Is access revoked promptly? | Disable, unlink, participation, team, and grant changes revoke refresh records; an issued envelope stands only to its expiry ([`consumer-session.md`](consumer-session.md), `A7`, `A13`). |
| Are secrets stored? | Activation secrets are stored as digests only; refresh handles are hashed at rest ([`activation.md`](activation.md), `A16`). |
| Who owns which control? | The threat model names the library, host, operator, and consumer per row, and the non-goals are explicit. |
| How is a key compromise handled? | [`key_compromise.md`](key_compromise.md): detection, containment, the owning authority, and verification per asset. |
| How are vulnerabilities reported and fixed? | [`../SECURITY.md`](../SECURITY.md): private intake, acknowledgement and triage targets, coordinated disclosure, supported release lines. |
| What is shipped, and from where? | Immutable tags, tracked `dist/`, `bin/check-version`, and a documented release path with no registry publication. |
| What does it depend on? | The portable source has no runtime dependencies and compiles with `types: []`; the fence is enforced by `bin/check` (`P1`). |
| What third-party code reaches our runtime? | None. The root declares no dependencies and the Cloudflare package's sole dependency is the workspace sibling; the entire lockfile is build and test tooling that never ships. Reachability of a third-party advisory into a deployment is zero by construction. |
| Are install scripts controlled? | Deny-by-default: `pnpm-workspace.yaml` carries an explicit `allowBuilds` allowlist with a written reason per entry (`esbuild` and `workerd` admitted, `sharp` refused). CI installs `--frozen-lockfile` with pnpm pinned exactly. |

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

## Where this repository makes evidence harder

Recorded as facts, not promises. Each is a friction an operator will meet, and
the owner of the fix.

**Operator attribution is a claim, not proof.** An ops caller may send
`x-ops-operator: <id>`, and the audit row records it in place of the bare
literal `operator`. That is worth having — an assessor asking "which
administrator ran this restore?" now gets a name — but the ops token remains
all-or-nothing, so anyone holding it can claim any identity. The trail is
therefore exactly as trustworthy as the operator's control over who holds the
token, and no further. There is still no separation of duties inside the
surface. An operator who needs attribution that resists its own holders needs
per-operator tokens, which this library does not provide.

**The audit log is not tamper-evident.** This is an explicit non-goal, and it
is the right call for a library that does not own storage — but it is a stated
gap rather than an absent one. Audit rows are ordinary rows: an authorized
restore or direct storage access can rewrite them, and nothing detects it.
Operators needing log integrity must ship rows to an append-only store they
control, and should expect an assessor to test that path rather than this one.

**Audit rows and idempotency claims are retained indefinitely.** There is no
pruning, no retention policy, and no documented growth expectation. A
long-lived operation accumulates one claim row per successful command and one
audit row per privileged act, forever. Retention is a question both regimes
ask directly, and the honest current answer is "unbounded, and the operator
owns the policy."

**There is no erasure path for personal data.** Actors can be created,
updated, disabled, and retired as administrators, but never deleted, and actor
display names are personal data. Audit facts also embed actor ids. An operator
facing a GDPR erasure request, or TISAX's data-protection module, cannot
satisfy it through the authority surface today; the deployment must act on
storage directly, which is exactly the path that bypasses every control above.

**Release integrity rests on policy, not cryptography.** Tags are immutable by
repository rule and `bin/check-version` checks agreement, but a git tag is a
name. There is no signed tag, no provenance attestation, and no reproducible
build claim. A consumer who needs an immutable commitment pins a commit; an
assessor asking how upstream artifacts are authenticated gets "we pin a
commit", which is sound but weaker than a signature.

**Nothing in a release records that it passed its gate.** `bin/verify` writes
a marker, but deliberately as local convenience — its own comment says "never
a release" — and it lives in `.git/`, so it is never published. A release cut
with `bin/release --no-verify` is therefore indistinguishable from a verified
one, and the honest answer to "how do you know what shipped was tested" is the
repository's policy plus the branch's CI run, not a property of the artifact.
Mirror CI is manual-dispatch only, so it is not that evidence either. This is
the same gap as the unsigned tag and has the same fix shape, which is why it
sits under the release-signing decision rather than beside it.

## How to read this

An operator should treat the first table as evidence they may cite, the second
section as their own control scope, and the third as known findings to disclose
rather than discover mid-assessment. Nothing here is a certification, a
readiness assertion, or advice from an assessor.
