# Authority subsystem redesign

**Status:** Normative architecture for the v1 authority subsystem. It states
the shape and the settled interfaces; the v1 delivery plan is realized and
retired, and the decisions still open are recorded at the end of this
document.

This repository is the normative source for the authority seam. The consuming
product's architecture document states consumer requirements and deployment
illustrations; it does not define `org-hats` methods, result types, packages,
persistence interfaces, or compatibility policy. Terminology is normative in
[lexicon.md](lexicon.md); this document uses those terms. `main`
implements this architecture; legacy `v0.4` content lives at its
tags.

## Purpose

Quartermaster needs more than isolated authorization predicates. It needs an
authority subsystem that owns organizational state, applies authority rules in
the right order, records changes, and issues a compact projection that the
reporting application can verify locally.

At the same time, `org-hats` should remain useful outside Quartermaster. Its
organizational model is not inherently tied to Cloudflare, Durable Objects, or
Reporting.Stream. The redesign therefore has two goals:

1. preserve a small, portable library that can be reused in other systems; and
2. provide a well-supported Cloudflare implementation that makes the intended
   operational shape easy to adopt without making it mandatory.

The governing posture is:

> Portable semantics, Cloudflare paved road.

Cloudflare is the reference deployment and receives first-class tooling. It is
not part of the organizational model and is not required by the portable
interfaces.

## Decision summary

The repository will contain four logical modules arranged in two distributable
layers:

```text
org-hats
  ├── core          pure organizational model and decision rules
  ├── authority     portable authority engine and use cases
  └── access        portable verification of signed access projections
          │
          ▼
org-hats-cloudflare
  └── Cloudflare adapters, runtime entrypoints, storage, and operations tooling
```

The public package names are `org-hats` and `org-hats-cloudflare`; the exact
portable subpath names can be settled during specification. The important
decision is the dependency direction: Cloudflare depends on the portable
modules, and the portable modules never depend on Cloudflare.

The existing `org-hats` package remains published at its pinned versions, but
it is not an evergreen compatibility anchor: the authority redesign crosses
one clean pre-1.0 version boundary with a migration note. The root export
again provides the generic model (landed: `src/model.ts`), and the authority
engine and access verifier are separate subpath exports — `./authority` and
`./access`, settled by the specification pass. Cloudflare support should
be a separate package so that Cloudflare types, tooling, and dependencies never
enter a generic consumer's installation or compilation path.

## Design principles

### Complete use cases at the external seam

Application callers should ask the authority subsystem to perform a business
act or answer a complete authority question. They should not receive a grant
repository and reconstruct decisions themselves.

The current `OrgHatsRepository` is useful as a small library interface, but it
is too shallow to be Quartermaster's long-term seam. It leaves request
ordering, mutations, policy application, audit, sessions, and projection in
the host. The redesigned authority module owns that coordination.

### Runtime-neutral semantics

The core model, state transitions, commands, decisions, and access-envelope
meaning must be expressible without Cloudflare types. No portable interface
mentions Workers, bindings, Durable Objects, alarms, Wrangler, `Request`, or
`Response`.

### Operational guidance without false portability

The project will not build an abstraction for every Cloudflare feature. It
defines only the surface the portable authority engine actually needs, such
as atomic state changes, time, signing, and durable outbox work. Cloudflare
adapters implement that surface directly.

Another runtime is supported when it can provide equivalent guarantees; it
does not need to resemble Durable Objects internally. The project may describe
non-Cloudflare adapters without promising equal tooling or operational support.

### One writer for each fact

Each mutable fact has one authoritative owner. Repository manifests may create
bootstrap state, but ordinary deployment does not overwrite customer-managed
state. Reporting data does not become authority data, and authority data does
not move into Quartermaster's reporting objects.

### The interface is the test surface

Conformance cases exercise the same portable interfaces used by real callers.
Adapters prove that they preserve the portable semantics. Quartermaster tests
its wiring and product policy rather than maintaining a second implementation
of authority rules.

## Logical modules

### Core

The core is the smallest reusable statement of the organization model. It
owns:

- actors, organizations, operations, sites, teams, roles, and hats;
- grants, actions, reach, access requests, and worn-hat selection;
- operation-local authority and organization-local actor identity;
- policy-bundle validation and decision reason values;
- pure state-machine transitions and invariant checks where those transitions
  are independent of storage; and
