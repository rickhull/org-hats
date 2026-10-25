# Architecture and type-soundness review — slice 1 (`src/`)

**Status:** independent pass by the main agent (not a reader report),
2026-10-25, alongside `plans/code_review.md`'s findings ledger (kept
separate and untouched — this file holds its own action items rather
than folding into that one). Where that plan catalogs *what* is wrong,
this one asks *why the design let it happen* and *what would make the
class of bug unreachable* rather than merely patched. Grounded directly
in `src/model.ts`, `src/authority/engine.ts`, `src/authority/types.ts`,
`src/access/verify.ts`, `src/policy.ts`, `src/contract.ts`, and
cross-checked against `packages/cloudflare/src/operation.ts` and
`packages/cloudflare/src/exchange.ts`.

## The one redesign that would have prevented most of R1

`model.ts` defines two pure functions whose entire job is to prevent the
ledger's correctness findings, and neither is called from either runtime's
write path:

- `transitionParticipation` (`model.ts:128`) already refuses `activate`
  unless `current.status === "accepted"` — exactly the guard that would
  have caught "acceptance delivered after revoke." `grep -rn
  "transitionParticipation" src packages` returns one hit: the
  definition. `engine.ts`'s import list (`engine.ts:37-44`) pulls
  `invariantProblems`, `readReach`, `wearableGrants` from `model.ts` but
  not this function.
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

- [ ] Route every participation-status mutation through *read current
  state → call `transitionParticipation` → write only on `ok: true`* —
  in-memory directly, Cloudflare via a `SELECT` before the `UPDATE` in
  the same transaction, decided by the same predicate the TS function
  encodes. Land the acceptance-after-revoke fix through this, not as an
  independent patch per runtime.
- [ ] Design the cross-DO seam `grant-hat` needs to validate the actor:
  Cloudflare's operation coordinator has no local actor table (actors
  live in the organization Durable Object), so this isn't a missing
  `if`, it's a missing RPC. Model it as a `VerifiedActor` token only a
  successful cross-binding lookup can produce; land the in-memory half
  (actor validation reachable in the same closure) independently now.

## Type-system leverage

### Action: P1 — type-safety work (1.3.0)

1. **Brand the id types — highest leverage, single change.**
   `contract.ts:20-24` declares `OrganizationId`, `ActorId`,
   `OperationId`, `SiteId`, `TeamId` as plain `string`. They are mutually
   interchangeable at the type level. Nearly every hot function in
   `model.ts` and `engine.ts` takes three to five of these positionally —
   `wearableGrants(snapshot, organizationId, actorId, operationId)`,
   `decide(snapshot, bundle, organizationId, actorId, operationId,
   action, target)` — and an argument-order slip compiles clean today.
   Decided: do this for 1.3.0, scoped to internal domain types only (see
   the worked plan below) — not the public command/evidence surface.

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

- [ ] **Brand the id types** (item 1). Worked plan below.
- [ ] **`GrantTarget` as the command's target field** (item 2), in both
  `authority/types.ts` and Cloudflare's `operation.ts`.
- [ ] **Tighten `actionsOf`'s return contract** (item 3) so `hatOf` can't
  silently coalesce "unknown role" into "no actions."
- [ ] **Move `TargetRef` into `contract.ts`** (item 4), imported by both
  `model.ts` and `access/types.ts`.
- [ ] **Make admin-role/org-admin config explicit, not fallback-default**
  (item 5) on `InMemoryAuthorityConfig`.

### Worked plan: id branding (decided — internal types only)

`contract.ts:13-19`'s comment currently states the opposite of this
plan: "The named aliases are documentation, not brands... they are
plain strings so data stays open and inspectable." That claim about
runtime representation stays true — a branded type is `string & {tag}`,
erased at compile time, so `JSON.stringify`/`parse` see no difference
and the wire format never changes. Only the comment's literal "not
brands" goes false; it gets rewritten, not silently contradicted.

