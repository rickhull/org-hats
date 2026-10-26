# Positioning — what org-hats is, and what it is not

*The current positioning reference. Plans for adoption and for the model
decisions this document depends on live in `plans/personas.md` and
`plans/model_coherence.md`.*

## One paragraph

`org-hats` is a portable authority core for organizations that work across
many operations, sites, and teams. It keeps organization identity and
operation-local authority as separate state, assigns a role to one actor over
one team or site, selects the active capacity for a session, and issues a
short-lived signed access envelope. A verifier checks the signature, expiry,
and binding and compares signed ids; it never rebuilds the organization's
rules. Revocation is bounded by the envelope lifetime, with refresh
re-resolving the actor at the organization. The in-memory engine is the
reference; the Cloudflare runtime is the production reference.

## In the literature's terms

It is best read as **target-scoped RBAC with a signed bearer authorization
projection**, wrapped in a multi-organization participation lifecycle — not as
a new RBAC variant, not as ABAC, not as Zanzibar/ReBAC, and not as a policy
engine. The full mapping is in [`model_mapping.md`](model_mapping.md).

- Roles are flat action sets; grants are target-scoped assignments.
- A site grant reaches the site and its teams; there is no role hierarchy,
  nested scope inheritance, deny, or separation of duty.
- Organization authority owns actors, principal links, and disabled status;
  operation authority owns grants, participation, policy, and issuance.
- The access verifier is a policy enforcement point with a cached, signed
  decision; the issuer computed the reach.
- The envelope is a bearer authorization projection, not a JWT, not a
  Kerberos ticket, and not an object capability the holder can attenuate.

## When to use it

- One organization works across several operations, sites, or teams.
- Several organizations participate in one operation, with contractors or
  secondments.
- The same person has different capacities in different operations.
- A service must decide locally while the authority is unreachable.
- A bounded revocation window is acceptable, and the host owns the product
  response to each closed failure kind.
- The host can map its objects onto neutral team or site targets.

## When not to use it

- One application and one role per user: a role column is simpler.
- You need role hierarchy, separation of duty, delegation, temporal
  validity, obligations, or a general attribute policy.
- You need immediate revocation for already-issued decisions.
- You need a general relationship graph (Zanzibar/ReBAC) or a general policy
  language (OPA, XACML).
- You need a standards-compliant NIST/INCITS RBAC, XACML, OAuth, or UMA
  implementation.
- Your identity estate is AD/LDAP/SAML/SCIM only and cannot supply OIDC
  evidence; there is no built-in directory connector.
- You cannot accept a custom envelope and an `org-hats/access` verifier in
  every downstream service.

## Comparison

| System | Unit of authority | State it owns | Local verification | Revocation | Multi-org / site | Policy language | Best fit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Role column | One role per user | Application rows | No | Query/update | No | None | One app, one role |
| AD / LDAP groups | Group membership + ACLs | Directory | Bind/token, not a signed decision | Group/ACL change, token lifetime | Domains/OUs, not operation-scoped | ACLs / group policy | Enterprise directory |
| Keycloak / Entra | Realm/tenant roles, clients | IdP | JWT/JWKS | Token expiry / session | Multi-tenant, often realm-global roles | Limited (realm/client roles) | Identity + coarse roles |
| Casbin | Policy rules | Policy store | In-process `enforce` | Policy update | Model-dependent | Casbin model | Embedded application policy |
| OPA | Policy over input JSON | Policy bundles | In-process/agent query | Bundle update | Policy-dependent | Rego | General policy decisions |
| Zanzibar / OpenFGA / SpiceDB | Relationship tuples | Relation graph | Check/expand API | Tuple deletion | Graph-native | Relation language | Relationship-heavy sharing |
| `org-hats` | Target-scoped assignment + signed projection | Organization and operation authority | Yes: signature, expiry, binding, signed ids | Grant/session rules + envelope lifetime | Yes: operations, sites, teams | Flat role → action sets | Multi-org / multi-site operations with offline verification |

The table is a fit guide, not a scorecard. Several of these compose with
`org-hats`: an OIDC provider supplies evidence; OPA could evaluate host
policy; a directory remains the identity source.

## Claims and evidence

- **One writer per fact, two coordinators, a retryable outbox.**
  `docs/authority_redesign.md` § State ownership; the in-memory and Cloudflare
  coordinators.