- the portable conformance inventory.

The familiar rule remains visible inside the model:

```text
may act = role carries the action x grant reaches the target
```

It is an implementation rule, not the primary interface presented to
Quartermaster.

The core has no runtime dependencies, performs no I/O, and imports no database,
web framework, identity provider, or cloud SDK. A compiler fence should
continue to enforce this rather than relying on review alone.

### Authority

The authority module is the portable, deep module. It turns core rules into
complete organizational use cases. It owns:

- organization actors and their lifecycle;
- links from verified external principals to organization actors;
- organization participation in multiple operations;
- sites, teams, roles, policy versions, hats, and grants within an operation;
- invitations, acceptance, access requests, grant, revoke, and hat
  selection workflows;
- idempotency, audit facts, and explicit partial states for multi-owner
  workflows;
- refresh/session authority and access-projection issuance; and
- versioned snapshots, invariant probes, and canonical export semantics.

Its public interface expresses use cases rather than storage operations.
The specification pass is done: the normative surface is
`src/authority/types.ts` (`AuthorityRuntime`), shipped from the
`org-hats/authority` subpath alongside the in-memory engine that implements
it. The properties that matter:

- `accessFromEvidence` takes typed, verified principal evidence bound to an
  operation and returns an `AccessIssue` — the signed envelope plus the
  explicit refresh-handle outcome (kept, rotated, revoked) together, so a
  host never infers session state;
- `refresh` returns the same pair and revokes affected refresh records in
  the same commit as a grant change;
- `context` yields presentation facts for the envelope's actor;
- `command` executes a typed, idempotent command — "access request" keeps
  its organizational meaning and is never an issuance input's name.

Commands are typed discriminated unions with consistent results and error
semantics. Mutating commands carry an idempotency key derived from the
caller's intent; the claim commits with its mutation, so a denied command
cannot poison its key. The authority module validates a complete command
before committing it. The session and command surfaces share one closed
failure taxonomy — unavailable, unauthenticated, not-admitted, expired,
wrong interface version, wrong operation/site binding, invalid signature,
invalid-command, denied — documented kind by kind in `src/contract.ts`; the
deploying host owns the product response to each, and new failure kinds are
interface-version changes.

Persistence interfaces are internal seams of the authority module in the
first version. The in-memory adapter shipped with `org-hats` and the
Cloudflare adapter shipped with `org-hats-cloudflare` live in one repository
and exercise the same internal conformance inventory; no adapter SPI is
published and no adapter compatibility matrix is maintained. Application
callers cannot query grants or write rows through these seams. A public
adapter interface is justified only by a second committed runtime
implementation with a real author.

### Access

The access module is a small, verification-only consumer module. Its
interface is specified and shipped: `NeutralAccess` in
`src/access/types.ts`, produced by `verify` in `src/access/verify.ts`, from
the `org-hats/access` subpath. The vocabulary is fixed and domain-neutral:
operation and site binding, the selected hat's actions over a neutral
target, the organization and exceptional team ids readable under the active
policy, configuration reach, the teams the actor's wearable grants reach,
how and when the principal authenticated, and the session's stable actor
identity. The module never names a product entity;
product verbs — a host's `mayReadReport`, for example — are host code in a
thin module that maps product facts onto these neutral targets. The
important properties are:

- callers do not interpret raw claims;
- verification gates on the envelope format and version pair, then checks
  the signature, expiry, operation, and site binding before returning
  access; the claims' `interfaceVersion` is issuer provenance, not a gate,
  because the envelope outlives the interface that issued it;
- read reach is computed by authority from the active policy bundle before
  issuance; the verifier evaluates binding and the selected hat locally and
  never rebuilds organization unions, peer reach, fallback, or worn-hat rules;
- the projection contains permanent identifiers and only the compact facts
  needed for local product decisions; and
- an unsupported envelope version fails closed.

#### The layered projection

The envelope carries four named layers, not one:

- the selected **action hat** — the role and actions `mayAct` evaluates;
- **read reach** — the readable organization ids and exceptional team ids,
  computed by the issuer under the active policy;
- **configuration reach** — the sites where the holder may configure;
- **member reach** — the teams the actor's wearable grants reach
  (`memberTeamIds`, a historical name).

