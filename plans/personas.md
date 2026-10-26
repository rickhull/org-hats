# Personas and adoption — how a practitioner and an academic meet org-hats

**Status:** positioning plan, 2026-10-25. This plan is about adoption and
messaging, not source behavior. It is based on two report-only persona
reviews — a journeyman developer fluent in Active Directory/LDAP, and an
access-control academic — followed by code checks of their load-bearing
claims. The current-state positioning is `docs/positioning.md`; the model
decisions that must precede a "foundational" claim are in
`plans/model_coherence.md`.

## The one-sentence position

> A portable authority core for organizations that work across many
> operations and sites: one identity, one active capacity per session,
> target-scoped role assignments, and locally verifiable signed access with a
> bounded revocation window.

## What to refuse to claim

Do not market it as "RBAC", "ABAC", "ReBAC", "Zanzibar", a "policy engine", or
"a foundational access-control model" until the unit-of-authority, admission,
read-reach, and formal-model decisions in `plans/model_coherence.md` are
settled. Those labels invite comparisons the current design does not win. The
honest frame is **scoped role activation plus a signed authorization
projection, with a multi-organization participation lifecycle**.

## Persona 1 — the journeyman developer

**Profile:** about eight years in; comfortable with AD and LDAP (groups,
nested groups, bind DNs, service accounts, "why is this user in this group?"
tickets); some application RBAC; a few toy repos and one work system where
this might apply.

**Job to be done:** "One person works in several operations, sites, or
companies; a single `role` column and a flat group list cannot say who may do
what where. I want the rule to be explicit, testable, and verifiable by the
service that acts on it."

**What hooks him:** the Dana example (one identity, two operations, two local
hats); the honest "what it is not" paragraph; `node examples/pilot.ts`
working; the AD/LDAP lesson that **ids resolve and aliases decorate**, unlike
DN-anchored ACLs; bind/evidence separated from authority; offline verification
with a bounded revocation window.

**What loses him:** the pilot is someone else's world; a first own-world
fixture is undocumented and `TwinFixture.name` is a closed union of twin
names; the tutorial's `select-hat` case selects the hat Dana already wears, so
it never shows a real hat switch; no consumer install line in the README; the
envelope is not a JWT and needs an `org-hats/access` verifier; no LDAP, SCIM,
SAML, service-account, group-grant, nesting, or deny story.

**The five-minute path he would actually follow:**

```sh
git clone https://codeberg.org/rickhull/org-hats.git
cd org-hats
pnpm install
node examples/pilot.ts
pnpm test
```

Then: a **non-twin** `examples/own-world.ts` (his organization, site, team,
grant), a tiny HTTP handler that verifies the envelope and calls `mayAct`,
and a real `select-hat` → refresh example.

**Proof and content for him:**

- `docs/from_ldap.md` — the AD/LDAP mapping and non-mapping table.
- A "read this first" decision box: not an IdP or directory; no group grants,
  nesting, deny, or inheritance; one active hat per session; Cloudflare is the
  production runtime; the envelope is not JWT.
- A comparison/decision matrix against the honest baseline (a role column),
  Keycloak/Entra, Casbin, OPA, and Zanzibar-style systems.
- A consumer quickstart with the git pin, not just the repo's own pilot.

## Persona 2 — the access-control academic

**Profile:** knows NIST/INCITS 359, RBAC96/ARBAC, XACML, ABAC, ReBAC/Zanzibar,
capability systems, delegation/revocation, and audit/compliance. Evaluates the
repository as a possible foundational block, not as a product.

**What earns respect:** the organization/operation split with explicit
participation; the factorized assignment (flat role × target scope with
site→team containment); issuer-computed read reach and a verifier that never
rebuilds policy; the interface-version vs envelope-version split; named
invariants with "held by" evidence; the executable conformance inventory and
synthetic twins; the migration discipline; the bounded revocation window and
the explicit refresh-liveness gate.

**What blocks "foundational":** three different units of authority (`decide`
per target, issuance per session, read/config/member reach per union);
admission documented but not enforced; read reach outside the role rule;
missing formal model, threat model, constraints/separation of duty,
delegation, temporal/obligation semantics, structured audit/provenance, and
policy administration; vocabulary collisions (`operation` vs action, `grant`
vs assignment, `hat`, `principal`, `admission`, `bounded`).

**The citable story:** a reference model and executable specification for
**scoped role activation with signed authorization projections** in
multi-organization operations. The contribution is the architecture,
invariants, conformance method, and versioning discipline — not a new
theoretical RBAC variant.

**What he needs from us:** a formal model and threat model; a mapping to
NIST RBAC, XACML, ABAC, ReBAC/Zanzibar, OIDC/OAuth, and capabilities; a
language-independent envelope spec (RFC 8785 JCS or a justified alternative)
with cross-language vectors; an invariant appendix; and a tech report. Until
then, position it as a reference architecture, not a foundational model.

