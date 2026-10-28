# Model mapping — org-hats in access-control vocabulary

*For the standards reader and the access-control researcher. The current
positioning and non-claims are in [`../positioning.md`](../positioning.md);
the layered projection and non-goals are in
[`../authority_redesign.md`](../authority_redesign.md) § Access.*

## Summary

`org-hats` is best classified as **target-scoped RBAC0 with a signed bearer
authorization projection**, inside a multi-organization participation
lifecycle. It is not a new RBAC variant, not ABAC, not ReBAC/Zanzibar, not a
policy engine, and not a standards-conformant XACML or NIST RBAC
implementation.

The clean decomposition:

| `org-hats` role | Closest standard role |
| --- | --- |
| Organization authority | Policy information point (PIP) for actor identity and status |
| Operation authority | Policy decision point (PDP) for operation-local authority and issuance |
| Access verifier | Policy enforcement point (PEP) with a signed, cached decision |
| Host application | Product policy, object mapping, and response policy |

## Terminology

| `org-hats` | Standard vocabulary | Difference |
| --- | --- | --- |
| Organization | Identity/administrative domain; tenant | An identity home, not an authorization boundary. A grant can reach a team fielded by another organization. |
| Operation | Authorization domain / assignment scope | **Not** an RBAC *operation*, which is an action on an object. The action is called `action`. |
| Site | Resource container | One containment level: site → teams. No arbitrary object hierarchy. |
| Team | Group / object set / team context | Organization-fielded, site-local. Membership is not authority; there is no group-as-grantee. |
| Actor | Subject/user | Organization-scoped identity; no platform-global person; no credential in the model. |
| Participation | Organization–operation relationship | A two-party lifecycle (`invited → accepted → active → revoked`), not a group membership. |
| Admission | Enrollment/eligibility | Documented as distinct; the grant is currently operative. See the model-coherence plan. |
| Grant | User-role assignment (UA) with a target | One actor, one role, one team or site. Not a permission; not an ACL. |
| Role | Flat RBAC role | Action set only. No hierarchy, dominance, prerequisites, or constraints. |
| Action | RBAC operation; one half of a permission | Object-independent. A permission is `(action, target)` and is not materialized. |
| Hat | Active role / session role / role activation | One action hat per envelope. Read/config/member reach are currently unions over wearable grants. |
| Access envelope | Signed authorization projection / cached PDP decision | Bearer, Ed25519 over canonical JSON. Not a JWT, not a Kerberos ticket, not a PAC. |
| Refresh handle | Refresh token / TGT | Opaque, hashed at rest, rotated on use, superseded before reissue. |
| Access verifier | PEP with a cached decision | Checks signature, expiry, and binding; compares signed ids; does not evaluate policy. |

## NIST / INCITS 359 and RBAC96

Against Core RBAC:

- users → actors (organization-scoped);
- roles → flat action sets;
- permissions → `(action, target)` pairs, not materialized;
- sessions → envelopes with one active hat;
- user-role assignment → a grant with a target;
- role hierarchy (RBAC1) → absent;
- constraints and separation of duty (RBAC2) → absent;
- the combination (RBAC3) → absent;
- administrative RBAC (ARBAC) → absent; administration is engine/policy
  configuration, not a modeled hierarchy.

The single-active-role restriction is a restriction on RBAC sessions, not a
new RBAC variant. The grant over one target is closest to TMAC/GRBAC and
parameterized-role models, but the repository does not claim those lineages.

The one genuine addition to standard RBAC is the **organization/operation
participation lifecycle** and the **signed decision cache**. Those are
architecture and systems contributions, not new role semantics.

## XACML 3.0

- The operation authority is the PDP; the access verifier is a PEP with a
  cached decision; the organization authority supplies identity/status facts
  as a PIP.
- There is no policy language, no policy combining algorithm, no
  deny-overrides, no obligations or advice, and no general attribute
  condition. The policy bundle is a flat role-to-action map plus a read-policy
  axis.
