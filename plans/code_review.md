# Code review and crystallization — whole-tree, one slice at a time

**Status (2026-10-25, later):** slice 1 (`src/`) was reviewed by three parallel
report-only readers (flash model, read-only), findings judged and
cross-verified against the Cloudflare code by the main agent. The review's
findings rode the **2.0.0** release: `GrantTarget` landed as the breaking
command change (`claude_review.md` P3), alongside the behavior tightenings
and additive API. R1, R2, R3, and R4 are now fully reconciled — every
correctness, mechanical, and structural item landed or was closed as
stale/kept-deliberately on 2026-10-25, tests-first through the public
seams. Remaining: R5 — the pending review slices for `packages/cloudflare`
(including the RFC-grounded exchange review), `tests/`, `bin/`, and configs.

The two cross-runtime findings below were fixed in 2.0.0; the rest of the
ledger is reconciled as marked.

## R1 — Correctness fixes (both runtimes, verified)

- [x] **Acceptance-after-revoke flips `revoked → active`.** An outbox
  acceptance delivered after `participation-revoke` is applied unguarded
  — reachable under retry/fault injection. True in the in-memory engine
  (outbox delivery) and in `packages/cloudflare`'s `operation.ts` intake
  (`UPDATE participations SET status='active'` with no current-state
  check). Fix: activate only from a non-revoked state, prefer routing
  the transition through `model.transitionParticipation` itself (which
  already refuses this). Add a fault-injection conformance case.
  Landed: both runtimes route through the shared transition;
  `tests/engine.test.ts` and `packages/cloudflare/test/operation.test.ts`
  pin the late acceptance.
- [x] **`grant-hat` validates role/team/site but not the actor.** Neither
  the in-memory engine nor the Cloudflare `/grant` handler checks that
  the actor exists or participates in the organization — a dangling
  grant commits where `invariantProblems` would flag it live. Fix:
  validate the actor/participation pair in both runtimes; add tests.
  Landed: in-memory validates the actor and active participation;
  Cloudflare checks the `org_actors` projection in the same transaction.
  `OH-CMD-03` and the coordinator tests pin it.
- [x] **`claims.v` never checked inside the envelope.** `verify.ts`
  checks `interfaceVersion` but not the inner claims version — a
  signature-valid `v:2` claims payload inside a `v:1` envelope is
  accepted. Fix: one comparison, mirroring the `interfaceVersion` check.
  Add a vector/test.
  Landed: `verify` compares the claims' `v` with the envelope's;
  `OH-ACCESS-04` and the access vectors pin it.
- [x] `snapshotOf` returns live internal arrays — copy before returning.
  Landed 2026-10-25: every list in the returned snapshot is a fresh copy;
  the test mutates what it was handed and proves engine state untouched.
- [x] `deliverPending` runs before the version-gate check — a
  wrong-version call still mutates state via drain. Move the drain after
  the gate; comment the invariant.
  Landed 2026-10-25: all four runtime methods gate first, drain second;
  the test pins that a refused call delivers nothing and a later valid
  call still can.
- [x] In-memory `provider:subject` string-join key can collide
  (`"a:b"/"c"` vs `"a"/"b:c"`) — Cloudflare keys the pair as columns, so
  this is in-memory only. Encode or use a nested map.
  Landed 2026-10-25, beyond the ledger: the collision was also
  cross-organization — per-org maps let the same key exist twice, and
  resolution picked the first org, silently resolving one evidence to
  another organization's actor. Links now live in one engine-wide map
  keyed by the JSON-encoded pair, and the bootstrap guard holds
  engine-wide. Tests pin both.
- [x] Refresh's supersede-before-issue ordering: decided to keep the
  fail-closed semantics as-is — document the order as intentional rather
  than reorder.
  Documented at the site 2026-10-25: one attempt consumes the handle; a
  failed reissue must not leave two live handles.
- [x] `request-access`'s note is accepted but silently discarded — store
  it (additive) so admit/audit can surface it.
  Landed 2026-10-25: stored on the access request, surfaced in the audit
  line, readable through a new additive `accessRequestsOf` handle
  accessor (a copy). Test pins all three.
- [x] Dead code: `OutboxMessage.to` removed (never read — delivery routes
  on `kind` and `target`); the invitation unions' unreachable members
  (`"declined"`, `"active"`) removed. Closed as stale: `modelCase` builds
  no unused worlds (cases read module-level twin snapshots). Kept
  deliberately: `policy.ts`'s null guard — `validatePolicyBundle` is the
  P9 parse boundary and a JSON `null` read policy is a real input, not
  over-defensiveness.

## R2 — Invariant-truth and doc fixes (mechanical, behavior-preserving)

- [x] `specs/authority.md` A3: "inventory runs through it exclusively"
  overstates coverage — OH-MODEL cases call `decide`/`readReach`
  directly. Reword to "the public surface, exclusively." Fixed
  2026-10-25.