The hat does not bound the other three. Each is issuer-computed from the
actor's wearable grants and compared by the verifier; none is derived from
another. A host reads the layer its decision belongs to. The grant is the
operation's operative admission; access requests are a review queue, not a
stored relation. Formal and threat models are not claims in this line.

The module uses portable cryptographic interfaces or Web Platform primitives.
It does not know how sessions are transported and does not import Cloudflare
bindings.

### Cloudflare expansion

The Cloudflare package is the reference operational implementation. It owns:

- the authority Worker and its typed runtime entrypoint;
- organization-authority and operation-authority Durable Object classes;
- Durable Object SQLite schemas, migrations, transactions, and indexes;
- alarms, durable outboxes, retries, and bounded housekeeping;
- signing-key storage and rotation adapters;
- identity-provider adapters and browser-protocol helpers where useful;
- an authenticated, narrow operations entrypoint;
- bootstrap, schema status, export, restore, and invariant-check tooling;
- Wrangler templates, binding declarations, local-development support, and
  deployment documentation; and
- integration tests using the real Cloudflare runtime rather than mocks.

The runtime uses only the standard Durable Object surface — SQLite storage,
alarms, namespace and service bindings, and Web Crypto. It does not depend on
proprietary bindings (R2, KV, D1, AI, Vectorize, Hyperdrive, Browser
Rendering, or the Cache API), so a self-hosted workerd-compatible target
remains a deployment choice rather than a redesign. The `AuthorityRuntime`
service binding is also the local-development seam: a local Worker can point
at a deployed authority through a service binding, which a handed-out
namespace cannot express.

It does not own organizational semantics. A rule that affects whether an actor
may act belongs in the portable modules and must be tested there first.

## Identity boundary

Authentication evidence and organizational authority remain distinct.

The portable authority module may own the durable relationship between a
verified principal and an organization actor, along with actor status and the
effect of disabling that actor. It does not implement a browser redirect,
parse an arbitrary provider response, or require a particular identity
protocol.

An identity adapter verifies external evidence and supplies a typed, validated
principal to authority. Two arrangements are supported, and the portable
interface is the same either way: a host may verify evidence itself and
submit typed principal claims, or the identity adapter may run inside the
authority runtime where provider secrets are sealed. In the reference
deployment the provider code exchange executes inside the authority runtime
— organization authority owns sealed identity-provider configuration — so
what crosses the runtime seam during a browser login is provider exchange
material handled by runtime surface, not by the portable interface. The
Cloudflare expansion may provide supported OIDC, passkey, or
local-authentication helpers; those helpers are runtime surface and do not
change the portable seam. Browser redirects, provider callbacks, CSRF and
state handling, and cookies belong to the host. Other hosts may supply
different adapters without changing the authority model.

Authentication facts travel without interpretation. Evidence may state how
and when the principal authenticated — `amr` method references (RFC 8176)
and the authentication timestamp, under the OIDC claim spellings — and
authority carries them opaquely from `PrincipalEvidence` into the signed
envelope claims (`amr`, `auth_time`) and `AuthorityContext`, preserving
them through refresh while envelope `iat` moves. What the values mean and
when they suffice is host step-up policy, never an authority rule.

Authentication never creates participation or a hat implicitly. The grant is
the operation's operative admission; access requests and granting remain
explicit, idempotent, and auditable authority commands.

## State ownership

The reference Cloudflare deployment uses two authority coordinators.

### Organization authority

One organization-authority instance owns the facts that remain stable when an
organization participates in several operations:

- organization presentation and status;
- organization actors and profiles;
- verified-principal links and actor status;
- organization administrators;
- participation invitations and acceptances from the organization's side; and
- identity, roster, and organization-administration audit events.

An actor is addressed by `(organization_id, actor_id)`. Equal email addresses
do not create a platform-global person.

### Operation authority

One operation-authority instance owns operation-local authority:

- participating organization identifiers and participation status;
- the operation's hostname slug;
- sites, their permanent identifiers, canonical paths, and alias labels;
- teams, roles, policy version, hats, and grants;
- operation-local access requests (a review queue) and grants;
- refresh/session authority and access-projection issuance; and
- operation-administration audit events.

