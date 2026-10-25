# Code review and crystallization — whole-tree, one slice at a time

**Status:** slice 1 (`src/`) reviewed 2026-10-25 by three parallel
report-only readers (flash model, read-only), findings judged and
cross-verified against the Cloudflare code by the main agent. Findings
below ride the **2.0.0** release: `GrantTarget` landed as a breaking
command change (`claude_review.md` P3), and the behavior tightenings and
additive API here land alongside it, so no patch-release discipline is
needed. Pending slices: `packages/cloudflare`
(including the RFC-grounded exchange review), `tests/`, `bin/` and
configs.

Two correctness findings below are confirmed present in **both**
runtimes by reading the Cloudflare coordinator against the same
invariant; they are not `src/`-only bugs and they anchor slice 2.

## R1 — Correctness fixes (both runtimes, verified)

- [ ] **Acceptance-after-revoke flips `revoked → active`.** An outbox
  acceptance delivered after `participation-revoke` is applied unguarded
  — reachable under retry/fault injection. True in the in-memory engine
  (outbox delivery) and in `packages/cloudflare`'s `operation.ts` intake
  (`UPDATE participations SET status='active'` with no current-state
  check). Fix: activate only from a non-revoked state, prefer routing
  the transition through `model.transitionParticipation` itself (which
  already refuses this). Add a fault-injection conformance case.
- [ ] **`grant-hat` validates role/team/site but not the actor.** Neither
  the in-memory engine nor the Cloudflare `/grant` handler checks that
  the actor exists or participates in the organization — a dangling
  grant commits where `invariantProblems` would flag it live. Fix:
  validate the actor/participation pair in both runtimes; add tests.
- [ ] **`claims.v` never checked inside the envelope.** `verify.ts`
  checks `interfaceVersion` but not the inner claims version — a
  signature-valid `v:2` claims payload inside a `v:1` envelope is
  accepted. Fix: one comparison, mirroring the `interfaceVersion` check.
  Add a vector/test.
- [ ] `snapshotOf` returns live internal arrays — copy before returning.
- [ ] `deliverPending` runs before the version-gate check — a
  wrong-version call still mutates state via drain. Move the drain after
  the gate; comment the invariant.
- [ ] In-memory `provider:subject` string-join key can collide
  (`"a:b"/"c"` vs. `"a"/"b:c"`) — Cloudflare keys the pair as columns, so
  this is in-memory only. Encode or use a nested map.
- [ ] Refresh's supersede-before-issue ordering: decided to keep the
  fail-closed semantics as-is — document the order as intentional rather
  than reorder.
- [ ] `request-access`'s note is accepted but silently discarded — store
  it (additive) so admit/audit can surface it.
- [ ] Dead code: `OutboxMessage.to` (unused field); invitation union
  members `declined`/`active` (unreachable); `modelCase` building unused
  worlds; `policy.ts`'s mixed defensiveness (drop the null guard —
  config arrives typed; uniform trust-the-type per house style).

## R2 — Invariant-truth and doc fixes (mechanical, behavior-preserving)

- [ ] `specs/authority.md` A3: "inventory runs through it exclusively"
  overstates coverage — OH-MODEL cases call `decide`/`readReach`
  directly. Reword to "the public surface, exclusively."
- [ ] A1 cites `OH-PART-02` for a property that belongs to `OH-CMD-02`.
- [ ] `contract.ts` header mislabels the root as `v0.4`.
- [ ] `verify.ts` header states the fail-closed check order backwards.
- [ ] `specs/access.md` (§ Access) claims an issuer check that the code
  doesn't perform.
- [ ] `acceptAgain`'s message names the wrong terminal state (says
  "accepted," means "revoked").
- [ ] `access/index.ts`'s header charter ignores its second job
  (issuer-side codec home) — document the dual role.
- [ ] E8 shared-kind note; `keys.ts` unknown-fields note; error-message
  precision pass; `TargetRef` operation-invariant note moved to types.
- [ ] Conformance inventory header: state the fixture-scope decision
  explicitly (Berlin Airlift twin deliberately excluded — Quartermaster's
  structural twins plus the invitee fixture are the inventory world).
- [ ] Invitee fixture named `"professional"` in its own union — rename to
  `"invitee"`.
- [ ] Twins: `Team[]` typing, id-constants export, header wrap.
- [ ] Conformance: `failureOf` should import `Failure`; twin ids imported
  from `twins.ts` rather than re-declared; `admitInvitee` placement.

## R3 — API additions (additive, 2.0.0)

- [ ] Root doesn't re-export the id aliases `model.ts` defines
  (`OrganizationId` etc.) — root consumers can't name them. Re-export
  from the package root.
- [ ] `NeutralAccess` lacks accessors the docs promise hosts read —
  `memberTeamIds()`, `authenticatedWith()`/`authenticatedAt()` (amr /
  authTime), `actor()` (organizationId/actorId). The amr addition left
  hosts without narrow accessors, contradicting § Access's "callers
  never see raw claims." Add the accessors; align docs and code.
- [ ] `["admin"]` default role fallback (A9, found independently by two
  readers) — a hardcoded admin title where the invariant says titles are
  configuration. Decision: require an explicit/declared default rather
  than falling back silently. Behavior change, sanctioned for 2.0.0.
- [ ] Non-admin-denial case added to the portable conformance inventory
  (authorize grant-hat by a non-admin → denied) — additive, both
  runtimes already exercise the shape.

## R4 — Structural refactors (crystallization, 2.0.0)

`engine.ts`'s header promises two coordinators communicating over an
outbox; the code is one ~890-line closure interleaving both
coordinators' commands. This is the headline item.

- [ ] Split `engine.ts` into coordinator modules with a gated-handler
  shape shared between them.
- [ ] Lift envelope-claims assembly — duplicated nearly line-for-line
  between `engine.ts` and Cloudflare's `operation.ts` — into one shared
  pure module under `src/`.
- [ ] Grant ranking is written three times (model, engine, Cloudflare
  `buildClaims`) — the model should own one ranked-selection primitive;
  both engines call it.
- [ ] `resolveLink` helper duplicated three times; `failed`/`fail`/`ok`
  naming pass; select-hat double-negative simplification; refresh's
  `factsOf` reuse; `SignerLike`/`ClockLike` alias cleanup;
  `VerificationKeyMaterial` placement; `access/index.ts` verify/keys
  key-material split (optional).

## R5 — Pending slices

- [ ] `packages/cloudflare`: coordinators (carrying the two cross-runtime
  fixes from R1), runtime, the exchange (RFC 8414/7515/7519/7636
  grounded — already landed per Quartermaster's relay note, review it
  against the RFCs), entrypoint, ops, wrangler configs.
- [ ] `tests/`: portable suite organization review.
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
