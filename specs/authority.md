# Authority — the invariants of the seam

Distilled from `docs/authority_redesign.md` and held by `src/authority`,
`src/access`, and both runtimes. Ids are stable; see the
[README](README.md) for the protocol.

### A1 — Authentication never creates authority

Evidence resolves an actor or fails. Actors, participation, and hats change
only through explicit, idempotent, audited commands.

*Held by:* the runtime surface — no write path begins at evidence;
`OH-PART-02` and `OH-CMD-02` pin asking-is-not-admission.
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
*If it breaks:* dual writes appear, customer-managed state gets silently
overwritten by platform configuration, and reconciliation loses its
per-fact owner to appeal to.

### A3 — The seam serves use cases, not storage

Callers receive four methods — issue from evidence, refresh, context,
command — and never a grant query, a row, or a repository.

*Held by:* `AuthorityRuntime` is the only public surface; the conformance
inventory runs through it exclusively.
*If it breaks:* the seam shallows into a repository, and ordering, policy
application, audit, and projection coordination move back to every host —
the v0.4 posture the redesign closed.

### A4 — The failure taxonomy is closed

Nine kinds, enumerated once in `src/contract.ts`. A new kind is an
interface-version change, and the product response to every kind belongs
to the deploying host.

*Held by:* the closed `FailureKind` union shared by both surfaces; the
consumer maps every kind or fails its contract test.
*If it breaks:* a release introduces a failure no consumer has a response
for — an unnamed failure becomes a product decision nobody made.

### A5 — Reach is computed by the issuer, never reconstructed by the verifier

The issuer computes read reach under the active policy bundle before
signing; the verifier compares ids and evaluates the selected hat locally,
and never rebuilds organization unions, peer reach, fallback, or worn-hat
rules.

*Held by:* the access module's shape — `NeutralAccess` offers predicates
over signed facts and nothing else; `OH-AUTH-01`.
*If it breaks:* every verifier becomes a second implementation of policy,
and issuer/verifier drift becomes a per-deployment property.

### A6 — Authentication facts travel opaquely

`amr` and `auth_time` are copied from evidence at issuance, preserved
unchanged through refresh while `iat` moves, surfaced on the context, and
never interpreted by authority. Absence is carried as absence.

*Held by:* both engines copy the facts without reading their values;
refresh records carry them through the chain; `OH-AUTH-06`.
*If it breaks:* either authority starts interpreting host vocabulary —
step-up policy forks per issuer — or the facts go stale across refresh,
which is precisely the silent failure `auth_time` exists to close.

### A7 — Refresh handles die with the authority that issued them

A revoking command kills the refresh records it affects: in the same commit
within one coordinator, or through the durable outbox across coordinators.
Issuance always states the handle outcome; a host never infers session
state.

*Held by:* revoke/disable/participation-revoke paths in both runtimes;
`OH-AUTH-04`, `OH-AUTH-05`, the participation cases.
*If it breaks:* a revoked actor keeps an endless session and the bounded
revocation window of E7 becomes an unbounded one.

### A8 — An idempotency claim commits with its mutation

The claim and the fact land in one transaction; a denial never poisons its
key, and a reused key with a different payload is named misuse.

*Held by:* claim tables co-committed with every mutation in both runtimes;
`OH-CMD-01`.
*If it breaks:* retries double-apply or lock an actor out of their own
idempotency keys; safe retry stops being a property of the seam.

### A9 — Administration is declared policy, never a hardcoded title

Which role titles administer an operation and which actors administer an
organization are runtime configuration, not code.

*Held by:* `adminRoles`/`orgAdmins` on the engine, `/config` on the
coordinator; the authorization cases assert denials for non-administrators.
*If it breaks:* an operation cannot appoint or retire an administrator
without a release, and the grant/revoke workflow's own gate becomes
unmovable.

*Held by:* `PrincipalEvidence` carries identity and authentication facts
only — nothing a provider issued; the exchange lives in
`packages/cloudflare/src/exchange.ts`, not under `src/`; the identity
boundary in `docs/authority_redesign.md`.
*If it breaks:* provider secrets enter the portable modules and the fence
of P1 loses its meaning for identity, or every host grows a second OIDC
implementation — the drift the boundary exists to prevent.

### A10 — Evidence is never a roster

A principal link resolves one `(organizationId, actorId)`; no provider
claim links two actors, and equal mail-shaped subjects never merge them.

*Held by:* no provider claim links actors — evidence carries identifying
and authentication facts only; links are explicit bootstrap material, and a
conflicting re-link is refused at both bootstrap layers (`scenarios.test.ts`
pins it); the twins keep actors organization-scoped.
*If it breaks:* a platform-global person record appears by the back door,
and removing an actor from one operation starts affecting another.

### A11 — The portable seam is evidence-only

No provider credential, authorization code, or secret crosses the portable
`AuthorityRuntime`; the exchange that turns a provider callback into
evidence is runtime surface, supplied per deployment.
