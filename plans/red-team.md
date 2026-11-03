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

## Phases 1 and 2 — settled

Run 2026-11-02.  Phase 1 was the threshold-case moshpit pod (Opus chair, two
Sonnet lanes, an unused Haiku helper tier, one bounded successor); its verdict
was *earned its keep*, with the margin from integration judgment rather than
parallelism.  Phase 2 ran inline — one area, one checkout, no fan-out.

Every threat-model row, trust boundary, asset, assumption, the non-goals, and
every `SECURITY.md` invariant bullet carries an owner and a disposition.  The
Phase 1 matrix closed at 38 verified, 9 residual, 2 documentation defects, 1
confirmed, 1 rejected, and 3 deferred to Phase 4; Phase 2 then added a second
confirmed finding and three more rejections, all below.  The disposition
vocabulary needed a fifth value, `verified` — the plan's four describe the
outcome of an attack, not of a claims-to-evidence map.

**Fixed, both medium, both test-first.**  The shared envelope version gate
threw instead of failing as a value: `envelopeVersionFailure` read `format`,
`v`, and `claims.v` unguarded, and `canonicalJson` recursed on claims the
verifier had not verified yet — canonical bytes being an input to the
signature check.  Reachable through all three callers (the verifier, the
context, command authorization), with nothing but a published key id.  Both
now answer as values, and claims depth is bounded by the format at
`ACCESS_CLAIMS_MAX_DEPTH`.  The classification matters as much as the fix:
unreadable is `unauthenticated`, because a malformed envelope declares no
version, and routing it to `wrong-interface-version` put a person with a
damaged cookie behind a no-reauth 500.

**Fixed, documentation.**  `SECURITY.md` named a superseded Cloudflare line
and never named the reference runtime in scope.  `docs/threat_model.md` gained
a `Reachable inputs` section naming the four classes it had left implicit.

**Rejected, with evidence retained.**  The exchange's `JSON.parse` sites are
guarded, so the gate defect was an instance rather than a class.
`__proto__`-shaped claim keys are own properties from `JSON.parse`, not
prototype writes.  Grant targets are operation-scoped by construction, and
`sameOrganization` is a fresh-evidence guard, not a missing cross-organization
check.  The shared idempotency keyspace is deliberate — it is what lets a
second administrator retry the first's act (`docs/roster.md`).

**Verified with existing witnesses, no new tests needed.**  The state-machine
half was already correct: refresh supersedes before issuing inside a
synchronous critical section (`[A7] one handle cannot rotate twice under
concurrent refreshes`), activation accept binds atomically
(`[A16] accept binds the verified subject atomically`), payload substitution
is named misuse (`generative.test.ts`), and outbox delivery dedupes by id with
every handler guarded against terminal state (`an acceptance delivered after a
revoke does not resurrect it`, and the drain counts that pin a second drain at
zero).

**Deliberately unbounded:** claims breadth at the verifier.  The twins nest
identically at depth 5 across a 20x spread in bytes, and the festival twin
legitimately exceeds the host cookie budget, which the host refuses at
issuance.  A verifier-side size cap would refuse legitimate envelopes.

## Phase 3 — the four carried gaps are closed

Each was a claim Phase 1 located with no witness.  Every new test was
mutation-validated: the guard it covers was removed, the test was proven to
fail, and the guard restored.  A new test that passes on arrival proves
nothing until it has been shown to detect the absence.

- **The ops token gate.**  An absent or empty `OPS_TOKEN` now has a witness
  across the headers a caller can actually send.  Two refinements came out of
  writing it.  The empty-token branch is **unreachable** defence in depth, not
  a hole it closes: with an empty token the expected value is `"Bearer "`, and
  header values are trimmed in transit, so no caller can express the string
  that would match.  Phase 1's gap is therefore retracted as stated — no test
  can witness that branch's absence — and replaced by the externally visible
  claim, which does have teeth: removing the gate returns `200` to an
  unauthenticated export.
- **The demo and harness routes.**  A dispatcher-level 404 now covers every
  route with the flag absent, empty, or wrong.  The pre-existing predicate
  test passed unchanged while the gate was removed, which confirms Phase 1's
  reading exactly: a test on `demoRoutesEnabled` cannot see the dispatcher.
