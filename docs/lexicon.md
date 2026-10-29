# Lexicon

*The words this repository uses for the organizational authority model, and
the words it deliberately does not. These definitions are normative for code,
docs, issues, and fixtures; the architecture is
[authority_redesign.md](authority_redesign.md) and the wire format is
[envelope.md](envelope.md).*

A term with an _Avoid_ line means: use this word for this concept, and the
listed words name something else or invite an assumption the model rejects.
Definitions state what a thing **is**, not how it is implemented.

## The organization model

**Organization** — The durable body an actor belongs to and a team is
fielded by. It participates in many operations; no operation owns it.
_Avoid_: tenant, customer, account, realm

**Operation** — The scope in which authority is exercised: an undertaking
with its own sites, teams, policy version, and grants. An operation may be
bounded or persistent.
_Avoid_: project, event, workspace

**Actor** — A durable organization-scoped identity, addressed by
`(organizationId, actorId)`. The same real person in two organizations is two
actors; there is no platform-global person.
_Avoid_: user, member, account, person (unless naming the real-world referent)

**Principal** — The external subject an identity provider or adapter vouches
for before it is resolved to an actor. Evidence names a principal; a
principal link binds it to an actor.
_Avoid_: identity (when you mean the external subject)

**Participation** — An organization's relationship to an operation:
`invited`, `accepted`, `active`, or `revoked`. The operation's record is
canonical for whether the organization may receive authority there.
_Avoid_: membership (for the organization–operation relation)

**Admission** — An operation accepting an actor to act there. In this line
the grant is the operative admission; access requests are a reviewed queue,
not a stored relation. Admission is neither authentication nor participation:
an organization may participate while a particular actor is not admitted.
_Avoid_: signup, registration, enrollment

**Access request** — A person asking an operation to be admitted. It is an
authority command, never an issuance input, and it does not create a grant.
_Avoid_: login request, token request

**Team** — An organization-fielded unit anchored to exactly one site. A
team is not a role and not a roster record.
_Avoid_: group, squad, department

**Site** — A place at which an operation does work, with a permanent id and
optional routing aliases.
_Avoid_: venue, location, scope, path

**Alias** — A routing name for a site. Aliases decorate; ids resolve.
_Avoid_: slug (as the identity), scope path

## Policy and reach

**Action** — An opaque verb named by the policy bundle, for example
`review`. The bundle maps roles to actions; actions are not product nouns.
_Avoid_: permission, capability, privilege

**Role** — A policy title and the actions it carries. A role is data in the
bundle — not an entity, and not a person.
_Avoid_: position, job title

**Grant** — The operation-local fact that an actor holds a role over one
target: a team, or a site and its teams. A grant is held; it is not the hat
currently worn.
_Avoid_: assignment, membership (when you mean a grant)

**Hat** — The grant an actor wears when acting: one role, its actions, and
its target. Exactly one action hat is active per envelope; read,
configuration, and member reach are separate issuer-computed layers over
wearable grants.
_Avoid_: session role, active role

**Worn / selected** — The hat currently activated for an act. Authority
selects it from the actor's wearable grants; a host never chooses one
implicitly.
_Avoid_: active (unspecified), default (as an unqualified noun)

**Wearable** — A held grant authority will let the actor wear here: not
revoked, actor enabled, and the organization's participation active. Reach is
a separate question.
_Avoid_: available, valid

**Reach** — Where a grant may act: its own team, or its site and every team
at that site. Nothing reaches a whole operation, and reach has no hierarchy,
prefix coverage, or inheritance.
_Avoid_: scope, coverage, subtree

**Read reach** — The organization ids, and exceptional team ids, whose work
the issuer computes as readable under the active policy bundle. It is an
issuer fact, not a verifier reconstruction.
_Avoid_: visibility, audience (when you mean the computed result)

**Policy bundle** — The versioned data an operation runs: action vocabulary,
roles, and the read policy.
_Avoid_: configuration (unqualified), rules (unqualified)