- **A deterministic decision rule with a closed denial taxonomy.**
  `src/model.ts`; `specs/authority.md`; the conformance inventory.
- **Issuer-computed reach, verifier-side comparison, no policy rebuild.**
  `src/access/verify.ts`; `specs/authority.md` A5; `specs/envelope.md`.
- **Authentication, participation, admission, assignment, and activation are
  separate concepts.** Evidence never creates an actor or a grant.
  `docs/authority_redesign.md` § Identity boundary; `specs/authority.md`.
- **Interface version and envelope version move for different reasons.**
  `specs/envelope.md` E8; `docs/migration-v2.md`.
- **Executable invariants and a public conformance inventory.**
  `src/conformance.ts`; `tests/`; `docs/binding-conformance.md`.
- **Deployment is the host's act; the release act ends at the tag.**
  `docs/cloudflare.md` § Deployment contract; `docs/publishing.md`.

## What not to claim

- "RBAC", "ABAC", "ReBAC", "Zanzibar", or "a policy engine" as the category.
- "A foundational access-control model" — until the unit-of-authority,
  admission, read-reach, and formal-model work in
  `plans/model_coherence.md` is settled.
- Role hierarchy, separation of duty, delegation, temporal validity,
  obligations, negative permissions, or immediate revocation.
- Standards conformance (NIST/INCITS 359, XACML, OAuth, UMA).
- "One hat bounds all authority": read, configuration, and member reach are
  currently unions over wearable grants, not only the selected action hat.
- "Admission is enforced": the concept is documented, but the grant is the
  operative admission today.
- "Bounded operations close automatically": `bounded` is a label, not a
  schedule.
- "Drop-in portable": the honest phrase is **portable semantics, one
  reference runtime**.
- "Secure by default" — there is no published threat model.

## Language guidance

| Wire / product term | Read it as | Avoid |
| --- | --- | --- |
| `operation` | Authorization domain / undertaking | Confusing it with an RBAC operation (an action on an object) |
| `action` | The verb a role carries | "Permission" without naming the target |
| `grant` | A target-scoped user-role assignment | OAuth grant, SQL `GRANT`, or "the authorization itself" |
| `hat` | The active assignment for this envelope | "Wearing several hats" — the model selects one action hat |
| `principal` (evidence) | The external subject before linking | Using "principal" for the linked actor |
| `admission` | The intent to enroll an actor in an operation | Claiming it is enforced; today the grant is operative |
| `bounded` | A label on a time-boxed operation | A schedule that closes the operation |
| `memberTeamIds` | Team ids reached by wearable grants | A directory membership list |

## Current limits

- **Production runtime:** Cloudflare only. The in-memory engine is the
  reference and test adapter, not a durable store.
- **Identity:** OIDC authorization-code + PKCE exchange; no LDAP, SAML, SCIM,
  or client-credentials flow. The live `cloudflare-v0.3.2` deployment verifies
  ES256 and RS256.
- **Envelope:** Ed25519 over canonical JSON, not JWT/JWKS; downstream services
  need `org-hats/access` and the key set.
- **Distribution:** git tags only; no registry publication.
- **Model:** flat roles; no hierarchy, constraints/SoD, delegation, temporal
  validity, obligations, or negative permissions. Read reach is
  role-independent; `all-participating` gives every hat the operation-wide
  read set.
- **Semantic coherence:** `decide` is per-target, issuance selects one hat per
  envelope, and read/config/member reach are unions. `memberTeamIds` is
  grant-reached teams despite the name. Admission is not a stored, checked
  relation. These are the decisions in `plans/model_coherence.md`, not
  marketing footnotes.
- **Operations:** the deploying host owns secrets, versions, traffic, state
  restore, roster rebuild, and the registry/DNS projection.

## Read next

- [`from_ldap.md`](from_ldap.md) — the AD/LDAP practitioner's map.
- [`model_mapping.md`](model_mapping.md) — the NIST/XACML/ABAC/ReBAC mapping
  and non-claims.
- [`authority_redesign.md`](authority_redesign.md) — the architecture and
  state ownership.
- [`cloudflare.md`](cloudflare.md) — the reference runtime and the deployment
  contract.
- [`binding-conformance.md`](binding-conformance.md) — what a deployed binding
  proves, and what it does not.
- [`../plans/personas.md`](../plans/personas.md) — the adoption plan.
- [`../plans/model_coherence.md`](../plans/model_coherence.md) — the model
  decisions that precede a foundational claim.