- **The ops surface as a closed allowlist.**  Internal coordinator paths —
  `/idp-config` above all — are refused under a valid token, and the sealed
  provider configuration appears in no relayed ops response but `/ops/export`,
  which the model records as its documented exception.
- **The crafted-snapshot outbox replay.**  The model's accepted residual risk
  now has a confirming test, and it is narrower than the model said.  Every
  outbox row restored as undelivered *is* redelivered — the claim stands — but
  delivery carries the outbox row id as the message id, that id survives the
  restore, and the receiving intake is claim-deduped on it, so nothing applies
  twice.  Removing the dedupe does not cause a double application either: the
  replays stop applying, are never marked delivered, and the outbox retries
  them forever.  Recognising the replay is what lets a redelivered message be
  retired.  `docs/threat_model.md` now says so.

## Phase 3 — in progress

The four carried gaps are closed (above). Since then:

- **Confirmed, medium — an envelope lifetime that is not a positive whole
  number removed expiry entirely.** `exp` is `issuedAt +
  envelopeLifetimeSeconds` and nothing validated the addend, so `NaN` or
  `Infinity` produced an `exp` that `now >= exp` is never true of: the
  envelope never expired, silently, with issuance succeeding. Short `exp` is
  the only thing bounding replay of a stolen bearer envelope, so the control
  failed open. Demonstrated in the in-memory engine — still valid in the year
  2096.
  The Cloudflare runtime was not affected, **by accident**: SQLite refuses to
  bind a non-finite number and JSON cannot carry `Infinity`, so a bad value
  laundered into immediate expiry. Two serialization quirks, not a control,
  which is why the guard went to the choke point every runtime passes through
  (`assembleAccessClaims`) rather than only to the boundary. The in-memory
  engine also refuses at construction, as a partial signing set already does.
  Severity is medium rather than high: no attacker path — a deployment or host
  supplies this value — and the affected engine is documented as not for
  production. The reachable surface was `Number(...)` used as a parser at
  `http/operation.ts`, which is the convention now in `AGENTS.md`, found by
  looking for violations of it.
- **Rejected — hostile `amr` from a provider ID token.** The Phase 2 carry.
  `exchange.ts` validates `amr` is an array of non-empty strings and
  `auth_time` a finite number before either is used, and the coordinator's
  HTTP boundary coerces `amr` again. Both are instances of the parse-boundary
  convention, already present. Evidence retained: it guards the claim that
  provider documents are hostile input.
- **Rejected — a crafted snapshot cannot resurrect an actor's standing**, and
  the threat model named the wrong field. Writing the witness for its own
  residual-risk sentence showed that a disable never revokes the handle: the
  handle stays live and *issuance* refuses, because the operation's roster
  projection says the actor is disabled. That projection is deliberately
  absent from the export — `state.ts` already said why — so a snapshot has no
  field in which to state standing, and un-revoking every refresh record
  attacks a gate that was never consulted. What a snapshot cannot express is
  a stronger boundary than what it is trusted to state; the model now says so.
  This closes Phase 1's second missing-boundary item.
- **Rejected — the service binding is not a second way past the operator
  bypass.** The organization coordinator skips its administrator check when
  its input carries `operator: true`, which is how the ops surface mints a
  first administrator for an organization with nobody to authorize it, and is
  why that route is token-gated. The binding surface cannot reach it: the
  runtime checks `adminOfOrganization` itself, the coordinator independently
  checks `isAdmin(byActorId)`, and `byActorId` comes from resolved evidence
  rather than caller input, so the relay body is built field by field and a
  smuggled `operator` is dropped. Mutation showed each layer is individually
  sufficient — removing the runtime check alone changes nothing because the
  coordinator refuses with the same detail, and spreading caller input alone
  changes nothing because the runtime refuses first. Both must fail together,
  and the retained test witnesses that combination. Route enumeration beyond
  the ops allowlist is otherwise complete: the dispatcher is a closed
  allowlist ending in a 404.
