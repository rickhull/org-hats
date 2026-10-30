# Authority — the invariants of the seam

Distilled from `docs/authority_redesign.md` and held by `src/authority`,
`src/access`, and both runtimes. Ids are stable; see the
[README](README.md) for the protocol.

### A1 — Authentication never creates authority

Evidence resolves an actor or fails. Actors, participation, and hats change
only through explicit, audited acts. Commands are idempotent; return-once
activation issuance rotates on retry and creates no authority by itself.

*Held by:* the runtime surface — no write path begins at evidence;
`OH-CMD-02` pins asking-is-not-admission, and `OH-PART-02` pins terminal
revocation.
*If it breaks:* admission becomes a property of the identity provider, and
the consumer's no-self-registration posture loses its structural guarantee
— it reverts from "no write path exists" to "every write path remembers
the rule".

### A2 — One writer for each fact

Every mutable fact has exactly one authoritative owner — organization
authority, operation authority, or the host — and work spanning two owners
is a retryable workflow with visible partial states, never a transaction.

*Held by:* the two-coordinator design; outboxes with visible pending state
and alarms in both runtimes; the export/restore drill per coordinator.
*If it breaks:* dual writes appear, organization and operation state gets silently
overwritten by platform configuration, and reconciliation loses its
per-fact owner to appeal to.

### A3 — The seam serves use cases, not storage

Callers receive complete use cases — issue from evidence, refresh, context,
command, and the three activation lifecycle calls — and never a grant query,
a row, or a repository.

*Held by:* `AuthorityRuntime` is the only public surface; the conformance
inventory runs through the public surface exclusively.
*If it breaks:* the seam shallows into a repository, and ordering, policy
application, audit, and projection coordination move back to every host —
the v0.4 posture the redesign closed.

### A4 — The failure taxonomy is closed

Nine kinds, enumerated once in `src/contract.ts`. A new kind is an
interface-version change, and the product response to every kind belongs
to the deploying host.

The call boundary carries one distinction the kinds do not: provider
verification is the host's own step, and the authority is called only after
it succeeds. `unauthenticated` from `accessFromEvidence` therefore means
verified evidence that resolves to no principal link; a failure before that
call means nothing was verified. Hosts distinguish the two by which step
failed, not by reading `detail`; `detail` is a human sentence, not a second
taxonomy.

*Held by:* the closed `FailureKind` union shared by both surfaces; the
consumer maps every kind or fails its contract test.
*If it breaks:* a release introduces a failure no consumer has a response
for — an unnamed failure becomes a product decision nobody made.

### A5 — Reach is computed by the issuer, never reconstructed by the verifier

The issuer computes read reach under the active policy bundle before
signing; the verifier compares ids and evaluates the selected hat locally,
and never rebuilds organization unions, peer reach, fallback, or worn-hat
rules. A verifier that accepts a key is trusting that issuer's computation:
the signature proves provenance and integrity, not that policy was
independently re-derived.

*Held by:* the access module's shape — `NeutralAccess` offers predicates
over signed facts and nothing else; the signature gate and key set;
`OH-AUTH-01`.
*If it breaks:* every verifier becomes a second implementation of policy,
and issuer/verifier drift becomes a per-deployment property — or a verifier
believes it validated policy it never computed.

### A6 — Authentication facts travel opaquely

`amr` and `auth_time` are copied from evidence at issuance, preserved
unchanged through refresh while `iat` moves, surfaced on the context, and
never interpreted by authority. Absence is carried as absence. Refresh
establishes current authorization eligibility (A13), not a renewed
authentication event; neither `iat` nor refresh time is evidence about
`auth_time`.

*Held by:* both engines copy the facts without reading their values;
refresh records carry them through the chain; `OH-AUTH-06`.
*If it breaks:* either authority starts interpreting host vocabulary —
step-up policy forks per issuer — or the facts go stale across refresh,
which is precisely the silent failure `auth_time` exists to close, or a
host reads a fresh envelope as fresh authentication.

### A7 — Refresh handles die with the authority that issued them