- The signed envelope is a decision cache with a bounded lifetime, not an
  XACML response with obligations.

## ABAC (NIST SP 800-162)

The model carries attributes — organization, operation, site, team, `amr`,
`auth_time` — but it does not evaluate conditions over them. `amr` and
`auth_time` are transported opaquely; `readPolicy` is a fixed axis, not a
general attribute policy. It is **attribute-informed RBAC**, not ABAC.

## ReBAC / Zanzibar

The data is Zanzibar-shaped: organization, site, team, grant, and participation
form a small relation graph. A site grant reaching every team at the site is a
fixed userset rewrite; `granted-teams` is a computed userset over reached
teams and their organizations.

It is not Zanzibar semantics:

- there is no relation language, no `check`/`expand` API, no zookie, and no
  live graph evaluation;
- the graph is evaluated at issuance and frozen into a signed envelope;
- the relations are fixed (site→team, team→organization, grant→actor/team/site),
  not user-defined;
- there is no arbitrary sharing or nested userset composition.

It is **Zanzibar-shaped data with cached-decision semantics**.

## Capability systems

The envelope is a bearer capability in the loose sense: possession is authority
until expiry. It is not an object capability in the Dennis–Van Horn/Miller
sense: it contains identifiers rather than unforgeable references, the host
enforces, and the holder cannot attenuate it. The safer term is **signed
bearer authorization projection**, comparable to SAML assertions, UMA RPTs, or
macaroons/Biscuit without attenuation.

## OIDC / OAuth

- The provider-callback exchange is OIDC authorization-code + PKCE; it returns
  typed evidence, not authority.
- `amr` (RFC 8176) and `auth_time` (OIDC) are carried as opaque authentication
  facts. Authority does not interpret them.
- The access envelope is not a JWT and the verifier is not JWKS middleware.
- The refresh handle is not an OAuth refresh token; it is opaque, hashed at
  rest, rotated on use, and subject to issuer-side liveness.

## Properties the design claims

- Safety: no allow without an enabled actor, active participation, a
  non-revoked reaching grant, and a role carrying the action.
- Issuer/verifier separation: the issuer computes reach; the verifier compares
  signed ids and never rebuilds organization policy.
- Bounded revocation: an issued envelope survives to `exp`; refresh is the
  liveness gate; grant revocation bounds new issuance.
- State ownership: one writer per fact; cross-coordinator work is a retryable
  outbox, not a distributed transaction.
- Versioning: the call interface and the envelope semantics move for different
  reasons; the claims' interface version is provenance, not a readability gate.
- Executable evidence: named invariants, a public conformance inventory, and
  synthetic structural fixtures.

These are engineering claims with tests and prose invariants. They are not a
mechanized proof.

## What the design does not claim

- NIST/INCITS RBAC, RBAC1, RBAC2, RBAC3, or ARBAC conformance.
- XACML conformance, a policy language, obligations, or deny-overrides.
- ABAC, a general attribute policy, or NIST SP 800-162 conformance.
- Zanzibar/ReBAC semantics, arbitrary relations, or live graph checks.
- Object-capability semantics or attenuation.
- Role hierarchy, separation of duty, delegation, temporal validity,
  obligations, or negative permissions.
- Immediate revocation of already-issued decisions.
- Compliance-grade audit, a formal threat model, or "secure by default".
- A complete authorization decision for constrained policies: the envelope
  carries one action hat, not the full grant set.

## Citable-model work

The formal model, threat model, language-independent envelope specification,
structured audit/provenance, and comparative evaluation are not current
claims and are not pursued in this line. The invariant style in
`specs/authority.md` and `specs/envelope.md` — claim, "held by", "if it
breaks" — is the right skeleton for a future appendix.

## Read next

- [`README.md`](README.md) — the four audiences and what to show each.