- **Verified — coordinator races and partial cross-coordinator workflows.**
  Already witnessed, and the witnesses were read rather than assumed: alarm
  retry when the peer is not ready (`operation.test.ts` `[A2]`), refresh
  refused after an unlink whose revocation has not drained
  (`runtime.test.ts` `[A13]`), subject-guard serialization under concurrency
  (`[A10]`), a stale projection refusing a disabled actor's fresh-evidence
  command, an unreachable coordinator answering `unavailable`, and directory
  ambiguity refusing rather than resolving the first organization — plus the
  seven portable races in `tests/concurrency.test.ts`. No gap found.
- **Verified — isolation by coordinator name.** A missing or empty `id` names
  a real but uninitialized Durable Object rather than failing, which is
  bounded (the route is token-gated and the token already permits exporting
  any id). The claim worth pinning was that a typo can never return another
  coordinator's rows, and it now has a test.
- **Execution verdict: no pod for the rest of Phase 3.** The isolation
  question is settled rather than open. There is one `vitest.config.ts` and
  one `wrangler.jsonc`, and workerd runs with Durable Object bindings and
  local persistence, so parallel workers contend on a shared runtime, which
  disjoint file allowlists do not fix. The mutation-validation rule compounds
  it: every new test for an existing guard must be run, broken, and run again,
  so lanes would serialize on that runtime constantly. Worktrees would isolate
  at the cost of a per-worktree install of workerd and esbuild. Phase 3 runs
  inline and serially; revisit only if a phase appears whose evidence does not
  need the harness.

## Phase 4 — source to consumer pin

Mostly a confirmation phase: the attack list was already witnessed, and the
reading found the witnesses rather than assuming them.

**Already covered, with names.** Tag-family selection (`[P6]` in
`tests/release-tools.test.ts`); a tag on the wrong commit or in the wrong
family failing closed; a lightweight tag refused; manifest disagreement
through the `set-version` cases; all four mirror-failure modes (Codeberg
fails and catches up, GitHub non-fatal, a failed NAS publication leaving the
local release intact and not advancing mirrors, a missing NAS remote failing
before anything changes); dirty-checkout behaviour, strict in CI and a warning
locally (`tests/ci-run.test.ts`); CI credential scrubbing; and the clean build
reproducing tracked `dist/`, which `bin/check-dist` asserted repeatedly during
this campaign — every `src/` change this session was caught as stale until
rebuilt. `bin/release` additionally refuses an existing tag and a dirty tree
before it changes anything.

**The dependency posture is the strongest part, and worth stating plainly.**
Neither published package carries third-party runtime code: the root's
`dependencies` are empty and the Cloudflare package's sole dependency is the
workspace sibling. The whole lockfile is build and test tooling that never
ships, so reachability of a third-party advisory into a consumer's runtime is
zero by construction rather than by review. Install scripts are deny-by-default
through an explicit `allowBuilds` allowlist — `esbuild` and `workerd` admitted
with a written reason, `sharp` explicitly refused. CI installs
`--frozen-lockfile`, pins pnpm to `11.21.0`, and pins the one downloaded binary
by version *and* SHA-256.

**Findings, both low and both procedural rather than exploitable.**

- *Workflow actions are pinned by mutable tag* (`actions/checkout@v5`,
  `pnpm/action-setup@v4`, `actions/setup-node@v5`) rather than by commit. The
  blast radius is small and should be stated rather than inflated: the
  workflow declares `permissions: contents: read`, references no secrets, and
  CI is not the release authority — `bin/release` runs the gates locally and
  publishes from there, and the mirror workflow is manual-dispatch only. So a
  compromised action could tamper with an advisory signal, not with what
  ships. SHA pinning is still the cheap improvement.