A revoking command kills the refresh records it affects: in the same commit
within one coordinator, or through the durable outbox across coordinators.
The outbox is durable but not instantaneous: a refresh already in flight when
a revocation commits may issue one further envelope. The resulting authority
remains bounded by E7, and the next refresh observes the revocation —
through A13's live organization read for a disable, and the revoked record
otherwise — so the chain does not continue. Issuance always states the
handle outcome; a host never infers session state.

```js spec=A7 traits=portable,smoke
// sam is the Harbor crew actor; the harness disables with the Harbor administrator.
const s = await spec.world();
const issued = await s.issue("sam");
const disabled = await s.disable("sam");
spec.expect(disabled.ok, "disable applies");
spec.expectFailure(await s.refresh(issued), "unauthenticated", "the revoked handle is dead");
```

*Held by:* revoke/disable/participation-revoke paths in both runtimes;
`OH-AUTH-04`, `OH-AUTH-05`, the participation cases; the A13 refresh gate;
the Cloudflare refresh's transactional consume-and-install, with the
concurrent-refresh case pinning one winner; the A7 executable example.
*If it breaks:* a revoked actor keeps an endless session and the bounded
revocation window of E7 becomes an unbounded one.

The host-side carriage that depends on this rule is
[`docs/consumer-session.md`](../docs/consumer-session.md).

### A8 — An idempotency claim commits with its mutation

For every idempotent command, the claim and the fact land in one transaction;
a denial never poisons its key, and a reused key with a different payload is
named misuse. Activation issuance is not a command and takes no key: retry
rotates the secret because authority retains only its digest.

*Held by:* claim tables co-committed with every mutation in both runtimes;
`OH-CMD-01`.
*If it breaks:* retries double-apply or lock an actor out of their own
idempotency keys; safe retry stops being a property of the seam.

### A9 — Administration is declared policy, never a hardcoded title

Which role titles administer an operation is runtime configuration. Which
actors administer an organization is organization data: the configured
record seeds standing at bootstrap, and from then on the organization
appoints and retires its own administrators through typed commands.

*Held by:* `adminRoles` for operation titles; administrator standing in
organization state, written by `appoint-administrator` and
`retire-administrator` under fresh administrator evidence; the authorization
cases assert denials for non-administrators.
*If it breaks:* administration becomes a hardcoded title, or an organization
cannot appoint or retire its own administrator without a deployment.

### A10 — Evidence is never a roster

A principal link resolves one `(organizationId, actorId)`; no provider
claim links two actors, and equal mail-shaped subjects never merge them.

Links enter through explicit bootstrap, activation acceptance, or the typed
organization-authority ops surface; roster commands name an actor explicitly
and create no link, so a created actor stays unlinked until evidence is
accepted. Every Cloudflare writer passes through a
deterministic subject guard whose scan-and-bind critical section stays
exclusive across organization calls. A bind that would resolve the subject
to a different actor is refused, and a cross-organization ambiguity fails
`unavailable` until an operator resolves it. The authority stores no unlinked
evidence; a refused first login is the host's audit material.

*Held by:* no provider claim links actors — evidence carries identifying
and authentication facts only; `linkPrincipal` and bootstrap check the
existing link and actor before mutating; `PrincipalSubjectGuard` serializes
the directory check and target commit for manual bind and activation;
`tests/ops.test.ts` and `organization.test.ts` pin the conflicts; the
Cloudflare runtime's directory refuses a `(provider, subject)` found in more
than one organization (`packages/cloudflare/test/runtime.test.ts`); the
twins keep actors organization-scoped.
*If it breaks:* a platform-global person record appears by the back door,
and removing an actor from one operation starts affecting another.

### A11 — The portable seam is evidence-only

No provider credential, authorization code, or provider-issued secret crosses
the portable `AuthorityRuntime`; the exchange that turns a provider callback into
evidence is runtime surface, supplied per deployment.

*Held by:* `PrincipalEvidence` carries identity and authentication facts
only — nothing a provider issued; the exchange lives in
`packages/cloudflare/src/exchange.ts`, not under `src/`; the identity
boundary in `docs/authority_redesign.md`.
*If it breaks:* provider secrets enter the portable modules and the fence
of P1 loses its meaning for identity, or every host grows a second OIDC
implementation — the drift the boundary exists to prevent.

### A12 — Routing facts are authority-owned