The operation slug and site paths are authority facts, not registry-manifest
input: the registry is their projection. Operation authority validates one
DNS label for the slug, one path segment per site, unique paths within the
operation, and alias labels that collide with neither the slug nor another
site. Deployment-wide slug uniqueness and the applied routing projection stay
registry checks because operation authority has no global directory. The
typed routing-facts route is a backfill, not a rename: the operation keeps no
old-name history, so a registry rebuild cannot reconstruct a name authority no
longer holds. Renames, and any self-service surface, wait for a future tag
that carries that history.

Removing an actor from one operation does not remove the actor from their
organization or another operation.

The operation also holds a **projection** of each participating
organization's roster: the authority-relevant tuple only — the actor
identifier and whether the actor is disabled. It holds no display names, no
verified-principal links, and no identity-provider configuration; those stay
with the organization, which remains the only writer of any of it, including
the roster the projection copies.

The projection exists because a decision must be local. Operation authority
answers whether an actor holds a wearable hat, and that answer depends on
whether the actor exists and is enabled — organization-owned facts. A
synchronous read across the two coordinators could not make the answer
atomic (the storage transaction cannot await), so it would buy a
check-then-act window at the price of a second object's availability on
every write. The standing rule instead: **no synchronous cross-coordinator
read on a write path** — a fact a decision needs is projected into the
coordinator that must decide.

The one deliberate exception is **refresh's liveness gate**: before reissuing
from a refresh handle, the operation resolves the actor's existence and
disabled flag at the organization, read-only, and fails closed if the
organization cannot answer. It decides no grant or participation mutation;
it exists because a lost roster push and a lost actor-disabled message must
not turn a refresh handle into indefinite authority. The local projection
still serves command validation.

Two channels keep it true, doing different work:

- the organization **pushes** an image when its roster changes, so a disable
  travels immediately; and
- the operation **pulls** each actively participating organization's roster
  on an interval, which repairs an image whose delivery was lost.

The push carries the security property; the interval is a convergence
budget, never the revocation window. Images are stamped and applied
monotonically, because the outbox may deliver a delayed message after a
newer one and an older image must not resurrect a disabled actor. Revocation
of issued access stays what it was: the actor-disabled message revokes
refresh records, refresh itself re-resolves the actor at the organization,
and an envelope's lifetime bounds the rest.

The projection is derived, so it is not state to back up: a coordinator
export carries the operation's own facts and leaves the projection out, and a
restore clears it and rebuilds by pulling. The failure direction is the safe
one — an actor absent from the projection reads as unknown and issuance
fails closed, never wrongly issued — and the operator's inspection view
reports the projection's contents and age so staleness is visible rather
than inferred.

The projection carries the full roster of actively participating
organizations, which is what keeps the portable model's `Snapshot.actors`
meaning the shared organization directory it has always meant. The model does
not keep a separate admitted relation: the grant is the operative admission,
and `request-access`/`admit` are a reviewed queue. A narrower roster
projection is not part of this line.

Work spanning the two coordinators is an explicit, retryable workflow with
idempotent messages and visible partial states. It is not presented as a
distributed transaction. The organization owns whether its administrator
accepted an invitation; the operation's participation status is canonical for
whether that organization may receive operation authority.

## Quartermaster integration

Quartermaster owns reporting behavior and depends only on the authority
runtime interface and access verifier:

```text
browser
   │
   ▼
Quartermaster Worker
   ├── authority binding ──► org-hats Cloudflare authority runtime
   ├── site objects ───────► reports, resources, attachments, office actions
   └── access verifier ────► local verification and product predicates
```

Quartermaster owns:

- Reporting.Stream's action vocabulary and role-to-action policy bundle;
- HTTP routes, forms, cookies, and product response policy;
- the browser login protocol — redirects, provider callbacks, CSRF and state
  handling, and cookie transport — while authority resolves typed evidence;
- reports, resources, attachments, and office workflows;
- site-local presentation snapshots retained with historical records; and
- the product response for every closed failure kind, and the choice to map
  unreadable records to `404` or another product response.

Quartermaster does not receive authority storage bindings, grant queries,
Durable Object namespaces, or authority database rows. It does not reconstruct
reach, fallback, participation, or worn-hat rules from envelope claims, and
its product verbs map onto neutral access facts rather than extending them.

