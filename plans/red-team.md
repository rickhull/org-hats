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

## Execution

Phase 1 ran as the threshold-case `moshpit` pod and returned *earned its
keep*; Phase 2 onward ran inline, and Phase 3 settled the question for good
with reasons (below).  Both verdicts are recorded where they belong — the
skill itself took the two lessons this campaign produced.  The remaining work
is two decisions and needs no fan-out.

The rules that still bind: a confirmed critical or high finding stops the
phase and goes to Rick before the campaign continues, and remediation follows
the repository's bugfix rule — red first, then the fix, in one commit-sized
handoff.

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

## Phase 3 — complete

Four carried gaps closed first, each a claim Phase 1 located with no witness.  Every new test was
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

Since then:

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

**`pnpm audit`, run 2026-11-02 with Rick's authorization.** 5 high, 4
moderate, 0 critical, across exactly two modules — and the line that matters
most is `"dependencies": 0` against 160 devDependencies.

- `undici@7.29.1` (eight advisories, needs ≥7.30.1), reached through
  `miniflare` from both `@cloudflare/vitest-plugin` and `wrangler`.
- `zod@4.6.5` (one high, needs ≥4.6.6), reached through
  `@cloudflare/vitest-plugin`.

Per this plan's rule, an advisory is not closed because an upgrade exists.
Recorded instead:

- **Reachability into a consumer's runtime: none.** Both are dev-only
  transitives of the Cloudflare package, and nothing third-party ships in
  either published artifact.
- **Reachability into our own build and test: present, not adversarial.**
  `undici` is miniflare's HTTP client for the local test runtime and `zod`
  validates the vitest plugin's config. The suites run against a local
  workerd with no outbound network — the exchange tests supply the provider
  in-process — and CI's one download uses `curl` against a version-pinned,
  SHA-256-verified URL rather than undici.
- **The fix is not ours to take.** `miniflare` pins `undici` at exactly
  `7.29.1`, and the vitest plugin resolves `zod` itself; neither is a range we
  can satisfy. A `pnpm.overrides` entry would run miniflare against an undici
  it never tested, to fix a denial of service we cannot reach — worse than the
  advisory.
- **Disposition: accepted, with a re-check trigger.** It clears on an ordinary
  dependency refresh once Cloudflare bumps `miniflare` and
  `@cloudflare/vitest-plugin`. Re-run `pnpm audit` with that refresh rather
  than on a schedule; the gap is patch-level in both cases.

## Phase 5 — compromise tabletop

Nine scenarios walked as text; nothing executed against a deployment. The
runbook was in good shape — it already states in three places that a
signing-key rotation does not revoke refresh handles, which is the exit
criterion the plan names explicitly, and no step relied on a credential the
scenario had already assumed compromised.

Three gaps, all now closed in [`key_compromise.md`](../docs/key_compromise.md).