- [x] A1 cites `OH-PART-02` for a property that belongs to `OH-CMD-02`.
  Fixed: A1 names `OH-CMD-02` for asking and `OH-PART-02` for terminal
  revocation.
- [x] `contract.ts` header mislabels the root as `v0.4`.
  Stale by 2026-10-25: the header reads "shared v1 vocabulary"; no `v0.4`
  label remains — fixed incidentally in the 2.0 rewrite.
- [x] `verify.ts` header states the fail-closed check order backwards.
  Fixed: the header states format/version, signature, expiry, and binding
  in that order.
- [x] ~~`specs/access.md` (§ Access) claims an issuer check that the code
  doesn't perform.~~ Stale entry: there is no `specs/access.md`; the access
  invariants live in `specs/authority.md` A5/A11 and `specs/envelope.md`.
  Verified 2026-10-25.
- [x] `acceptAgain`'s message names the wrong terminal state (says
  "accepted," means "revoked").
  Stale by 2026-10-25: no `acceptAgain` exists; the only terminal-state
  message ("participation is already revoked") is correct — fixed
  incidentally in the 2.0 rewrite.
- [x] `specs/authority.md` A9/A11: A11's held-by block was orphaned under
  A9; moved under A11. Fixed 2026-10-25.
- [x] `access/index.ts`'s header charter ignores its second job
  (issuer-side codec home) — document the dual role.
  Documented 2026-10-25: one codec home for the issuer's serialization
  and the verifier's parse, so the sides cannot drift.
- [x] E8 shared-kind note; `keys.ts` unknown-fields note; error-message
  precision pass; `TargetRef` operation-invariant note moved to types.
  Landed 2026-10-25: E8 states the failure taxonomy is one closed list
  shared by session and command surfaces; `keys.ts` documents that
  unknown fields are deliberately ignored (operator-distributed
  configuration, `format`/`v` carry compatibility); the `TargetRef`
  operation arm's no-whole-operation-reach invariant now lives at the
  re-export in `src/access/types.ts`. The error-message precision pass
  is closed without a pass: no concrete message list survived review;
  message wording is day-to-day work.
- [x] Conformance inventory header: state the fixture-scope decision
  explicitly (Berlin Airlift twin deliberately excluded — Quartermaster's
  structural twins plus the invitee fixture are the inventory world).
  Stated 2026-10-25 in `src/conformance.ts`'s header.
- [x] Invitee fixture named `"professional"` in its own union — rename to
  `"invitee"`.
  Landed 2026-10-25: both local fixtures renamed; `TwinFixture.name`
  widened additively with `"invitee"`. The engine test's `titled`
  mini-fixture still says `"professional"` — cosmetic, left.
- [x] Twins: `Team[]` typing, id-constants export, header wrap.
  Landed 2026-10-25: header rewrapped; `MERIDIAN` exported and imported
  by the conformance inventory instead of re-declared (`FESTIVAL` stays
  local — it already names the twin). Closed as stale: no local `Team[]`
  typing exists in `twins.ts`.
- [x] Conformance: `failureOf` should import `Failure`; twin ids imported
  from `twins.ts` rather than re-declared; `admitInvitee` placement.
  Landed 2026-10-25: `failureOf` types through the shared `Failed`/
  `Failure`; `MERIDIAN` imported from `twins.ts`. Kept as-is:
  `admitInvitee` sits with its helper peers and the module reads
  linearly.

## R3 — API additions (additive, 2.0.0)

- [x] Root doesn't re-export the id aliases — root consumers can't name
  them. Re-export from the package root.
  Landed 2026-10-25: the five aliases plus `Unbranded` re-export from
  `src/index.ts`. The aliases are the model's branded ids — the root is
  the core, not the host seam; hosts annotate their own strings with
  `Unbranded<OrganizationId>`, pinned by the consumer fence.
- [x] `NeutralAccess` lacks accessors the docs promise hosts read —
  `memberTeamIds()`, `authenticatedWith()`/`authenticatedAt()` (amr /
  authTime), `actor()` (organizationId/actorId). The amr addition left
  hosts without narrow accessors, contradicting § Access's "callers
  never see raw claims." Add the accessors; align docs and code.
  Landed 2026-10-25: all four accessors on `NeutralAccess`; absent `amr`
  flattens to an empty list, absent `auth_time` stays `undefined` (no
  honest zero); § Access's vocabulary sentence names them. Vector tests
  and the consumer fence pin the shapes; `tests/types.test.ts` pins the
  plain-string returns.
- [x] `["admin"]` default role fallback (A9, found independently by two
  readers) — a hardcoded admin title where the invariant says titles are
  configuration. Decision: require an explicit/declared default rather
  than falling back silently. Behavior change, sanctioned for 2.0.0.
  Landed in `claude_review.md` P1: an undeclared admin role set is empty,
  not a hardcoded title.