The accepted contract is authority interface `2` and access envelope `1`,
recorded in Quartermaster's `specs/login.md`. The portable v2 line and the
Cloudflare reference runtime implement it; the consumer's deployment and
stand-in retirement are tracked in their own plans. Quartermaster's
`apps/authority-dev` and
`packages/access` are temporary stand-ins and are deleted together when the
consumer adopts the runtime binding, so it never grows a second envelope
implementation. The review items that preceded the release are settled in
the shipped contract: `supervisedTeamIds` is absent, the read policy is an axis
structure, `PrincipalEvidence.email` is absent, and the built-in example
worlds use `reviewer` rather than a people-management title.

Ordinary established requests should use a short-lived signed access
projection and reach one reporting object. Login, refresh, authority changes,
and deliberately privileged operations call the authority runtime. The access
lifetime defines a bounded revocation window; operations that require fresher
authority may call authority directly.

## Policy and configuration

The generic modules define how a valid policy bundle is represented and
applied. Quartermaster supplies Reporting.Stream's versioned bundle: actions,
role titles, role-to-action mappings, and relevant read or reach policy. An
authenticated operations command publishes a validated bundle to an operation,
which records the active version. Customer administrators manage assignments
under that policy; arbitrary customer-defined roles or policy rules are not an
initial capability.

The read policy is a structure of independent axes, one per dimension of
reach — not a scalar enum. v1 defines the organization axis
(`granted-teams` or `all-participating`). A team-audience axis is an additive
property of the same structure: it changes neither the bundle format nor the
meaning of the organization axis, and unknown axes fail closed until the
runtime implements them.

The distinction between platform and customer configuration is explicit:

| Configuration | Owner after onboarding |
| --- | --- |
| Organizational semantics and state machines | `org-hats` source |
| Reporting.Stream policy bundle | Quartermaster source |
| Deployed authority runtime | deploying operator: pinned version, instances, bindings, routes, jurisdiction, release cadence |
| Deployment topology and migrations | deploying operator, using runtime-package tooling |
| Bootstrap intent | deploying consumer's protected input, applied once or explicitly reapplied |
| Customer-edited organizations, teams, hats, and labels | owning authority state |
| Real rosters and principal links | organization authority state |
| Secrets and signing keys | deploying operator's secret management or sealed runtime state |
| Verification-key rollout | deploying operator: distribute verify keys first, activate at the issuer second, retain the old key until its last envelope expires |

Bootstrap is a typed, idempotent command with a manifest identifier, version,
and content hash. Reapplying platform configuration never silently restores a
customer-renamed label or revoked grant. Production secrets, customer names,
and real-person rosters do not enter this public repository; real bootstrap
material stays in the deploying consumer's protected, untracked input and
becomes state owned by the appropriate authority object after provisioning.

In this document, source ownership and deployed-state ownership are distinct.
The `org-hats` repository owns the rules and interfaces. A particular
organization- or operation-authority instance owns the mutable customer facts
committed under those rules.

## Portability contract

A non-Cloudflare implementation need not reproduce Durable Objects. It must
provide the guarantees required by the authority engine:

- atomic enforcement of invariants within one state owner;
- stable, opaque identifiers;
- idempotent command claims with payload checking;
- a durable audit record committed with the fact it describes;
- durable outbox or equivalent recovery for cross-owner work;
- a trustworthy clock and cryptographic signer;
- versioned schema migration and canonical export/restore; and
- bounded, observable retry behavior.

An in-memory adapter should ship for fast tests and examples. Additional
production adapters should be added only when a real consumer needs them.
One hypothetical adapter is not a reason to introduce another public seam.
The honest positioning is "portable semantics, one reference runtime": a
non-Cloudflare host inherits the obligations above with a single reference
implementation to study, and packaging and documentation must not imply
drop-in portability.

## Stewardship

The authority engine and its Cloudflare reference runtime remain open source.
This repository must carry a security-reporting and coordinated-disclosure
policy before it protects production data, and consumers pin reviewed commits
rather than floating ranges.

This repository ships source, release artifacts, and deployment templates. It
does not deploy anything: every running authority instance, its pinned
version, bindings, secrets, jurisdiction, rollout, recovery, and
verification-key rotation belong to the deploying operator.

## Packaging and compatibility