The operation slug and each site's canonical path are operation-authority
facts. The registry is their projection; a tracked manifest or a derived
copy is not a second writer. Operation authority validates one DNS label for
the slug, one path segment per site, local path and alias uniqueness, and
alias/slug collisions. Deployment-wide slug uniqueness and the applied
routing projection stay registry checks because authority has no global
directory.

*Held by:* the operation schema's `slug` and `path` columns and canonical
export; `POST /ops/operation/routing-facts` as a full-set backfill; the
registry bootstrap's projection validation; the routing cases in
`tests/model.test.ts`, `tests/twins.test.ts`, and the Cloudflare coordinator
suite. Rename history is not carried yet, so a rename stays ops-only and the
route is not a rename act.
*If it breaks:* a hand-maintained routing manifest becomes authority, and a
rename can leave the registry serving an address authority no longer names.

### A13 — Refresh re-resolves the actor at the organization

A refresh handle is not by itself authority to reissue. Before issuing a
replacement, the runtime resolves the actor's existence and disabled flag at
the organization; missing or disabled fails closed, and an organization that
cannot answer fails closed. The roster projection is not the revocation
promise.

Disable and refresh share no transaction and have no global linearization
point: a refresh that read the organization before a disable commits may
issue another envelope, and the next refresh is refused. The guarantee is
envelope expiry (E7) plus this read on every refresh, not an atomic ordering
of the two coordinators.

*Held by:* the Cloudflare operation refresh's organization read; the
in-memory engine's live organization lookup; the lost-disable refresh case in
`packages/cloudflare/test/roster.test.ts`.
*If it breaks:* a lost roster push becomes indefinite refresh authority, and a
disabled actor keeps a session past the envelope lease.

### A14 — The projection names its layers

The envelope's selected action hat bounds the actions `mayAct` evaluates.
Read reach, configuration reach, and member reach are separate, issuer-computed
layers over the actor's wearable grants; the verifier compares each layer's
ids and never derives one layer from another. The hat is not claimed to bound
all authority, and it authorizes no authority command: commands are checked
at the runtime against standing and their declared fresh-evidence or envelope
mode, never against the hat's actions.

*Held by:* the claims shape (`hat`, `readableOrganizationIds`,
`readableTeamIds`, `configurableSiteIds`, `memberTeamIds`),
`assembleAccessClaims`, `NeutralAccess`, the access/claims suites, and the
command handlers' standing and fresh-evidence checks (A9).
*If it breaks:* "one hat at a time" becomes an overclaim, a host cannot
name the layer a decision came from, or a host treats a product action as
permission to mutate authority.

### A15 — Access requests are a queue, not an admission relation

`request-access` records a request; `admit` records a review and a note.
Neither establishes an authority relation. The grant is the operation's
operative acceptance, and wearability checks the actor, participation, and
revocation — never an admission table.

*Held by:* the `request-access`/`admit` handlers and their tests;
`wearableGrants`; `tests/engine.test.ts`.
*If it breaks:* the docs claim an enforced admission relation the code does
not have, and a queue review becomes mistaken for authority.

### A16 — Activation is return-once and metadata-minimal

An activation request names an existing actor and stores only a secret digest
and lifecycle timestamps. Inspection reveals only usability. Acceptance
derives the actor from the secret, binds verified evidence once, and creates
no actor, grant, participation, or administrator standing. Issuance retry
rotates rather than replaying plaintext.

*Held by:* the three activation methods in both runtimes; organization
activation-request storage; `tests/activation.test.ts` and the Cloudflare
organization/runtime cases.
*If it breaks:* activation becomes self-registration, a roster oracle, or a
plaintext-secret recovery store.

### A17 — Teams are operation data fielded by one organization

A team is anchored to exactly one site and one organization, and operation
authority is its only writer. An organization requests a team; an operation
administrator admits it. Retirement tombstones the team and revokes the grants
and refresh authority that stood on it; a snapshot only ever sees active
teams.

*Held by:* team status in operation state, the active-only projection, and
the four team commands' authorization split (`request`/`update` by the owning
organization's fresh evidence, `admit`/operation retirement by an operation
administrator).
*If it breaks:* an organization fields teams without the operation's
admission, or a retired team keeps granting reach.
