# Personas — who the message is for

*Four audiences. The first two evaluate the model; the third is not deciding
— the goal is that they keep reading, or fund the next conversation. The
fourth is not deciding the model either — they are deciding whether to trust
it with an organization they run, in language that never requires them to
read the model to do so. Current claims and limits are in
[`positioning.md`](positioning.md); this document is audience guidance, not a
roadmap.*

## The one-sentence position

> A portable authority core for organizations that work across many
> operations and sites: one identity, one active hat per session, grants over
> one target, and locally verifiable signed access with a bounded revocation
> window.

## 1. The practitioner — AD/LDAP, sysadmin, developer

**Profile.** Comfortable with AD and LDAP: groups, nested groups, bind DNs,
service accounts, “why is this user in this group?” tickets; some application
RBAC; one work system where this might apply.

**Job to be done.** “One person works in several operations, sites, or
companies; a single role column and a flat group list cannot say who may do
what where. I want the rule to be explicit, testable, and verifiable by the
service that acts on it.”

**What hooks them:** the Dana story (one identity, two operations, two local
hats); the honest limits; `node examples/pilot.ts` and `node
examples/own-world.ts`; **ids resolve and aliases decorate**, unlike
DN-anchored ACLs; verified evidence separated from authority; offline
verification with a bounded window.

**What loses them:** someone else’s world as the only example; jargon without
a gloss; no consumer install line; no LDAP, SCIM, SAML, group-grant, nesting,
or deny story.

**Show them:** the README first screen, `examples/pilot.ts`,
`examples/own-world.ts`, and [`from_ldap.md`](from_ldap.md).

## 2. The access-control academic

**Profile.** Knows NIST/INCITS 359, RBAC96/ARBAC, XACML, ABAC,
ReBAC/Zanzibar, capability systems, delegation/revocation, and audit.

**What earns respect:** the organization/operation split with explicit
participation; factorized grants (one role over one target: a team, or a
site and its teams); issuer-computed read reach and a verifier that never
rebuilds policy; the interface-version vs envelope-version split; named invariants with
“held by” evidence; the executable conformance inventory; the synthetic
examples; migration discipline; the bounded revocation window.

**What blocks a “foundational” claim:** no formal model or threat model; no
constraints/separation of duty, delegation, or temporal semantics; vocabulary
collisions (`operation`, `grant`, `hat`, `principal`, `admission`); and the
fact that `decide` is per-target while issuance selects one action hat. The
layered projection is now named rather than implied, but it is still a
reference architecture, not a theory.

**Citable story:** the architecture, invariants, conformance method, and
versioning discipline for **scoped role activation with signed authorization
projections**; not a new theoretical RBAC variant.

**Show them:** [`authority_redesign.md`](authority_redesign.md),
[`../specs/authority.md`](../specs/authority.md),
[`../specs/envelope.md`](../specs/envelope.md),
[`model_mapping.md`](model_mapping.md), and the inventory in
`src/conformance.ts`.

## 3. The onlooker — junior developer, executive, manager

**Profile.** Not choosing the authority layer. A junior developer is deciding
whether the idea is worth understanding; an executive or manager is deciding
whether to spend a meeting, a pilot, or a budget on it. They may never read
`specs/` and should not be asked to adjudicate the model.

**What intrigues them:** one identity wearing different hats in different
operations; a single rule that fits on a slide; a signed decision that a
service can verify without calling the authority; a bounded window instead of
“eventually revoked”; explicit targets instead of a flat administrator flag. Show the
Dana story and the one-line rule, then the honest limits.

**What loses them:** unglossed terms (`twin`, `grant`, `envelope`), engine
internals, “foundational,” “secure by default,” “drop-in portable,” or a
Cloudflare surprise late in the conversation. Do not turn a first read into a
model review.

**Show them:** the README opening, the pilot’s printed output, the own-world
example, and [`positioning.md`](positioning.md) § Current limits. For a
manager, the one-paragraph position and the non-claims are the page; specs are
appendix material.

## 4. The nonprofit executive director — runs the organization, not the stack

**Profile.** Runs a real organization: program sites, seasonal or volunteer
staff, grant-funded initiatives that start and end, and turnover that
regularly outlasts any one person's institutional knowledge. Has no
engineering staff and no plan to hire one. Is not evaluating "the authority
layer" and may not know the phrase exists — thinks in terms of "our shelter,"
"our chapter," "who's allowed to approve a disbursement."

**Job to be done.** "When our coordinator leaves, the next person shouldn't
inherit access to everything by accident. Someone from another chapter
shouldn't be able to touch our site's records just because we're part of the
same organization. I can't hire a security consultant, and I don't want a
meeting about authorization models — I want to know this is handled."

**What intrigues them:** the Dana story retold without the vocabulary — the
same volunteer helps two programs and doesn't carry the same keys to both; a
plain statement that removing someone's access takes effect quickly and that
nothing lingers past its window; that this doesn't require buying an identity
system they don't have.

**What loses them:** any engineering term shown before its plain-language
translation (`envelope`, `grant`, `hat`, `principal`, `admission`); code
shown before the guarantee is stated; an implication that adopting this
requires hiring a developer; a pitch that assumes they already run SSO.

**Show them:** one paragraph, not the README: *"Everyone who helps your
organization gets exactly the access their current role needs, nothing more
— checked automatically, not by someone remembering to update a list."* Then
stop. If they want more, hand them to the onlooker's materials, not the
model.

## What to show each

| Audience | First artifact | Next | Avoid |
| --- | --- | --- | --- |
| Practitioner | README, `examples/pilot.ts` | `own-world.ts`, `from_ldap.md` | “Twin,” unglossed `grant`/`envelope` |
| Academic | `model_mapping.md`, `specs/authority.md` | conformance inventory, envelope spec | Marketing claims, “foundational” |
| Onlooker | README opening, pilot output | positioning’s limits, own-world | Engine internals, standards claims |
| Nonprofit director | the one-paragraph guarantee, spoken | README opening, *if* they ask for more | Any code, jargon, “you need a developer” |

## Claims and guardrails

- Link [`positioning.md`](positioning.md) § What not to claim; do not
  strengthen a claim in a persona description.
- No customer names, real rosters, or key material. The examples are
  synthetic.
- “One active hat per session” is the action layer, not a claim that the hat
  bounds read, configuration, or member reach.
- The grant is the operative admission; access requests are a reviewed queue,
  not a stored relation.
- Formal and threat models are not claimed; this line stays a reference
  architecture.
- A plain-language translation is still a claim. "Checked automatically" and
  "takes effect quickly" are fine; "immediately," "secure," or "nothing to
  manage" are not — the window is bounded, not instant, and the deploying
  host still owns secrets, versions, and operations.
