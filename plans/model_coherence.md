# Model coherence — decisions before "foundational"

**Status:** forward-looking, 2026-10-25. This plan comes from the
access-control academic persona review, checked against the code. It is not a
bug list and not a promise to implement every item; it is the set of semantic
decisions that must be made before `docs/positioning.md` may call `org-hats` a
foundational model rather than a credible reference architecture.

The current positioning and non-claims are in `docs/positioning.md`; the
literature mapping is `docs/model_mapping.md`. The adoption/marketing plan is
`plans/personas.md`.

## The one finding

There are three different units of authority in the current code:

- `decide` selects a grant **per target** (`src/model.ts`, decision rule);
- issuance selects one hat **per envelope** (`src/authority/claims.ts`,
  `firstByRank(wearable)` with no target);
- read reach, routing sites, `memberTeamIds`, and `configurableSiteIds` are
  unions over **all wearable grants** (`src/model.ts` `readReach`;
  `src/authority/claims.ts`).

They are each defensible. Together they make "one hat at a time" ambiguous:
the envelope carries one action hat, but read/config/member authority comes
from grants the actor is not wearing. The twins mostly give each actor one
grant, so the conformance inventory does not expose the difference.

## P0 — choose the unit of authority

- [ ] Decide which model is normative:
  - **Session hat:** the active grant bounds all claims; `decide` takes the
    selected grant; read/config/member derive from it. Matches "one hat at a
    time" most literally.
  - **Per-target signed decision:** the envelope carries candidate hats or a
    signed decision table; the verifier applies a published selection rule per
    target. Closer to `decide`, more claims and verifier logic.
  - **Explicit layered projection:** keep a selected action hat and separate
    read/config/member layers, name them, and stop saying the hat bounds all
    authority. Least disruptive to the current envelope, most documentation
    work.
- [ ] Make `decide`, issuance, and the verifier implement the same chosen
  function. Add multi-grant tests that would fail under the current split; the
  current twin fixtures hide it.
- [ ] Decide whether to add `grantId` (and a policy version) to the claims so
  the verifier and `context` can identify the exact assignment. `context`
  currently finds the selected grant by role title only, which is wrong when
  two grants share a role on different targets.
- [ ] Decide whether this is an envelope-format change or an additive claim.
  A claim that changes what old verifiers should enforce is a format move; a
  provenance-only claim can be additive only if it cannot restrict authority.
- [ ] Apply the same chosen model to `configurableSiteIds`, `sites`,
  `memberTeamIds`, and `readReach`, or give each a named layer with its own
  least-privilege story.

## P1 — admission and reach

- [ ] **Admission:** the lexicon documents admission as distinct from
  authentication and participation, but `admit` only clears the access-request
  queue and writes an audit line; `wearableGrants` checks actor, participation,
  and grant. In practice the grant is admission. Either:
  - store an admitted relation and check it in wearability/issuance, with a
    migration for existing grants; or
  - remove the separate concept, rename the queue to access requests, and say
    that the grant is the operation's acceptance.
  Either way, the identity → participation → admission → assignment →
  activation chain in the docs must match the code.
- [ ] **`memberTeamIds`:** the accessor comment says membership "not by
  grant"; the claims compute it from wearable grants. Decide whether this is a
  membership list (then implement membership) or a grant-reached list (then
  rename the accessor and the claim, or document the name as historical). A
  wire rename is an envelope change; a prose alias is cheap.
- [ ] **Read reach:** `readReach` is role-independent. Under
  `all-participating`, any actor with any wearable hat gets every actively
  participating organization. Decide whether read is a separate permission
  layer with its own assignment, or a policy consequence of participation;
  either way, state the least-privilege consequence and the open read-only-hat
  decision.
- [ ] **Site grants and cross-organization read:** a site grant reaches teams
  fielded by other organizations; `granted-teams` then exposes those
  organizations. Decide whether that is the intended coalition behavior and
  name it in the read-policy docs.
- [ ] **`bounded`:** it is a label; nothing closes a bounded operation. Either
  implement validity/closure semantics or rename it to "time-boxed label" and
  stop implying enforcement.

## P2 — vocabulary, determinism, and API hygiene

- [ ] Decide the vocabulary policy: keep the wire terms (`operation`,
  `grant`, `memberTeamIds`) and add formal prose aliases, or make a breaking
  rename. The low-risk path is prose: "authorization domain", "target-scoped
  assignment", "grant-reached team ids".
