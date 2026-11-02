# Red-team campaign — authority and release boundaries

The repository has a design-level threat model, a security policy, and a
key-compromise runbook.  They have not yet been tested as one adversarial
system.  This campaign challenges their claims against the portable authority,
the Cloudflare reference runtime, and the release path.  It runs locally and
produces executable regression evidence; it does not probe a deployed tenant,
an identity provider, or third-party infrastructure.

The campaign is ordered so that the model and its evidence gaps are known
before new tests are written.  A confirmed vulnerability is reported to Rick
privately before exploit details enter a tracked file.  The public repository
receives the reproducing test, fix, and durable documentation together, after
the disclosure decision.

## Scope and rules of engagement

**In scope**

- `src/`: envelope verification, neutral access, authority commands, refresh,
  activation, idempotency, policy, and the in-memory reference engine.
- `packages/cloudflare/`: Worker routing, operator authentication, OIDC
  exchange, Durable Object coordination, persistence, restore, alarms, and
  cross-coordinator races.
- The committed lockfile, CI and release tooling, tracked `dist/`, tag/version
  checks, and documented release procedure.
- `docs/threat_model.md`, `docs/key_compromise.md`, `SECURITY.md`, and the
  named invariants in `specs/`.

**Out of scope without a new, explicit authorization**

- Requests to a deployed Worker, tenant, production Durable Object, real IdP,
  Codeberg, GitHub, or another Internet target.
- Password guessing, volumetric load, persistence, social engineering, secret
  retrieval, or use of real roster or customer data.
- Changing deployment configuration, rotating credentials, publishing a
  release, or exercising an incident procedure against a live system.
- Work in the Quartermaster repository.  A consumer-owned question goes
  through `notes/to-quartermaster.md` under the relay protocol.

All fixtures stay synthetic.  Tests use generated, test-local keys and tokens.
No secret, export, exploit transcript, or sensitive finding enters relay notes,
logs, snapshots, or tracked documentation.

## Finding discipline

Every candidate moves through these states:

1. **Hypothesis** — an attack path worth testing, with the asset and trust
   boundary it challenges.
2. **Confirmed** — the smallest local reproduction violates a documented
   invariant or establishes impact not recorded as residual risk.
3. **Accepted residual risk** — the behavior matches an explicit non-goal or
   residual-risk statement; the campaign records evidence, not a defect.
4. **Documentation defect** — implementation is sound but the threat model,
   runbook, or security policy overstates, omits, or misclassifies the result.
5. **Rejected** — the hypothesis cannot cross the named boundary; the evidence
   that rejected it is retained when it protects against a plausible
   regression.

Severity follows demonstrated impact, not the component's importance:

- **Critical:** unauthenticated signing authority, cross-tenant administration,
  release compromise, or broad secret disclosure with a practical path.
- **High:** authentication or authorization bypass, durable cross-boundary
  state mutation, or practical credential forgery/reuse outside the documented
  window.
- **Medium:** bounded information disclosure, denial of service with modest
  attacker cost, or a required security control that fails under a realistic
  condition.
- **Low:** defense-in-depth weakness or misleading security behavior with no
  demonstrated privilege or confidentiality impact.

A confirmed critical or high finding stops the current phase.  Rick receives
the reproduction, affected versions, immediate containment, and recommended
next decision before the campaign continues.  Remediation follows the
repository's bugfix rule: prove the defect red first, then fix it, and keep the
test and fix in one commit-sized handoff.

## Moshpit execution

This campaign is the threshold-case test of the shared `moshpit` skill.  The
orchestrator runs in a harness that can put the strongest model in the chair
and choose a model per specialist; if this Pi harness cannot, hand the run to
Claude Code or another capable harness.  The campaign plan remains
authoritative over the harness.

The orchestrator owns the threat-model matrix, the gap register, the
cross-area decisions, the stop conditions, and the final adjudication.  It
settles these before any spawn:

- the matrix schema and disposition vocabulary (`confirmed`, `residual`,
  `documentation defect`, `rejected`);
- the evidence standard (invariant, source path, test name, owner);
- severity and owner classification; and
- private-finding routing and the disclosure point.

Specialists own boundary lanes; helpers do bounded extraction only.  A
specialist that finds a cross-lane or cross-cutting issue reports it upward;
it does not judge it alone.  No specialist receives another lane's transcript;
pointers and row dispositions travel through the orchestrator.

