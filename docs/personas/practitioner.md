# From Active Directory and LDAP

*For the practitioner who knows groups, OUs, bind DNs, and "why is this user
in this group?" — and wants to know whether `org-hats` fits. The current
positioning is in [`../positioning.md`](../positioning.md); the architecture
is in [`../authority_redesign.md`](../authority_redesign.md).*

## The short version

`org-hats` is not a directory and does not replace AD, Entra, or an LDAP
server. It is the authorization layer above identity: an organization owns
its actors, an operation owns grants, and a grant says **one actor, one role,
one team or site**. The authority issues a short-lived signed envelope with
one active hat; a downstream service verifies it locally with a public key.
Revocation is bounded by the envelope lifetime, and refresh re-resolves the
actor at the organization.

The AD/LDAP lesson it takes seriously: **stable opaque ids are the anchor,
aliases decorate**. A DN is a name that changes when an object moves; an
`org-hats` id is permanent, and a site alias or operation slug is routing
decoration. That is the right lesson for cross-organization, multi-site work.

## Mapping

| `org-hats` | Closest AD/LDAP idea | The difference that matters |
| --- | --- | --- |
| **Organization** | Domain / forest / tenant | An identity home, not an authorization tree. An operation can include teams fielded by several organizations. |
| **Operation** | Application tenancy / authorization domain | Flat. It is not an OU, has no parent, and has no inheritance. The closest AD analogy is a separate application, not a container. |
| **Site** | Resource container / site OU | One containment level: a site has teams. It is not a subtree you can delegate. |
| **Team** | Resource-scoped security group | Membership is not authority. A team is fielded by one organization at one site; there are no nested teams and no group-as-grantee. |
| **Actor** | User or service account | An organization-scoped identity, not a global person. There is no credential in the model: no password, keytab, or client secret. |
| **Principal link** | External-subject mapping | An explicit `(provider, subject) → actor` link created at bootstrap. There is no DN and no directory sync; equal mail-shaped subjects never merge actors. |
| **Grant** | User-role assignment / ACE | One actor, one role, one target (team or site). It is not a permission and not an ACL: the permission is the pair `(action, target)`. There is no group principal and no `AGDLP`. |
| **Role** | Role / permission set | Flat action set. No role hierarchy, dominance, nested roles, prerequisites, or constraints. |
| **Hat** | Active role / PAM role activation | The grant worn for this envelope. One action hat per envelope; unlike a Kerberos ticket or PAC, the envelope carries a selected capacity, not every group. |
| **Participation** | Cross-org relationship / membership | A two-party lifecycle: invite → accept → activate → revoke. It belongs to the organization–operation relationship, not to the actor's group list. |
| **Admission** | Enrollment in an application | The intent is separate from participation and grant; the grant is the operative admission, and access requests are a reviewed queue. See `authority_redesign.md` § Access. |
| **Evidence** | Bind / token authentication result | A typed assertion (`provider`, `subject`, optional `amr`/`auth_time`). It creates no actor, participation, or grant. Authentication is not authority. |
| **Envelope** | Kerberos ticket / PAC / JWT-ish projection | Signed with Ed25519 over canonical JSON; verified locally. It is not a JWT, not a Kerberos ticket, and not a PAC. Downstream services use `org-hats/access`, not standard JWT middleware. |
| **Verifier** | Resource service / PEP | Checks signature, expiry, and binding, then compares signed ids. It never rebuilds the operation's policy or queries the directory. |
| **Read reach** | Group-derived visibility | Computed at issuance from the policy (`granted-teams` or `all-participating`), not from the selected role's action list. Under `all-participating`, any hat gets the operation-wide read set. |
| **Refresh handle** | TGT / refresh token | Opaque, hashed at rest, rotated on use, superseded before reissue; refresh re-resolves the actor at the organization. |
| **`memberTeamIds`** | Group membership list | Despite the name, it is the team ids the wearable grants reach, not a directory membership list. |

## What does not map

- **Nested groups.** There is no recursive group expansion. A site grant
  reaches the site and its teams; that is the only containment step.
- **Group-as-grantee.** You cannot grant to a group and manage membership.
  `grant-hat` names one actor. At directory scale that is a provisioning
  project, not an `AGDLP` pattern.
