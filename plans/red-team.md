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

## Next action

Begin Phase 1 with the issuer-to-verifier and operator-to-ops boundaries.  They
hold the widest authority and give the later credential, runtime, and release
tests their priority order.  Stop after the traceability report for Rick's
review before writing attack tests.

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