- **The ops token's parallel case was missing, and it is the sharpest
  finding.** The runbook was careful that key rotation is not refresh
  revocation, but never said that rotating `OPS_TOKEN` does not undo what the
  token wrote. It does not: bootstrap inserts organization administrators and
  never removes them, and inserts principal links for `(provider, subject)`
  pairs that do not yet exist — a conflicting re-point is refused, but a fresh
  subject bound to an administrator's actor is not. The holder can then
  authenticate through the real provider, as an administrator, with no token
  at all, and no ops route retires an administrator. Containment is a hunt
  (`unlink-principal`, `revoke-activation`, `retire-administrator` under a
  surviving administrator's fresh evidence, restore as the hammer), not only a
  rotation. Generalised into a first principle, since the class is what
  matters: *rotation contains future use, not past effects.*
- **Malicious restore had no scenario**, only a passing mention as a remedy
  for something else — one of the nine the plan names. It has a section now,
  and the audit row this campaign added is its detection evidence: written
  after the tables so the snapshot cannot overwrite the trace of the act that
  applied it. The section states what a snapshot can assert (its own columns),
  what is bounded (outbox replay, recognised by row id), and what it cannot
  assert at all (an actor's standing, since the projection is not exportable).
- **Two scenarios had no verification step**, against the plan's exit
  criterion that every asset has one: the ops token now verifies that the old
  token is refused and the new accepted on a route that changes nothing, and
  the envelope/refresh section states the honest limit — an envelope cannot be
  revoked, so verification is confirming the window you are accepting and when
  it closes.

Detection throughout now points at `GET /ops/audit` rather than a full export,
with the caveat that attribution is a claim: a token holder can send any
operator identity, so the facts are evidence and the actor column is a hint.
That is the same honesty `docs/assurance.md` carries about attribution.

## Decided — the outbox drain is capped

Taken: expand fan-out at enqueue, cap the drain at 25 rows per invocation,
prune delivered rows after seven days. `OUTBOX_DRAIN_LIMIT` and
`OUTBOX_DELIVERED_RETENTION_SECONDS` are constants in `state.ts` with their
reasons beside them, not configuration — the campaign already fixed one defect
caused by an unvalidated numeric config.

Why expansion rather than a subrequest budget: one row becomes one subrequest,
so the row cap *is* the subrequest bound with no arithmetic and no "one
message too wide to ever deliver" edge. It also deletes `FAN_OUT_KINDS` and
the `"*"` sentinel, stops a partial fan-out failure forcing redelivery to the
targets that already succeeded, and matches the portable engine, which only
ever addressed one target per message.

Two behaviour changes, both documented in `docs/cloudflare.md` § The outbox:
an operation joining after a fan-out is enqueued no longer receives that
message — reconciliation is the backstop, and an unlink that never arrived is
still refused by refresh's live organization read, which an existing `[A13]`
test pins — and an organization with no participating operation enqueues
nothing rather than one undeliverable row.

Pruning came with it because the two interact: the outbox is append-only, so
one row per target multiplies what an event retains. Pruning a *delivered*
row is safe in a way pruning `audit` or `claims` is not — it is spent, it is
not evidence, and it is not what makes a retry safe — and `state.ts` says so
to head off the symmetry argument.

Two implementation notes worth keeping. The cap belongs to the drain and not
to reads: putting it in the shared `outboxRows()` capped the operator's
`/outbox` read and the status count too, under-reporting a backlog at the one
moment it matters, so the drain takes `outboxBatch()` instead. And the
operation coordinator got the same cap and pruning even though it never fanned
out — one subrequest per row is still unbounded in the number of rows.

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

## Phase 6 — adjudication

Re-run against the final tree. `pnpm verify` passes on the complete change
set: the consumer fence, the portable suites, and 108 Cloudflare tests. The
diff review found no secret, no real roster, no exploit transcript, and no
security guarantee the tree does not hold — the only identifier added is
`nia@cedar.example`, a reserved-TLD name matching an existing synthetic actor.

**Five confirmed defects, each fixed test-first with a reproducing witness,
all owned by the library.**

1. The shared envelope version gate threw instead of failing as a value, on
   three callers. `[E4]` tests in `tests/access.test.ts`,
   `tests/context.test.ts`, `tests/engine.test.ts`.
2. An unreadable envelope answered `wrong-interface-version`, which the
   reference host maps to a no-reauth 500 — a damaged cookie became an
   unrecoverable loop. Now `unauthenticated`.
3. `canonicalJson` recursed on claims the verifier had not verified, reachable
   with a published key id. Bounded by `ACCESS_CLAIMS_MAX_DEPTH`, with the
   twins' depth pinned so the bound fails at the issuer rather than at a
   verifier.
4. A lifetime that is not a positive whole number removed expiry entirely.
   Refused at claims assembly, at engine construction, and at the Cloudflare
   boundary.
5. A restore recorded nothing at all. Both coordinators now write that row
   after the tables, so the act cannot erase its own trace.

**Nine hypotheses rejected, evidence retained** where it guards a plausible
regression: the exchange's parse sites (the gate defect was an instance, not a
class), `__proto__`-shaped claim keys, cross-organization grant targets, the
shared idempotency keyspace, hostile provider `amr`, the service binding
reaching the operator bypass, and a crafted snapshot resurrecting an actor's
standing. Two were **retractions of our own claims**: the concurrent
subject-guard "gap" had a witness all along, and the empty-`OPS_TOKEN` branch
cannot be witnessed at all because header values are trimmed in transit.

**Residual risks, consciously accepted and recorded** — distinct from the
above, and none of them defects: claims breadth uncapped at the verifier;
a bearer envelope replayable within its lifetime with no revocation; no
tamper-evident audit log; the ops token all-or-nothing with attribution that
is a claim rather than proof; unbounded retention of audit rows and
idempotency claims; no erasure path for personal data; tags that are names
rather than signatures, and no artifact-level evidence that a release passed
its gate; workflow actions pinned by mutable tag; the dev-only
`undici`/`zod` advisories whose fix is pinned upstream; and inter-coordinator
relay bodies trusted structurally on platform isolation alone.

**No new invariant ids**, as this plan's *Specification placement* requires.
The campaign's durable properties went beside the boundaries they govern:
E2 gained the claims depth bound, E4 that closed means *as a value* and that
unreadable and unsupported are different answers, E7 that a lifetime which
cannot bound expiry is refused.

## Next action

Two decisions, both recorded above with their done-whens, and both for Rick:
the **outbox drain cap** and whether to make the **gate the only path to the
value**. They are the last campaign work; everything else has landed.

This plan is retired when those two are settled — not before, because a plan
with an open decision is the one thing `plans/README.md` says a plan is for.
The compliance decisions live separately in [`assurance.md`](assurance.md) and
do not block this one.

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

Settled: no such family.  The campaign produced three recurring practices —
a named parser at every untrusted boundary, an audit row written after the
state it describes, and a new test for an existing guard proven by removing
the guard — and all three are conventions in `AGENTS.md` rather than
invariants, because none has a mechanical witness.  The durable properties
they protect are already E2, E4, and E7.