## Secondary audiences

- **Architect / tech lead:** cares about state ownership, the outbox, the
  projection, failure taxonomy, migration, and the deployment contract. Give
  them `docs/authority_redesign.md`, `docs/cloudflare.md` § Deployment contract,
  and the comparison matrix.
- **Operator / self-hoster:** cares about the Cloudflare-only reference
  runtime, secrets, key rotation, export/restore, roster staleness, and the
  fact that deployment is the host's act. Give them `docs/cloudflare.md`,
  `docs/binding-conformance.md`, and `docs/publishing.md` § Deployment is not
  publishing.

## Content plan

**P0 — adoption hook (low risk, no model decision needed):**

1. `examples/own-world.ts` — a non-twin world with a made-up organization,
   site, team, grant, issue, verify, and `mayAct`; plus a tiny HTTP handler
   mapping failure kinds to product responses.
2. A real hat-switch example (`select-hat` to a different grant, then refresh
   or reissue), in the tutorial or a new example.
3. `docs/from_ldap.md` — the practitioner mapping.
4. `docs/positioning.md` — the current positioning, claims/non-claims,
   comparison matrix, and language guidance.
5. `docs/model_mapping.md` — the NIST/XACML/ABAC/ReBAC mapping and the
   citable-model skeleton.
5. A top-of-README decision box and a consumer quickstart with the git pin.
6. Widen or replace `TwinFixture.name` for own-world use, or add a clearly
   named world type; the closed twin union is an adoption wall.

**P1 — credibility (needs decisions):**

1. `plans/model_coherence.md` decisions: unit of authority, admission,
   `memberTeamIds`, read reach, `configurableSiteIds`, `grantId`/policy
   provenance, and the `context`/version/`select-hat` checks.
2. A formal model / position paper (`docs/model.md` or a `specs/` addition)
   with definitions, decision function, invariants, and non-goals, building
   on `docs/model_mapping.md`.
3. A threat model and a structured audit/provenance schema.
4. A language-independent envelope spec with vectors, or an explicit
   justification for the custom canonicalization.
5. A NIST/XACML/ABAC/ReBAC/OIDC mapping appendix.

**P2 — release and operations:** QM acceptance confirmation and, if wanted,
`cloudflare-v0.3.2` with the post-v0.3.1 fixes, followed by a fresh host
deploy and smoke.

**P3 — test-suite coverage:** the P1 items in `plans/test_suite_review.md`,
including multi-grant cases that expose the unit-of-authority divergence.

## Channels

- **README and Codeberg** are the front door; the pilot plus own-world path
  must be there.
- **Architecture and practitioner posts** (e.g. "Authorization for the
  contractor across three companies", "What AD groups cannot tell you about
  sites and hats") rather than launch hype.
- **A tech report** for the academic/standards audience; the A/E/P invariant
  style is the skeleton.
- **Talks/workshops** around the Berlin Airlift twin as a cross-organization
  case study.
- Avoid broad "Show HN"-style launches until P1 is settled; the current
  honest claim is a component, not a foundation.

## Sequencing and success signals

Sequence: P0 hook → P1 decisions/formalization → P2 release/acceptance → P3
test depth. Success signals are qualitative and specific:

- a new user can go from clone to their own world without reading the engine;
- practitioners ask about AD/LDAP mapping rather than "is this RBAC?";
- architects cite the state-ownership and envelope-versioning decisions;
- an academic can cite the invariants and conformance method without having
  to correct the model first;
- no one is surprised by "not a JWT", "Cloudflare-only production runtime",
  or "one active hat per session".

## Guardrails

- No customer names, real rosters, or secrets in any marketing artifact.
- Do not claim standards conformance, role hierarchy, SoD, delegation,
  temporal validity, immediate revocation, full audit, or "secure by default".
- Do not claim a hat bounds all authority while read/config/member reach are
  unions; fix the model or state the exception.
- Keep the distinction between the released `cloudflare-v0.3.1` and `main`
  visible when discussing the exchange (RS256) and any post-tag fixes.

## Open decisions

- Is the product a **component** (adopt the model, bring your own runtime) or
  a **reference foundation** (formalize the model, publish a paper)? P1 is
  only worth doing for the second.
- Do we rename any wire vocabulary (`operation`, `grant`, `memberTeamIds`) or
  keep the wire and add formal prose aliases? Wire renames are envelope/command
  breaks; prose aliases are cheap.
- Do we build an own-world API, or document the existing fixture shape?
- Do we want a non-Cloudflare *test* adapter to prove portability, without
  claiming a second production runtime?