Scoping to the public surface (`AuthorityCommand`, `PrincipalEvidence`,
`AuthorityContext`) would make this a consumer-facing interface change
needing re-review with Quartermaster under `AGENTS.md`'s rule, for zero
wire-format benefit. Scoping instead to **`model.ts`'s internal domain
types** (`Organization`, `Actor`, `Grant`, `Participation`, `Snapshot`)
and the id-taking functions (`decide`, `wearableGrants`, `selectWornHat`,
`grantReaches`, `readReach`, `invariantProblems`), mirrored in
`OpState`/`OrgState` and D1 row-mapping in `packages/cloudflare`,
protects exactly where every argument-order risk actually lives, touches
no consumer-facing type, and needs no re-review.

- [ ] **Step 1 — brand mechanism in `contract.ts`.** Replace the five
  plain aliases:
  ```ts
  declare const brand: unique symbol;
  type Branded<B extends string> = string & { readonly [brand]: B };
  export type OrganizationId = Branded<"OrganizationId">;
  export type ActorId = Branded<"ActorId">;
  export type OperationId = Branded<"OperationId">;
  export type SiteId = Branded<"SiteId">;
  export type TeamId = Branded<"TeamId">;
  ```
  Rewrite the comment above them: runtime representation is still a
  plain, opaque, caller-supplied string (JSON-transparent); the
  compile-time brand only stops a function expecting one from silently
  accepting another.
- [ ] **Step 2 — one constructor per type**, also in `contract.ts`:
  ```ts
  export const organizationId = (raw: string): OrganizationId => raw as OrganizationId;
  // actorId, operationId, siteId, teamId, same shape
  ```
- [ ] **Step 3 — cast at the command-handler seam**, once per runtime.
  In-memory: `engine.ts`'s `command()`, immediately after
  `resolvePrincipal`, convert `inputCommand`'s id fields before they
  reach any `model.ts` call. Cloudflare: the equivalent point in each
  coordinator's command entry, plus the 22 `row["organization_id"]`-style
  D1 row-mapping sites (`organizationId(String(row["organization_id"]))`).
  The public command/evidence/context types keep plain `string` fields —
  unchanged, no re-review needed.
- [ ] **Step 4 — let the compiler drive the rest.** `model.ts`,
  `engine.ts`, `operation.ts` internals, `twins.ts`, `conformance.ts`,
  and the test fixtures will fail to compile wherever a raw string
  literal meets a now-branded field — this is the bulk of the diff
  (twins and conformance fixtures build `Organization`/`Actor`/`Grant`/
  `Snapshot` objects from dozens of inline string literals each). Fix by
  wrapping each literal in its Step 2 constructor. Mechanical and
  compiler-guided: a missed site is a build failure, not a shipped bug.
  Candidate for the `agentic-sweep` skill — fan the resulting
  compile-error list across files, since each fix is independently
  verifiable ("wrap this literal in its constructor").
- [ ] **Step 5 — verify.** `pnpm check && pnpm typecheck`. Confirm the
  public `AuthorityCommand`/`PrincipalEvidence`/`AccessEnvelopeClaimsV1`
  surface is unchanged — diff the generated `.d.ts` for those three
  types specifically and expect no change.

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

- [ ] Add `tokenEndpoint` to `Discovery`, parse `token_endpoint` from the
  discovery document in `discoveryOf`.
- [ ] POST the code exchange to `discovery.tokenEndpoint`, not
  `authorizationEndpoint`.
- [ ] Fix the test fixture to use distinct authorization/token URLs, and
  assert the token POST lands on the token endpoint specifically.
- [ ] This must land before (or as part of) the next `cloudflare-v*` tag
  — `cloudflare-v0.1.0` is not safe for real-provider login until fixed.

## Sequencing

P0 and P2 are both correctness-blocking and independent of each other —
either can start first. P1 is type-safety hardening riding the same
1.3.0 release and is independent of P0/P2; all five items, including
id-branding, can proceed in parallel with the others. Id-branding and
P0 both touch `engine.ts`'s command handler and `operation.ts`'s
coordinators — worth sequencing P0 first in those two files so the
transition-kernel routing lands on unbranded types, then id-branding's
compiler-driven sweep catches the new call sites too, rather than
branding twice.