**Read policy** — A structure of independent reach axes. v1 has the
organization axis (`granted-teams` or `all-participating`); a team-read
axis is additive later, as a scope rather than an expanded team list.
_Avoid_: read mode (as a scalar)

**Administration** — Acting with a policy action that configures the
operation. Administrative roles are configuration, never a hardcoded title.
_Avoid_: admin (as a built-in role)

## Access

**Evidence** — A typed assertion from a verified identity provider or
adapter: provider, subject, and presentation-only display name. Evidence is
not a roster and grants nothing by itself.
_Avoid_: credentials, user info, claims (for evidence)

**Access envelope** — The signed, versioned projection of authority facts an
issuer hands to a host. It is opaque to product code and verified by the
access module.
_Avoid_: token, JWT, cookie (an envelope may travel in a cookie; it is not
the cookie)

**Claim** — A field inside the signed envelope.
_Avoid_: assertion, attribute

**Access issue** — The pair returned by issuance or refresh: a new envelope
and the explicit refresh-handle outcome.
_Avoid_: login result, token bundle

**Refresh handle** — An opaque handle authority hashes at rest and resolves
only itself; its outcome is `kept`, `rotated`, or `revoked`.
_Avoid_: refresh token

**Session** — The host's continuity of a signed-in actor across envelopes and
refreshes. org-hats issues envelopes and refresh handles; it does not own the
host's session transport.
_Avoid_: server session (for authority state)

**Issuer / verifier** — The authority runtime signs an envelope; the access
module verifies one. Neither role is a product entity.
_Avoid_: auth server, token service

**Binding** — The operation, and optionally the site, an envelope is bound
to. A verifier checks the caller's expected binding.
_Avoid_: scope, tenant

**Neutral access** — The verifier's output: operation/site binding, the
selected hat's actions over a neutral target, readable organization and team
ids, configuration reach, and expiry. It names no product entity.
_Avoid_: permissions, claims (for the verified output)

**Target** — Where an act lands, in the neutral vocabulary: the operation, a
site, or a team.
_Avoid_: object, resource

## Runtime seams

**Authority runtime** — The four-use-case external interface:
`accessFromEvidence`, `refresh`, `context`, and `command`.
_Avoid_: service, API (unqualified)

**Command** — A typed, idempotent business act. Its idempotency key claims a
result; a retry returns the claim rather than applying the act twice.
_Avoid_: operation (for a command), mutation

**Failure kind** — One value in the closed failure taxonomy. The deploying
host owns the product response; a new kind is an interface-version change.
_Avoid_: error code, status

**Coordinator** — An internal state owner — organization authority or
operation authority — in the reference runtime. It is not a public seam.
_Avoid_: service, microservice

**Outbox** — The durable record of a cross-coordinator message awaiting
delivery. It makes partial states visible instead of pretending a distributed
transaction exists.
_Avoid_: queue (when you mean the durable outbox fact)

**Example world** — The outward name for a fixture operation a runtime boots
from: one snapshot plus the policy bundle in force. The built-in ones are the
twins; a host's own enters through `defineWorld`. Use this term in
first-contact copy and README material.
_Avoid_: demo data, sample app

**Twin** — A built-in synthetic example world, exported in `TWINS`: the
Professional Operation, the Festival, or the Berlin Airlift. A twin is a
public fixture operation used as executable specification; it carries
structural properties, never customer data.
_Avoid_: twin in first-contact copy; say "example world" or "built-in
fixture" there

**Conformance inventory** — The executable cases in
`org-hats/conformance` that specify portable behaviour through the public
interface. It is not an adapter SPI and not a product test suite.
_Avoid_: harness (when you mean the inventory), integration suite

## Delivery

The release/deploy split is shared vocabulary with Quartermaster, refined
together as the artifact model; the words below are normative here, and a
consumer adopting them adopts the model, not this repository's machinery.
Each producer owns its own release tooling — `bin/` here, `qm` there — and
org-hats is not responsible for any consumer's releases or release
machinery.