- [ ] Replace `firstByRank`'s `|`-joined string key with a tuple comparator or
  constrain the alphabet. Ids and role titles are arbitrary strings; the
  current key is not injective.
- [ ] `RefreshHandleOutcome` advertises `kept` and `revoked`, but both engines
  always return `rotated`. Implement the outcomes or remove the dead arms.
- [ ] `select-hat` changes the primary grant but does not check that the grant
  is active/not revoked. It also lets any actor with a live envelope switch to
  any held grant. Decide the activation policy and check it.
- [ ] `context` should use the same envelope version gate as `verify`, and
  should identify the selected grant by id once `grantId` exists.
- [ ] Decide whether `VerifyContext.expectedOperationId`/`expectedSiteId` stay
  optional. For a security-sensitive component, require the expected binding
  or make "accept any" an explicit mode.
- [ ] Decide the envelope canonicalization: adopt RFC 8785 JCS, or justify the
  custom canonical JSON with a language-independent spec and cross-language
  vectors.
- [ ] Decide whether `keyId` should be inside the signed payload, and whether
  the verifier should check `iat`, `exp > iat`, and a maximum lifetime.

## P3 — formal model, threat model, and the missing layers

- [ ] Write a formal model: sorts, relations, state machines, the decision
  function, and the properties (safety, completeness, determinism, revocation
  bound, least privilege, non-interference, convergence, idempotency, version
  compatibility, audit completeness).
- [ ] Write a threat model: bearer replay, cookie theft, CSRF/XSS (host-owned),
  issuer-key compromise, verifier key-set authenticity, canonicalization
  ambiguity, clock skew, and the trust boundary of a compromised host.
- [ ] Publish a language-independent envelope spec with test vectors, or state
  that the format is single-implementation and not an interoperability claim.
- [ ] Structure the audit: event taxonomy, target, outcome, policy version,
  idempotency key, authorization context, before/after, issuance/refresh/denial
  events, retention, tamper evidence, and export.
- [ ] Add provenance to claims: `grantId`, policy version, issuer identity, and
  a session/envelope id. A verifier should be able to tie a decision to the
  assignment and policy that produced it.
- [ ] Separate site configuration from authority administration. A role
  carrying `configure` currently also passes the operation-admin gate for
  grant/revoke/invite/admit/participation-revoke. Decide whether that is
  intended, and move administrative roles/permissions into the policy bundle
  or a formal ARBAC-style model.
- [ ] Decide, explicitly, whether constraints/separation of duty, delegation,
  temporal validity, obligations, and general attributes are implemented
  features or non-goals with stated consequences. A single-hat envelope cannot
  enforce SoD without the full assignment set; if SoD matters, the projection
  model must change.
- [ ] Strengthen `invariantProblems` or add a validator for id uniqueness,
  duplicate grants, and selection determinism if the formal model relies on
  them.

## Sequencing

1. **P0 + the admission/`memberTeamIds` parts of P1** — these determine what
   the model is. Do not market as "foundational" before them.
2. **P2 hygiene** — cheap fixes that remove contradictions and improve
   credibility; some can land independently.
3. **P3 formal model and threat model** — the path to a citable, teachable
   reference model.
4. **Then** update `docs/positioning.md` to make the stronger claim, if the
   decisions support it.

## Non-goals

- No speculative production adapter merely to claim portability. A test-only
  adapter in another language is evidence; a second production runtime is a
  different commitment.
- No broad policy language, role hierarchy, or registry publication as part of
  this plan. Each is a separate product decision.
- No weakening of the portable fence, the closed failure taxonomy, or the
  migration/versioning discipline to make a comparison table look better.

## Evidence

- `src/model.ts` — decision rule, selection, read reach, wearability.
- `src/authority/claims.ts` — issuance, selected hat, unions.
- `src/access/verify.ts` — verifier predicates and binding.
- `src/access/types.ts` — `memberTeamIds` comment.
- `src/authority/operation.ts` — `admit`, `context`, `select-hat`, issuance.
- `src/contract.ts` — claims, refresh outcomes, failure taxonomy.
- `specs/authority.md`, `specs/envelope.md` — invariants and "held by" claims.
- `docs/positioning.md`, `docs/from_ldap.md` — the current public framing.

No secrets or customer data in this plan.