- *Nothing in the artifact records that a release passed its gate.*
  `bin/verify`'s marker is deliberately local — its own comment says "never a
  release" — and lives in `.git/`, so it is not published. `bin/release
  --no-verify` therefore produces a release indistinguishable from a verified
  one. This is the same family as unsigned tags: release assurance here is
  policy, not evidence. It belongs with
  [`assurance.md`](assurance.md) Decision 4 rather than as a separate
  decision.

**Deliberately not recommended:** adding a `packageManager` field. It is the
standard advice, and it is wrong here — `packageManager` is what corepack
reads, and `AGENTS.md` forbids installing pnpm through corepack. The flake
pins pnpm locally and the workflow pins it in CI; a `packageManager` field
would be inert at best and an invitation to the forbidden path at worst.

**Still owed:** `pnpm audit`. It needs network access, which the campaign's
rules of engagement require Rick to authorize explicitly. Until then the
advisory question is open — though reachability above bounds what any advisory
can mean for a consumer.

## Carried decision — cap the outbox drain per invocation

From the amplification review ([`docs/performance.md`](../docs/performance.md)
§ Amplification review), which is otherwise clean: every other growth path is
either bounded by construction or linear in something the tenant owns and
meant to be.

The drain iterates every pending message with no `LIMIT`, and the organization
fans `roster` and `actor-disabled` out to every operation it has an invitation
for, one coordinator subrequest each. A single invocation's subrequests are
therefore the sum over pending messages of their target counts, against a
platform cap. Exceeding it is a livelock, not a slowdown: the undelivered
messages stay pending, the alarm reschedules a second later because `pending >
0`, and the next invocation attempts the same oversized batch forever.

No deployment is near it — it needs many participating operations or a large
backlog — and it is a cliff rather than a curve, which is why it is written
down rather than left to be discovered.

The mechanism to fix it already exists: `drain` returns `{ delivered, pending }`
and the alarm continues while anything is pending, so a bounded number of
messages per invocation needs only a cap, not a new mechanism. **Decision
needed:** the cap. It is a deployment fact rather than a derivable constant —
the subrequest limit differs by Workers plan — and it trades fan-out latency
for recoverability, so it wants the same treatment the claims-depth bound got:
a number with a stated reason, documented where the format documents its
bounds. **Done when:** the drain delivers at most a stated number of
coordinator subrequests per invocation, with a test that a backlog larger than
the cap drains across invocations rather than failing, or the risk is recorded
as accepted with the operator owning the backlog.

## Carried decision — make the gate the only path to the value

Not a finding, and not a cleanup: the structural remedy the findings point at,
to be adjudicated in Phase 6 rather than taken mid-campaign.

The envelope version gate is shared by three callers, and the obligation to
run it before reading a claim is **convention**. `organization.ts` read
`.claims` one statement before the gate, which is how a shared control became
a defect in one caller and not the others. The restore gap has the same shape:
the invariant lives in a function, and nothing stops a caller from working
around it.

The structural answer is to make the gate the only path to the value — have it
return parsed claims rather than `Failure | undefined`, so a caller cannot hold
a claim it has not gated. That would have made the `organization.ts` line
impossible rather than merely wrong, which is the difference between
preventing an instance and catching one.

It is a deep-module change to the portable core and consumer-visible, so it is
a decision, not a tidy-up. Weigh it against the parse-boundary convention now
in `AGENTS.md`, which addresses the same class more cheaply and without a
surface change; the convention may be sufficient, and this plan should not
assume the larger change is the right one.

**Decide when:** Phase 6, with the full finding set in view. **Done when:**
either the gate returns the parsed value and the three callers take it that
way, or the convention is recorded as the chosen remedy and this decision is
removed.

## Next action

The rest of Phase 3, as specified above: provider documents treated as
hostile, route enumeration beyond the ops allowlist, coordinator races and
partial cross-coordinator workflows, hostile restore beyond the outbox row,
and the complexity and amplification review.

One hypothesis carries over from Phase 2: `operation.ts` canonicalizes
`auth.amr`, which arrives from the provider's ID token.  `canonicalJson` is
general and unbounded by design — the depth bound added in Phase 2 is a claims
bound in the portable gate, not a serializer bound — so a hostile or careless
provider's `amr` shape belongs to the hostile-provider-document work.

On execution: the four gaps ran inline, correctly — they were located, bounded,
and mechanical once found.  The remainder has durable sub-areas (the provider
exchange, the route and ops surface, coordinator state and restore) and is a
genuine pod candidate, but the isolation question must be settled first and the
answer is not obvious: there is one `vitest.config.ts` and one
`wrangler.jsonc`, and workerd runs with Durable Object bindings and local
persistence, so two workers running suites in this checkout contend on a
shared runtime rather than on files.  Disjoint file allowlists do not solve
that; worktrees would, at the cost of a per-worktree install of workerd and
esbuild.  Decide at intake with that cost measured, not assumed.

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