- **Delivery** — the umbrella: the five loops of design, implement,
  release, deploy, monitor. A producer faces release; an operator faces
  deploy. The chain across the two repos: our source → tag + publish → a
  published artifact → their adoption → their tag + publish → their
  artifact → their deploy.
- **Artifact** — the immutable output of a release: a package, a runtime
  bundle, a Worker Version. Both producers make artifacts.
- **Release** (noun) — an artifact made immutable and addressable: the
  annotated tag, the artifact it names, and the release record. Here the
  tag families are `vX.Y.Z` and `cloudflare-vX.Y.Z`, cut by `bin/release`
  from a clean, gated `main`.
- **Revision** — a commit that could be released. `bin/check-version`
  names the tag families a revision carries.
- **Gate** — the checks a revision passes to be releasable: `pnpm check`
  locally, `pnpm verify` as the full local gate.
- **Candidate** — a *release candidate*: a revision nominated for release
  but not yet tagged. Downstream, a *released version* is a published
  artifact awaiting its deployer; the two words name different things.
- **Tag** — the release act that names the revision: annotated and
  version-matched. Publication pushes it to the canonical host and the
  mirror; upstream ends at the published release.
- **Publish** (verb) — make a release artifact available to its
  subscriber; producer-side for every producer. org-hats publishes to the
  forge and the mirror, whose audience happens to be the public;
  Quartermaster publishes to its own Cloudflare runtime. Publish is not
  "make public" — the subscriber, not the world, defines it — and it is
  never deploy-side.
- **Release record** — where a release is recorded: the tag message, the
  manifest version, and the gate-cache marker for the tagged commit.
- **Milestone / cadence** — the ritual's rhythm: release when a coherent
  set of changes is gated, not on a timer.

The deploy half is recorded so its absence here is explicit, not
accidental. These are the deploying host's words; this repository's part
ends at the published artifact:

- **Adopt** — consume an upstream release artifact into implementation;
  the consumer's loop between implement and deploy.
- **Consumer** — the project that adopts an upstream artifact; it may also be
  the host that runs it. Its deploy is its own act.
- **Host** — the application a consumer deploys: it carries the envelope in
  its session and owns routes, cookies, and product responses. It is not the
  authority.
- **Deploy** — activate a published artifact in a runtime the operator
  controls. Not an org-hats act; `deploy_runbook.md` records the
  host-neutral shape of the deploy that follows a `cloudflare-v*` tag, as a
  consumer contract.
- **Configuration-only version** — a Worker Version that changes only host
  configuration — the organization directory or the live key set — not code.
  Its tag is the code commit plus a stable digest of that configuration;
  `deploy_runbook.md` owns the rule.
- **Include / cutback / provision / ship** — the deploying host's deploy
  mechanics and their records. None is an org-hats concept or command. The
  authority ops route `bootstrap` seeds declared state and is ours; the
  host's *deployment bootstrap* is a different act.
- **Deployment record** — the operator's evidence of what runs where. The
  release record is ours; the deployment record is theirs.

## Terms to avoid

These words name concepts this repository does not have, or invite an
assumption the model rejects.

- **Supervisor / supervision** — not a model concept and not a fixture role
  title. Authority over people is a host's product concern; role titles are
  opaque data. Use the host's own title, or `reviewer` in the twins.
- **Controller** — a host role title, not an org-hats concept. The model
  knows roles and actions, not who controls whom.
- **User / member / person** — use *actor* for the durable
  organization-scoped identity; reserve *person* for the real-world referent.
- **Permission / capability** — use *action* for the policy vocabulary and
  *reach* for where it applies. `capability` is a retired v0.4 term.
- **Scope / scope path** — retired v0.4 reach vocabulary. v1 reach is
  discrete over teams and sites.
- **Token / JWT** — use *access envelope*.
- **Role as an entity** — a role is policy data; the grant is the entity.
- **Access (unqualified)** — name the access envelope, the access module, or
  the access issue.