Phase 1 is the initial two-lane pod:

- **issuer → verifier** — envelope format, canonical bytes, signature and key
  set, claims, access verification, and the fixed vectors;
- **operator → ops** — operator authentication, ops routes, the ops token,
  sealed IdP configuration, bootstrap/export/restore, and the runtime's
  operator boundary.

The orchestrator integrates the two lane reports into one matrix, reconciles
overlapping threat rows, and stops for Rick's review before any attack test is
written.

Later phases are sequenced, not parallel campaign lanes.  The orchestrator may
form a phase-scoped pod when that phase has two or more durable, independent
sub-areas; it must not run a later phase while an earlier phase's confirmed
finding or open cross-area decision would change its premises.  A confirmed
critical or high finding stops the current phase and goes to Rick privately;
the pod does not continue around it.

Phase 1 is read-only.  In phases that add tests, workers may run a single named
suite; the orchestrator runs `pnpm check`, `pnpm check:cloudflare`, or
`pnpm verify` at integration, never inside a worker.  Parallel writers use
worktrees or disjoint file allowlists.  Mechanical breadth may use
`agentic-sweep` in an isolated sweep lane; it is a batch tool, not a second
command structure.

Because Phase 1 is a threshold case, its report ends with the moshpit
self-evaluation from the shared skill.  The evaluation covers process, not
finding details; sensitive evidence stays in the private report.  A “should
have been inline” verdict is a valid result and informs whether later phases
use a pod or run serially.

This execution model does not change the campaign's scope, sequencing,
disclosure rules, or stop conditions.

## Phase 1 — Claims-to-evidence map

Build a traceability matrix from each threat, assumption, and residual risk in
`docs/threat_model.md` to its enforcement and negative evidence.  Include the
relevant `A#`, `E#`, or `P#` invariant, source boundary, existing test, and
owner when the control belongs to the host or operator.

Challenge in particular:

- whether every reachable input is named, including stored snapshots, Durable
  Object messages, environment configuration, OIDC documents, and release
  metadata;
- whether procedural controls are described as procedural rather than code
  guarantees;
- whether mitigations actually bound the residual risk claimed; and
- whether the security policy's in-scope components match the shipped
  Cloudflare package and current supported release families.

**Evidence:** a review report delivered to Rick, with one disposition per
threat-model row and separate lists of missing boundary, missing enforcement,
missing test, and inaccurate claim.  Confirmed sensitive details remain
private until fixed.

**Exit:** every current threat-model row has an implementation owner and an
evidence disposition; every newly found boundary is either added to the model
or explicitly rejected with evidence.

## Phase 2 — Portable credential and authority attacks

Add focused negative and generative tests before changing portable code.

Attack the credential boundary with malformed formats and versions, unknown or
duplicate key ids, altered claims, non-canonical encodings, Unicode and numeric
edge cases, expiry boundaries, wrong operation/site bindings, oversized
claims, and key rotation or retirement mistakes.  Verify that untrusted input
is rejected before a domain value or authorization decision is produced.

Attack authority state with cross-organization subjects, cross-operation
targets, selected-hat confusion, stale envelopes, disabled or unlinked actors,
revoked participation/team/grant state, refresh reuse and concurrency,
idempotency-key collisions and payload substitution, reordered or duplicate
outbox delivery, and activation-secret replay.  Distinguish a real violation
from the bounded race and bearer replay already accepted by A7, A13, and the
threat model.

**Evidence:** minimal tests in the existing portable suites, tagged with an
existing invariant when one applies.  A new invariant is added to
`specs/authority.md`, `specs/envelope.md`, or `specs/portability.md` only when
the implementation already holds it and the same change supplies its witness.

**Verification:** run the focused `node --test tests/<file>.test.ts` command
while developing, then `pnpm check`.  Changes under `src/` also require
`pnpm build` so tracked `dist/` agrees.

**Exit:** each Phase 1 gap owned by the portable layer has a regression test,
an explicit residual-risk disposition, or a documented reason that the host
owns it.

## Phase 3 — Cloudflare boundary and state attacks

Exercise the reference runtime through its local Vitest/workerd harness.  No
deployed endpoint is in scope.

- Treat OIDC discovery, JWKS, token responses, headers, cache directives, and
  JWTs as hostile.  Test endpoint substitution, redirect behavior, key
  confusion, rotation/refetch bounds, malformed and oversized bodies, optional
  claim shapes, time skew, and failure classification.  Verify where provider
  trust ends and transport/input validation begins.