The repository may become a workspace, but package layout follows logical
ownership rather than forcing a package per source directory.

The initial distribution target is:

- `org-hats`: the generic root export plus portable `authority`, `access`, and
  `conformance` subpaths; and
- `org-hats-cloudflare`: optional Cloudflare implementation and tooling. It
  lives at `packages/cloudflare` in the same workspace, is private while it
  is a reference runtime, and keeps its own 0.x cadence.

This keeps generic installation free of Cloudflare dependencies while avoiding
an unnecessary family of tiny packages. If independent release cadence or
dependency pressure later justifies splitting the portable subpaths, that is a
packaging change rather than an architectural change.

The redesign crosses a clean pre-1.0 version boundary with a migration note.
The current predicates, request spine, repository port, and Node SQLite
adapter remain available at their pinned versions; Quartermaster is the only
known consumer and pins a commit, so a standing deprecation period, a legacy
adapter matrix, and a permanent compatibility layer would buy no present user
anything. That machinery is added only if a second external consumer makes it
real. New Quartermaster integration should use the authority seam rather than
extending the shallow repository seam.

The compatibility contract is:

- the authority redesign lands as one version boundary with a migration note,
  not as an evergreen support commitment to the v0.x surface;
- the legacy SQLite schema is not silently reinterpreted as authority storage;
- the in-memory and Cloudflare implementations run the same internal
  conformance inventory in this repository; there is no published adapter SPI
  and no pairing matrix to maintain; and
- authority issuers and access verifiers declare projection-version overlap.
  A rolling upgrade first deploys a verifier that accepts the old and new
  versions, then deploys the issuer, and retires the old version only after its
  maximum lifetime has elapsed. Verification keys follow the same order:
  distribute to verifiers first, activate at the issuer second, retain the old
  key until its last envelope has expired.

## Coexistence and cutover

The v0.4 library at its tags and the v1 authority modules can coexist
because they serve different integration seams. A consumer still on v0.4
keeps its root and Node adapter while its new work targets the authority
interface.

They must not both write the same authority facts. A greenfield operation is
created in the new authority store. Moving an existing operation requires an
explicit export/import procedure: stop or fence legacy writes, export and
validate canonical state, import it through the new operations interface, run
invariant and count checks, then switch the caller. Dual-writing is not the
default migration strategy because it would violate the one-writer rule.

Rollback before caller cutover may route the caller back to the legacy path.
After the new store accepts post-import authority mutations, rollback requires
a deliberate reverse migration or a forward repair; it is not a routing
toggle. A focused migration plan must define this procedure before any
existing production operation moves.

## Verification strategy

The shared suite is the executable specification of authority behavior. It
ships as `org-hats/conformance` (`src/conformance.ts`); another runtime runs
the same cases by supplying its own world factory.

Consumers bootstrapping tests should use `CONFORMANCE_WORLD` and
`createInMemoryConformanceWorld()` from `org-hats/conformance`: the authority
subpath carries the types and the example worlds' data, not the principal-link
or org-admin bootstrap. The conformance world returns a built verifier map,
which is right for exercising verification; use `verificationKey()` material
when the test is key-configuration parsing.

A host that is not exercising a built-in example defines its own fixture with
`defineWorld` from `org-hats/authority`. It converts hand-written,
plain-string-id data once and refuses an incoherent world — a policy problem,
an invariant violation, or a fixture carrying other than exactly one
operation — before any runtime boots it.

- table-driven cases cover every allow and denial reason, reach edge, fallback
  order, one organization actor participating in several operations, read
  reach under an active policy bundle, and invite/accept/revoke transition;
- invariant and generative tests cover arbitrary valid state, duplicate
  commands, reordered messages, and partial workflow failure;
- adapter conformance runs the same cases against in-memory and Cloudflare
  implementations;
- fixed vectors cover projection serialization, signing, expiry, key rotation,
  operation/site binding, and version refusal;
- snapshot/restore tests preserve permanent identifiers, pending workflows,
  audit history, and policy versions; and
- Quartermaster contract tests cover its routes, cookies, accepted versions,
  failure-kind-to-product-response mapping, and use of neutral access facts
  rather than claim interpretation.