- **OUs and inheritance.** Operations are flat; there is no parent/child
  hierarchy, no inherited ACL, and no delegation tree.
- **Deny ACEs and negative permissions.** Grants are positive; exceptions are
  enumerated. There is no explicit deny.
- **Separation of duty and constraints.** Not in the model; the envelope
  carries one selected hat, not the full grant set.
- **DN as identity.** Ids are permanent and flat; there is no DN, search
  base, subtree filter, or LDAP browser view.
- **Bind as authorization.** A successful bind or evidence resolution admits
  nobody. Participation and a grant are separate, and admission is documented
  as separate again.
- **Service accounts and workload identity.** The reference exchange is OIDC
  authorization-code + PKCE for a browser login. There is no client-credentials
  flow, gMSA, SPN, or keytab story; a machine identity needs an adapter.
- **Directory sync.** Principal links are explicit bootstrap material. There
  is no LDAP/SCIM/SAML connector in the box.
- **Immediate revocation.** An already-issued ordinary envelope survives to
  its expiry; the lease is the revocation bound. Refresh is the liveness gate.
- **Multiple simultaneous hats.** One action hat per envelope. Switching the
  active grant is `select-hat`; a live envelope keeps its claims until the
  next issuance or refresh.

## How to explain it to a coworker

> It is an authorization service for multi-site, multi-organization work. It
> knows organizations, sites, and teams; a grant is one person, one role, one
> team or site; it issues a short-lived Ed25519 envelope with one active hat;
> downstream services verify it offline with a public key; changes go through
> idempotent commands. It does not authenticate users or replace AD/Entra, it
> is not a group system, there is no nesting or inheritance, and you wear one
> hat at a time. The production reference runtime is Cloudflare.

Then answer the obvious comparisons:

- **Why not Keycloak/Entra?** They are identity and coarse roles. This is the
  operation/site/team structure and the offline signed decision; use them together.
- **Why not OPA/Casbin?** They evaluate policy over an input. This owns the
  organization/site/team state and the session envelope. OPA can still evaluate
  host policy.
- **Why not Zanzibar/OpenFGA?** Use a relation graph for arbitrary sharing and
  nesting. This is a fixed site→team reach with a signed cached decision.
- **Why not a role column?** Because one role and one application cannot
  express the contractor across three organizations and two sites.

## The shortest path

```sh
git clone https://codeberg.org/rickhull/org-hats.git
cd org-hats
pnpm install
node examples/pilot.ts
node examples/own-world.ts
pnpm test
```

The pilot shows issuance, verification, neutral facts, and expiry.
`own-world.ts` is the next step: a world of your own — organization, sites,
teams, grants, and policy — defined with `defineWorld`, booted, switched, and
verified. The consumer pin is in [`../publishing.md`](../publishing.md).

## When not to use it

- Your access model is group membership and ACLs all the way down.
- You need LDAP search, schema extension, referrals, trusts, or replication.
- You need group grants, nested groups, deny, hierarchy, SoD, delegation,
  temporal validity, or obligations.
- You need immediate revocation of already-issued decisions.
- You need standard JWT/JWKS middleware rather than a custom envelope.
- You cannot run the Cloudflare reference runtime and do not want to build a
  durable authority adapter.

## Current limits for an AD shop

- No LDAP, SAML, or SCIM connector; OIDC only.
- The live `cloudflare-v0.6.1` verifies ES256 and RS256. Check the provider's
  signing algorithm before a pilot.
- One action hat per envelope, and read/config/member reach are separate
  issuer-computed layers over wearable grants; the layers are named in
  `authority_redesign.md` § Access.
- The envelope is not a JWT; every downstream service needs the verifier and
  the distributed key set.
- Production is Cloudflare-only; the in-memory engine is for tests and
  examples.

## Read next

- [`../positioning.md`](../positioning.md) — current positioning and
  comparisons.
- [`../authority_redesign.md`](../authority_redesign.md) — the architecture.
- [`../tutorial.md`](../tutorial.md) — the longer walkthrough.
- [`README.md`](README.md) — the four audiences and what to show each.