- Enumerate the Worker fetch routes and prove that demo and harness routes are
  closed unless explicitly enabled, ops routes use the timing-safe token gate,
  and the public verification-key route discloses only its documented data.
- Exercise organization-directory ambiguity, subject-guard serialization,
  wrong coordinator ids, stale projections, duplicate/reordered alarms,
  concurrent refresh/revocation, and partial cross-coordinator workflows.
- Restore synthetically hostile snapshots: future schemas, invalid references,
  fabricated claims, replayable outbox rows, and sealed configuration.  Prove
  the exact boundary between validated structure and operator-authorized state.
- Establish bounded local cost for expensive parsing, signature verification,
  provider refetch, restore, and alarm paths.  This is a complexity and
  amplification review, not a volumetric load test.

**Evidence:** negative tests under `packages/cloudflare/test/`, plus threat
model or runbook corrections where behavior is intentionally operator-owned.

**Verification:** run focused tests with
`pnpm --filter org-hats-cloudflare exec vitest run <test-file>`, then
`pnpm check` and `pnpm check:cloudflare`.  Do not run these concurrently with
`bin/check-dist` or `pnpm verify`.

**Exit:** every Cloudflare-owned boundary in the traceability map has hostile
input evidence, race evidence where ordering matters, and an explicit owner
for any unmitigated availability or deployment risk.

## Phase 4 — Supply-chain and release attacks

Review the path from source to the commit a consumer pins:

- corroborate the package manager, workspace boundaries, lockfile, CI pins,
  and dependency-script policy;
- inspect new and transitive dependencies for install scripts, provenance,
  maintenance, and reachability, then run `pnpm audit` with network access only
  after Rick authorizes it;
- prove a clean build reproduces tracked `dist/` and that the artifact exports
  only the declared surface;
- attack tag-family selection, wrong-commit tags, manifest disagreement,
  mirror publication failure, dirty checkout behavior, CI credential
  scrubbing, and source/artifact divergence; and
- separate repository policy (tags do not move) from cryptographic assurance
  (a consumer pins a commit when it needs an immutable commitment).

**Evidence:** focused release-tool tests, artifact comparisons, and a dependency
triage for every reachable high or critical advisory.  An advisory is not
closed merely because an upgrade exists; reachability and the tested fix are
recorded.

**Verification:** run focused release/tooling suites, then `pnpm verify` after
all code, test, configuration, and generated-artifact changes settle.

**Exit:** the committed source, built artifact, version, tag family, and
consumer pin form one explainable chain, and no reachable high or critical
advisory is left without a recorded decision.

## Phase 5 — Compromise tabletop

Run local, synthetic walkthroughs for signing-key compromise, unknown verifier
key, ops-token disclosure, sealed IdP-secret disclosure, stolen envelope,
stolen refresh handle, exposed activation secret, malicious restore, and an
accidental development signer.

For each scenario, identify detection evidence, the first containment action,
the authority that owns it, session and refresh consequences, verification
steps, cutback limits, and the point where consumer or operator coordination is
required.  Commands that would mutate a live deployment are reviewed as text,
not executed.

**Evidence:** corrections to `docs/key_compromise.md` and
`docs/threat_model.md`, plus local tests for any repository-owned mechanism the
tabletop reveals as missing.  Consumer-owned decisions are requested through
the relay without including secrets or exploit material.

**Exit:** every asset in the threat model has a containment path, an owner, and
a verification step; the runbook never relies on a credential already assumed
compromised and never mistakes signing-key rotation for refresh revocation.

## Phase 6 — Adjudication and closeout

Re-run the claims-to-evidence map against the final tree.  Classify every
hypothesis, ensure every confirmed defect has a reproducing test and an owner,
and distinguish fixes from consciously accepted residual risks.  Remove this
plan when all work lands; durable conclusions remain in `docs/`, named
invariants remain in `specs/`, and executable evidence remains in the suites.

**Final verification:** `pnpm verify` passes on the complete change set, the
documentation links resolve through `pnpm check`, and a clean diff review finds
no secret, real roster, exploit transcript, or unsupported security guarantee.

**Done when:** all threat-model rows and newly discovered boundaries have a
recorded disposition; every repository-owned confirmed defect is fixed with a
regression test or is explicitly accepted by Rick; the compromise table is
executable as a local procedure; and the threat model accurately states the
remaining host-, operator-, and consumer-owned risk.