- [x] Non-admin-denial case added to the portable conformance inventory
  (authorize grant-hat by a non-admin → denied) — additive, both
  runtimes already exercise the shape.
  Landed 2026-10-25 as `OH-CMD-04`: a wearable coordinator hat with no
  configure action is refused the grant act, and an administrator's
  identical grant still applies. Passes against the in-memory and the
  Cloudflare worlds.

## R4 — Structural refactors (crystallization, 2.0.0)

`engine.ts`'s header promised two coordinators communicating over an
outbox; the code was one ~890-line closure interleaving both
coordinators' commands. This was the headline item.

- [x] Split `engine.ts` into coordinator modules with a gated-handler
  shape shared between them.
  Landed 2026-10-25: `src/authority/organization.ts` owns actors, principal
  links, org-side participation, and invitations; `operation.ts` owns
  sites, teams, grants, policy, op-side participation, refresh records,
  access requests, and the session surface; `outbox.ts` owns delivery;
  `state.ts` holds the shared state shapes and pure helpers, and
  `result.ts` the three result constructors. `engine.ts` is now bootstrap,
  the version/delivery gate, and a dispatch that routes each kind to the
  coordinator that owns it. `CommandHandler` is the one handler shape both
  coordinators expose. Behavior is unchanged: the existing 111 portable and
  49 workerd tests were the characterization net, green after every
  extraction.
- [x] Lift envelope-claims assembly — duplicated nearly line-for-line
  between `engine.ts` and Cloudflare's `operation.ts` — into one shared
  pure module under `src/`.
  Landed 2026-10-25: `src/authority/claims.ts` owns
  `assembleAccessClaims`; each runtime keeps only its own preconditions
  (actor existence and disablement in memory, bootstrap state in
  Cloudflare) and both delegate the claim shape. `tests/claims.test.ts`
  pins the hat, membership, routing sites, read reach, configuration
  reach, lifetime, and absent-versus-present authentication facts; the
  Cloudflare suite passes unchanged.
- [x] Grant ranking is written three times (model, engine, Cloudflare
  `buildClaims`) — the model should own one ranked-selection primitive;
  both engines call it.
  Landed 2026-10-25: `firstByRank` is exported from `model.ts`; worn-hat
  selection, the decision rule, and the shared claims assembler read it.
  The engine's `defaultHat` and Cloudflare's local rank are gone.
- [x] `resolveLink` helper duplicated three times; `failed`/`fail`/`ok`
  naming pass; select-hat double-negative simplification; refresh's
  `factsOf` reuse; `SignerLike`/`ClockLike` alias cleanup;
  `VerificationKeyMaterial` placement; `access/index.ts` verify/keys
  key-material split (optional).
  Reconciled 2026-10-25: no `resolveLink` exists — stale. The three
  result helpers are kept and now read as what they are: `failed` wraps a
  `Failure` for the session surface, `fail` builds one for a command, `ok`
  builds a receipt. Select-hat's dead id guards and double negative are
  simplified. Refresh reuses `authenticationFactsOf` for the record →
  claims copy. `SignerLike`/`ClockLike` are type aliases, not empty
  interfaces. `VerificationKeyMaterial` stays the contract's type
  re-exported by the authority subpath — that is its placement. The
  optional `access/index.ts` split is declined: the codec home is
  documented and small.

## R5 — Pending slices

- [ ] `packages/cloudflare`: coordinators (carrying the two cross-runtime
  fixes from R1), runtime, the exchange (RFC 8414/7515/7519/7636
  grounded — already landed per Quartermaster's relay note, review it
  against the RFCs), entrypoint, ops, wrangler configs.
- [ ] `tests/`: portable suite organization review. The suites and examples
  now typecheck in `bin/check`.
- [ ] `bin/`: `check`, `release`, `check-version`, `fix-dts`.

## Release

The version call moved after this ledger was written. `grant-hat`'s
`GrantTarget` break landed as **2.0.0**, with `AUTHORITY_INTERFACE_VERSION`
at 2 (see `claude_review.md` P3). `ACCESS_ENVELOPE_VERSION` stays 1: the
claims mean what they meant, and verification treats the claims'
`interfaceVersion` as provenance, so envelopes issued under interface 1
keep reading across the break.

The additive API and behavior tightenings below ride the same major. The
items landed in `claude_review.md` (the participation kernel, the roster
projection, id branding, the exchange fix, the envelope version check, and
the `GrantTarget` break) are recorded there; the unchecked boxes above are
still work. Supersedes the `v1.2.1` heads-up already sent to Quartermaster
(corrected in the relay note).

When this plan is realized it is removed; the result belongs in `docs/`
and the commit history.