The pure-module compiler fence remains. A separate fence should prove that the
portable authority and access modules do not import Cloudflare or Node-only
types, and the portable packages' test suites must run green without
Cloudflare, workerd, or a Cloudflare account; runtime-specific integration
stays with the Cloudflare package.

## Delivery sequence

This is sequencing guidance, not approval to begin a rollout. Each slice must
leave the repository buildable and prove behavior through the interface it
introduces.

| Slice | Deliverable | Exit evidence |
| --- | --- | --- |
| Package fences | Source-level `core`, `authority`, and `access` boundaries without publishing new exports | Existing checks pass; portable modules compile without Cloudflare or Node-only types and their suites run without workerd |
| Portable authority | Command/result contract, closed failure taxonomy, internal adapter seams, and in-memory implementation | The synthetic Professional Operation and Festival scenarios pass the shared conformance inventory in memory |
| Access projection | Versioned claims, neutral-access verifier, and fixed vectors | Expiry, key rotation, binding, version refusal, refresh-handle outcomes, and rolling issuer/verifier upgrades pass |
| Consumer pilot | The consumer's login-to-authorized-report slice runs against the in-memory authority through the same interface | The consumer reads no authority rows or raw claims; cookies, neutral-access mapping, and failure responses are proven before persistence hardens the design |
| Cloudflare expansion | Durable Objects, SQLite migrations, alarms, outboxes, runtime and operations entrypoints, and deployment tools | Conformance and recovery tests pass under the real local Cloudflare runtime; the pilot swaps its in-memory binding for the authority runtime with no consumer code change |
| Migration and expansion | Remaining authority flows and any approved existing-operation imports move to the new seam | Per-operation reconciliation passes and the old path has no writers for migrated facts |
| Second-consumer decision | Whether compatibility and adapter machinery become real | Recorded only when a second external consumer or adapter author exists; until then the version boundary stands |

The public conformance inventory uses synthetic structural example worlds —
called twins in the code (`src/authority/twins.ts`) — shaped like
Quartermaster's two concrete design tests: a persistent multi-site
professional operation and a time-bounded, multi-venue festival burst. A
third twin is public history instead — the 1948–49 Berlin Airlift —
carrying the coalition shape the first two do not: a host-nation ground
workforce across several airfields of one operation, secondment as a
crossed grant, and a coalition-wide read board. The
twins carry the structural properties — multi-organization participation,
site independence, short-lived teams, enrollment bursts — that prevent design
for an imaginary generic customer. The real operations, their names, and
their detailed fixtures remain in Quartermaster's private repository and load
through the same public interfaces.

## Explicit non-goals

This design does not require or introduce:

- Cloudflare as a prerequisite for using the generic library;
- a platform-global person record or automatic linking by email address;
- a general policy language, negative grants, or arbitrary role inheritance;
- one deployment, binding, or Worker per customer organization or site;
- raw SQL, generic `exec`, or repository access across the authority seam;
- synchronous transactions across organization and operation state owners;
- immediate revocation for every ordinary reporting request;
- a global transactional customer database;
- Git reconciliation as a second writer of customer-managed facts; or
- speculative adapters for runtimes without a real consumer; and
- a published adapter SPI or adapter compatibility matrix before a second
  committed runtime implementation exists.

## Open decisions for specification

The specification pass settled most of the earlier list into shipped types:
the authority command and result types (`src/authority/types.ts`), the
subpath names (`./authority`, `./access`, the evolved root), the
access-projection encoding and signing (docs/envelope.md, with committed
vectors), the typed shape of principal evidence, and the policy vocabulary
the design twins exercise. The exchange material is settled too: landed as
Cloudflare runtime surface (`evidenceFromProviderCode`), evidence-only,
with the positions recorded in the consumer's login spec. What remains
open:

- the production access lifetime and which privileged commands require live
  authority or fresh authentication — the engine defaults to 900 seconds,
  configurable; the consumer's security review owns the number; and
- a read-only hat: `validatePolicyBundle` rejects a role with zero
  actions, so an auditor (read reach, no act capability) has no natural
  carrier in v1. It arrives with the team-audience axis — the consumer's
  read-audience requirement — not by weakening bundle validation ahead of
  the consumer that needs it.

Those decisions should be made against concrete product flows. They should not
weaken the central shape: a portable, deep authority module with Cloudflare as
its best-supported adapter rather than its hidden foundation.