## Phase 1 — complete

Run 2026-11-02 in Claude Code as a two-lane moshpit pod (Opus chair, Sonnet
specialists, an unused Haiku helper tier), plus a bounded same-lane successor
after the operator-to-ops lane retired at its context ceiling.  Every
threat-model row, trust boundary, asset, assumption, the non-goals, and every
`SECURITY.md` invariant bullet now carries an owner and an evidence
disposition: 38 verified, 9 residual, 2 documentation defects, 1 confirmed,
1 rejected, 3 deferred to Phase 4.  The threshold self-evaluation returned
*earned its keep*, with the margin coming from integration judgment rather
than from parallelism.

The disposition vocabulary needed a fifth value, `verified`, for a claim that
holds with its enforcement located and a witness named; the plan's four
describe outcomes of an attack, not of a claims-to-evidence map.

What landed from Phase 1, and its evidence:

- **Confirmed, medium — the envelope version gate threw instead of failing as
  a value.**  `envelopeVersionFailure` read `format`, `v`, and `claims.v`
  with no structural guard, so a `null` envelope or one with `claims` absent
  left `verify` by a `TypeError` — against the stated contract ("a
  session-surface failure, as a value — never an exception"), E4, and A4's
  closed taxonomy.  Reachable through all three callers: the verifier, the
  context, and command authorization, where the claims were read one
  statement *before* the gate.  A host-supplied verify predicate that threw
  escaped the same way.  Fixed in `src/contract.ts`, `src/access/verify.ts`,
  and `src/authority/organization.ts`; witnessed by the `[E4]` tests in
  `tests/access.test.ts`, `tests/context.test.ts`, and `tests/engine.test.ts`,
  each proven red first.  E4 now states that closed means *as a value*.
- **Two documentation defects, low.**  `SECURITY.md` named
  `cloudflare-v0.11.x` as the current runtime line while `0.12.1` shipped,
  and its in-scope list never named the reference runtime at all while
  "the Cloudflare platform" sat in out-of-scope — read literally, a report
  about the ops-token gate had nowhere to go.  Both corrected.
- **Four under-named reachable inputs**, now a named `Reachable inputs`
  section in the threat model: inter-coordinator relay bodies (trusted
  structurally, no provenance check, platform isolation only), the breadth of
  what a restore trusts, `AUTHORITY_ORGANIZATION_IDS`, and the discovery
  document's ignored fields.
- **Rejected:** the confirmed defect is an instance, not a class.  The
  exchange's `JSON.parse` sites are guarded (`decodeSegment` catches;
  `parseSealedProviderConfig` type-checks), so the correct pattern was
  already present in three places and bounded the fix to one function.
  Evidence retained against regression.
- **Retracted:** a reported absence of a concurrent subject-guard witness.
  `runtime.test.ts` `"[A10] serializes one provider subject across
  concurrent organization claims"` is that witness; the gap came from a
  test-name search standing in for a read.

## Next action

Phase 2's remaining credential and authority attacks, against the portable
layer only.  The confirmed finding above is already closed, so what is left is
the generative and state-machine half: adversarial claims shapes signed with a
test key (oversized, deeply nested, `__proto__`-shaped keys) through
`neutralAccess`; cross-organization grant targets in
`src/authority/commands.ts`, which Phase 1 disposed one layer shallower than
the rest; refresh reuse and concurrency; idempotency-key collision and payload
substitution; and activation-secret replay.

Phase 1's open evidence gaps are the priority inside that, since each is a
claim with no witness: the server-side empty `OPS_TOKEN` refusal, an
integration-level demo-route 404 with `DEMO_ROUTES` unset, the
crafted-snapshot outbox replay the model explicitly accepts, and
`/idp-config`'s unreachability from the public surface.  The first three are
Phase 3, Cloudflare-side; keep them in that phase rather than pulling them
forward.

## Specification placement

Do not create `specs/red-team.md` for this campaign.  The repository's specs
describe properties the working system already enforces, and every new id must
have a test-side witness.  This campaign is forward work.  When it proves a
new durable property, place that invariant beside the boundary it governs in
`specs/authority.md`, `specs/envelope.md`, or `specs/portability.md`, with its
`Held by`, `If it breaks`, and witness in the same change.  Introduce a separate
red-team invariant family only if a recurring, mechanically enforced security
practice exists after the campaign; process guidance alone is not such an
invariant.
