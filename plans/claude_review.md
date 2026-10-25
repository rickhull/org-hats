# Architecture and type-soundness review — slice 1 (`src/`)

**Status (2026-10-25): realized.** P0-P3 landed; root `v2.0.0` and Cloudflare
`cloudflare-v0.3.1` are released. The remaining unlanded gap is the
untypechecked root test suite, now `plans/typechecked_tests.md`. This file is
retained as the review record; remove it with the next plans cleanup.

The original pass was by the main agent (not a reader report), 2026-10-25,
alongside `plans/code_review.md`'s findings ledger (kept separate and
untouched — this file holds its own action items rather than folding into
that one). Where that plan catalogs *what* is wrong, this one asks *why the
design let it happen* and *what would make the class of bug unreachable*
rather than merely patched. It was grounded directly in `src/model.ts`,
`src/authority/engine.ts`, `src/authority/types.ts`, `src/access/verify.ts`,
`src/policy.ts`, `src/contract.ts`, and cross-checked against
`packages/cloudflare/src/operation.ts` and
`packages/cloudflare/src/exchange.ts`.

## The one redesign that would have prevented most of R1

At review time, `model.ts` defined two pure functions whose entire job was
to prevent the ledger's correctness findings, and neither was called from
either runtime's write path:

- `transitionParticipation` (`model.ts:128`) already refused `activate`
  unless `current.status === "accepted"` — exactly the guard that would
  have caught "acceptance delivered after revoke." A grep at review time
  returned one hit: the definition. `engine.ts`'s import list
  (`engine.ts:37-44`) pulled `invariantProblems`, `readReach`, and
  `wearableGrants` from `model.ts`, but not this function.
- `invariantProblems` (`model.ts:337`) is a complete, exported snapshot
  validator, used only by tests. Nothing on the `grant-hat` write path
  calls it or a narrower form of it, in either runtime.

Both runtimes independently hand-rolled the same write paths instead of
routing through these:

- **Acceptance-after-revoke.** In-memory: `engine.ts:340-342` sets
  `status: "active"` via a bare `.map`, guarded only by the invitation's
  status, never the participation's own prior status. Cloudflare:
  `operation.ts:550-554` runs `UPDATE participations SET status =
  'active' ... WHERE organization_id = ?` with no `WHERE status !=
  'revoked'` guard — and no `CHECK` constraint can express a transition,
  only "is one of four strings."
- **`grant-hat`'s missing actor/participation check.** `engine.ts:765-807`
  and `operation.ts:621-677` validate the identical subset — role, target
  existence, exactly-one-target — and omit the identical thing: that the
  actor exists and the organization participates. Not two bugs that
  happen to match; one design gap (validation lives in pure functions
  that are optional to call) expressed twice because each runtime
  reimplements the write path from scratch.

**The fix shape this argues for is not "patch both runtimes
separately."** Route every participation mutation through *read current
state → call `transitionParticipation` → write only on `ok: true`*. For
Cloudflare that's a `SELECT` before the `UPDATE` in the same transaction,
deciding by the same predicate the TS function encodes (kept adjacent and
tested against it, since the runtimes can't literally share the function
across a `SELECT`/`UPDATE` boundary). For `grant-hat`'s actor check, the
two runtimes differ for a structural reason: Cloudflare's operation
coordinator has no local actor table — actors live in a separate Durable
Object — so this needs a designed cross-DO seam (model it as a
`VerifiedActor` token only a successful lookup can produce, so the
grant-insert function's signature requires the token as a precondition).
In-memory has no such excuse — `orgs` is reachable from the same closure
`grant-hat`'s handler runs in — so that half is a plain, fixable-now gap.

This is also the mechanical argument for `code_review.md`'s R4
engine-coordinator split, not just a readability one: an 890-line closure
is exactly the kind of place a hand-rolled duplicate drifts from the pure
function sitting two imports away that was supposed to be canonical.

### Action: P0 — shared transition kernel (precondition for `code_review.md` R1)

- [x] Route every participation-status mutation through *read current
  state → call `transitionParticipation` → write only on `ok: true`*.
  Landed better than specified: Cloudflare calls the **same function**,
  not an adjacent predicate — the `SELECT` supplies `current`, and
  `transitionParticipation` is pure and synchronous so it runs inside
  `transactionSync`. `model.ts` gained `applyParticipationEvent` as the
  list-level kernel the in-memory engine routes through. Seven write
  paths now route (in-memory invite, both revoke halves, outbox
  acceptance; Cloudflare invite, intake acceptance, intake revocation,
  revokeParticipation). Two runtime divergences surfaced and were settled
  in the model's favour: Cloudflare allowed re-invite after revoke
  (revoke is terminal, so it no longer does), and in-memory silently
  succeeded when revoking a non-participant (now `denied`, matching
  Cloudflare). Revoking twice stays a successful no-change receipt —
  idempotency is the adapter's policy, the no-un-revoke rule is the
  model's.
- [x] Design the cross-DO seam `grant-hat` needs to validate the actor.
  Resolved **not** as an RPC and not as a `VerifiedActor` token. A
  synchronous cross-object read cannot be atomic — `transactionSync` has
  no `await` — so it would have bought a check-then-act window at the
  price of a second object's availability on the write path. Instead the
  operation holds a projection of each participating organization's
  roster (`org_actors`: actor id and disabled only), pushed on change and
  reconciled on an interval, so the check is a local read inside the same
  transaction as the insert. Both runtimes now refuse a grant to an
  unknown actor (`invalid-command`) or a non-participating organization
  (`denied`), pinned by the new `OH-CMD-03` conformance case, which passes
  against the real coordinators in workerd.

  This also closed a wider hole the review did not name: the operation
  coordinator had no actors table at all, so `modelSnapshot` fabricated
  `actors: [{ organizationId, actorId }]` for whoever was asking, making
  `wearableGrants`' actor-existence and `disabled` clauses structurally
  vacuous in the deployed runtime. Refresh in particular rested entirely
  on the `actor-disabled` outbox message arriving. The standing rule is
  now recorded in `docs/authority_redesign.md` § State ownership: no
  synchronous cross-coordinator read on a write path; a fact a decision
  needs is projected into the coordinator that must decide.

## Type-system leverage

### Action: P1 — type-safety work (2.0.0)

1. **Brand the id types — highest leverage, single change.**
   `contract.ts:20-24` declares `OrganizationId`, `ActorId`,
   `OperationId`, `SiteId`, `TeamId` as plain `string`. They are mutually
   interchangeable at the type level. Nearly every hot function in
   `model.ts` and `engine.ts` takes three to five of these positionally —
   `wearableGrants(snapshot, organizationId, actorId, operationId)`,
   `decide(snapshot, bundle, organizationId, actorId, operationId,
   action, target)` — and an argument-order slip compiles clean today.
   Decided and landed for 2.0.0, scoped to internal domain types only —
   not the public command/evidence surface. `Unbranded<T>` marks the
   boundary shapes; each runtime converts at its own seam.

2. **`GrantTarget` should be the command's target field, not two
   optionals.** `model.ts` already has the right shape —
   `GrantTarget = {kind:"team",teamId} | {kind:"site",siteId}` — but
   nothing constructing a grant command uses it:
   `authority/types.ts:138-148`'s `grant-hat` variant carries `teamId?:
   TeamId; siteId?: SiteId` as two independent optionals, and
   `packages/cloudflare/operation.ts`'s `GrantInput`/`GrantCommand`
   repeat the same two-optional shape independently. This is exactly why
   both runtimes carry matching manual checks — `engine.ts:778-783`
   ("reaches one target" / "needs a target") and `operation.ts:641-643`
   ("needs exactly one target"). Using `target: GrantTarget` directly
   makes both checks unreachable by construction and removes the second
   copy of the shape that could otherwise drift from the first.

3. **`actionsOf`'s documented contract is erased three lines later.**
   `policy.ts:92-96` is explicit: `undefined` means "the title is not in
   the bundle... callers treat that as a validation problem, never as
   'no actions'." `model.ts:219`'s `hatOf` immediately does
   `actionsOf(bundle, grant.role) ?? []`, collapsing exactly the
   distinction the comment insists on — an unknown role becomes a
   wearable-but-powerless hat instead of a visible inconsistency. A
   `readonly string[] | undefined` return is too easy to erase with `??`;
   a `{found: true, actions} | {found: false}` result can't be
   silently coalesced the same way.

4. **`TargetRef` is declared twice, independently.** `model.ts:159-162`
   and `access/types.ts:24-27` hand-write the identical three-variant
   union. They agree today; nothing enforces that they keep agreeing if
   one gains a variant. `contract.ts` is already the shared-vocabulary
   module for this kind of cross-cutting shape — move it there once.

5. **Silent config fallbacks mask missing deployment configuration.**
   `engine.ts:423`'s `adminRoles[claims.operationId] ?? ["admin"]` and
   `resolvePrincipal`'s `orgAdmins[...] ?? []` both fall back silently
   when a deployment omits a key, rather than making "no admin declared"
   a distinct, visible state. Making `InMemoryAuthorityConfig`'s
   `adminRoles` required, or a sum type (`{kind:"declared", roles} |
   {kind:"none"}`), turns a forgotten configuration into a construction
   failure instead of a silently-applied hardcoded title.

- [x] **Brand the id types** (item 1). Landed with one change of approach:
  the ~500 literal sites the worked plan anticipated were cut to a handful
  by converting at boundaries instead of at every literal. `Unbranded<T>`
  (a mapped type derived from the branded types, so it cannot drift) marks
  the shape hand-written or decoded data has *before* it enters the domain:
  the twins convert once through `twin()`, the Cloudflare coordinators
  through a new shared row decoder (`packages/cloudflare/src/row.ts`,
  replacing 76 hand-rolled `String(row[...])` calls), and each runtime at
  its command-handler seam. Fixture coherence is what `invariantProblems`
  checks; the brand's job is the function boundaries. Two latent `?? ""`
  fallbacks surfaced and were removed rather than cast away.
- [x] **`GrantTarget` as the command's target field** (item 2), in both
  `authority/types.ts` and Cloudflare's `operation.ts`. Landed for 2.0.0:
  `grant-hat` carries `target: Unbranded<GrantTarget>`, `HatSummary` carries
  the same, and both runtimes' duplicate "exactly one target" checks are
  unreachable by construction. The version call is the major break recorded
  in P3.
- [x] **Tighten `actionsOf`'s return contract** (item 3). Returns
  `{found: true, actions} | {found: false}`; all ten callers decide
  explicitly, where six previously wrote `?? []`. An unknown role at
  decision time is now a distinct `policy-inconsistent` denial, and
  issuance/context fail `unavailable` naming the role rather than issuing a
  wearable-but-powerless hat. Also extracted `firstByRank`, so the ranked
  selection the model owns is written once instead of twice in `model.ts`.
- [x] **Move `TargetRef` into `contract.ts`** (item 4), re-exported by both
  `model.ts` and `access/types.ts`.
- [x] **Make admin-role config explicit, not fallback-default** (item 5).
  The `?? ["admin"]` is gone: an operation with no declared admin role has
  no administering role title, which is a visible denial. This also aligns
  the runtimes — Cloudflare's coordinator already read an undeclared set as
  empty. `orgAdmins[...] ?? []` was left alone; an empty list is already
  the correct reading there.

## Action: P2 — exchange bug (urgent, blocks real provider login)

Found by Quartermaster 2026-10-25 while preparing a provider bootstrap,
confirmed by reading `packages/cloudflare/src/exchange.ts`: `Discovery`
(`exchange.ts:44-47`) only carries `authorizationEndpoint` and
`jwksUri`; `discoveryOf` (`exchange.ts:67-78`) never reads
`token_endpoint` from the discovery document; the token POST
(`exchange.ts:265`) fetches `discovery.authorizationEndpoint` — the
browser-redirect endpoint, not the token endpoint. The exchange's own
test fixture masked this by pointing `authorization_endpoint` at the
token URL. Acknowledged back to Quartermaster in
`notes/from-org-hats.md`, 2026-10-25.

- [x] Add `tokenEndpoint` to `Discovery`, parse `token_endpoint` from the
  discovery document in `discoveryOf`. Landed: `authorizationEndpoint` is
  dropped rather than kept — nothing reads it once the POST is corrected,
  since the browser redirect is the host's.
- [x] POST the code exchange to `discovery.tokenEndpoint`, not
  `authorizationEndpoint`.
- [x] Fix the test fixture to use distinct authorization/token URLs, and
  assert the token POST lands on the token endpoint specifically. Verified
  by reintroducing the defect: all five exchange cases fail with "the
  provider refused the code (404)", the real-provider shape.
- [x] Landed in source. The next `cloudflare-v*` tag carries it;
  `cloudflare-v0.1.0` was not safe for real-provider login.

## Action: P3 — the 2.0.0 interface break (landed with P1 item 2)

`grant-hat`'s command now carries `target: GrantTarget` instead of two
independent optionals, so `AuthorityCommand` changes shape. That is a
breaking interface, not an additive one: `AUTHORITY_INTERFACE_VERSION`
moves from 1 to 2 and the release is a major (`2.0.0`). A 1.x caller
reaching a 2.x runtime gets `wrong-interface-version` before any command
is interpreted, rather than a shape error halfway through one.

The break is deliberately cheap for sessions. `verify` gates reading on
the **envelope version pair** — `format`, the envelope's `v`, and the
claims' own `v` — and never on the claims' `interfaceVersion`, which is
issuer provenance. An envelope signed under interface 1 therefore keeps
verifying under a 2.x runtime, and no live session drops because the call
vocabulary changed. `ACCESS_ENVELOPE_VERSION` stays 1: the meaning of the
claims did not move. Checking the claims' `v` also closes the hole where a
signature-valid `v: 2` payload inside a `v: 1` envelope was read as v1.

- [x] Bump `AUTHORITY_INTERFACE_VERSION` to 2. The runtime call surfaces
  continue to refuse a caller whose declared version is not theirs.
- [x] Gate `verify` on the claims' `v` as well as the envelope's, and stop
  comparing `interfaceVersion` with the verifier's.
- [x] Update the access vectors and `OH-ACCESS-04`: the version pair fails
  closed, and a differently-issued envelope is provenance, not a version
  failure.
- [x] The release itself is `plans/v2_release.md`: migration note, demo
  smoke, `v2.0.0` tag, and the post-tag relay. Root `v2.0.0` and Cloudflare
  `v0.3.1` are cut; Quartermaster acceptance remains in that plan.

## Found while landing: `tests/` is not typechecked

`tsconfig.json` includes only `src/**/*.ts`, and `node --test` strips types
without checking them, so no tool checks the suites or `examples/`. This is
how a fixture can keep sending a shape the interface no longer accepts and
fail only at runtime — which happened when `grant-hat` moved to a single
`target`: the compiler was silent and six tests died with
`Cannot read properties of undefined`.

A `tsconfig.tests.json` extending the build config over `src`, `tests`, and
`examples` reports **173 errors** across ten files. They are not stale
fixtures; they are test-ergonomic patterns that never had to typecheck —
narrowing `Failed | Verified` by reaching for `.failure`, passing claims
where `JsonValue` is wanted, fixtures that now need `Unbranded`. Worth doing
and worth doing deliberately, as its own pass; not folded into this one.

The published-surface fence in `bin/check` (`tests/consumer-surface.ts`)
covers the shapes a *consumer* builds, which is the part that would
otherwise break silently for Quartermaster.

## Sequencing

P0 and P2 are both correctness-blocking and independent of each other —
either can start first. P1 is type-safety hardening riding the same
2.0.0 release as P3; all five items, including id-branding, can proceed in
parallel with the others. Id-branding and
P0 both touch `engine.ts`'s command handler and `operation.ts`'s
coordinators — worth sequencing P0 first in those two files so the
transition-kernel routing lands on unbranded types, then id-branding's
compiler-driven sweep catches the new call sites too, rather than
branding twice.

## Remaining

The typechecked-test gap described above is `plans/typechecked_tests.md`. All
other actions in this review are landed.
