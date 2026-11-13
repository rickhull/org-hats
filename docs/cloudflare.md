# The Cloudflare reference runtime

*The `org-hats-cloudflare` package as built: its coordinators, Worker
surface, configuration, and operational lifecycle. It is the reference
deployment of the portable semantics — optional, private, on its own `0.x`
cadence, consumed by deployment through a service binding rather than by
dependency. The portable modules and their contract are
[authority_redesign.md](authority_redesign.md); this document covers what
sits on top of them.*

## Shape: two fact owners, a subject guard, and a Worker

Authority state has two owners, each a Durable Object class with SQLite
storage:

- **`OrganizationAuthority`** (`src/organization.ts`) — the facts that
  stay stable while an organization joins several operations: the
  organization record, actors, verified-principal links, organization
  administrators, activation-request digests and lifecycle timestamps,
  invitations received, audit, idempotency claims, the
  outbox, and the sealed identity-provider configuration (stored
  opaquely; parsed only by the provider-callback exchange).
- **`OperationAuthority`** (`src/operation.ts`) — operation-local
  authority: the operation hostname slug, sites (including their canonical
  paths and alias labels), teams, grants, participation, the policy version,
  refresh records, admission requests, audit, claims, the outbox carrying
  invitations and revocations to organization authority, and the `org_actors`
  projection of each participating organization's roster.

`PrincipalSubjectGuard` is a third Durable Object class but not a fact owner.
It is deterministically addressed by a digest of `(provider, subject)` and
serializes each directory scan plus target bind across awaited object calls.
Every production principal-link writer uses it, including bootstrap binds,
manual operator binds, and activation acceptance. The target organization
remains the durable owner of the link and audit.

The coordinators' table declarations and additive migration chain live
together in `src/schema/`; each step is named and tested against an older
coordinator shape. Their HTTP routes and body parsing live in `src/http/`;
the coordinators keep the use cases and pass a small adapter to the route
modules.

## Adapter-local validators

The coordinators keep the actor/team identifier and display-name checks in
`src/validation.ts` rather than importing the portable authority module's
internal helpers.  Both coordinators apply the display-name rule to every
label a bootstrap carries — organization, operation, site, team, and actor,
long form and short — before opening the transaction, so a refused label
never persists. They are deliberately adapter-boundary rules: the limits
are part of the storage command contract, and the roster and team suites pin
them on both the portable and Cloudflare sides. Sharing the portable
implementation would publish an internal helper for a handful of length
checks. The routing-label and policy validators are shared through
`org-hats` and `org-hats/authority`; these address checks are the documented
exception.

Every mutation commits with its audit event, idempotency claim, and outbox
rows inside one `transactionSync`. Work spanning the two coordinators is a
durable outbox message with a visible partial state and an alarm-driven
retry — never a distributed transaction. A duplicate or mismatched
principal link is refused at bootstrap, and the runtime's evidence
resolution asks the whole directory and fails closed when one
`(provider, subject)` resolves in more than one organization: one identity
is never two actors.

No write path reads the other coordinator synchronously
(docs/authority_redesign.md § State ownership), with one deliberate
exception: **refresh's liveness gate** re-resolves the actor's existence and
disabled flag at the organization before reissuing, read-only and fail-closed
if the organization cannot answer. The projection still serves local command
validation; the gate exists so a lost disable message cannot extend a
session. What the operation needs in order to decide — which actors exist and
which are disabled — arrives as a stamped roster image: pushed when the
organization changes, pulled by the operation every fifteen minutes to
repair a lost push, applied as a monotonic full replace per organization. Operation
bootstrap pulls once, so an operation whose fixture declares active
participations and grants can issue on the next request. `GET
/ops/schema-status` reports `orgActors`, `disabledOrgActors`, and
`rosterSyncedAt` so a stale image is visible rather than inferred, and
`POST /reconcile-rosters` on the operation forces a pull.

## Routing facts

The operation row carries a `slug`; each site row carries a canonical `path`.
Bootstrap requires both, the export includes them, and `/snapshot` and
`/ops/schema-status` expose them. `POST /ops/operation/routing-facts` is a
**backfill** of the full set. It is not a rename: the operation keeps no
old-name history, so a registry rebuild could not reconstruct a name
authority no longer holds; renames stay ops-only until a future tag carries
history. Operation authority validates one DNS label per slug, one path
segment per site, local path and alias uniqueness, and alias/slug collisions;
deployment-wide slug uniqueness is the registry's check.

**`AuthorityRuntimeEntrypoint`** (`src/index.ts`) is the Worker consumers
bind to. Over a `services` binding it exposes the portable
`AuthorityRuntime` methods — `accessFromEvidence`, `refresh`, `context`
(names, wearable hats, and the selected hat from both coordinators),
`command`, `activationRequest`, `activationInspect`, and `activationAccept`
— plus one runtime-only method:

**`evidenceFromProviderCode`** — the provider-callback exchange, the
identity-adapter surface for OIDC logins. The host's callback supplies
exactly what it holds (`operationId`, `issuer`, `clientId`, `redirectUri`,
`code`, `codeVerifier`, `expectedNonce`); the runtime resolves the sealed
provider configuration (JSON `{ issuer, clientId, clientSecret? }`,
installed through organization bootstrap as `sealedIdpConfig`, first
organization in the directory whose configuration matches), performs
discovery, the authorization-code POST, and ID-token verification
(ES256/RS256; `iss`, `aud`, `nonce`, `exp` checked after the signature),
and returns typed `PrincipalEvidence` or a closed failure:
`unauthenticated` for anything the provider or token got wrong,
`unavailable` for a provider that could not be reached, `invalid-command`
for malformed input. Issuance stays `accessFromEvidence` — evidence in,
one verb per crossing. Discovery is cached a day per isolate. JWKS is
cached an hour by default, clamped to the issuer's `Cache-Control` max-age
between one minute and one day; a provider that says "a year" must not
strand a rotation, and one that says "no-store" must not turn every login
into a fetch. A failing signature asks for the current key set once;
repeated forced refetches are floored at 30 seconds and fall back to the
cached set, so a rotation is recovered without turning a stream of bad
tokens into provider traffic.  The host half of this flow —
the redirect, state, nonce, PKCE, and the callback — is
[`consumer-login.md`](consumer-login.md).

Evidence and command authorization read the organization live where the
decision needs it. A disabled actor's fresh evidence is refused
`not-admitted` before a handler runs, even while the operation's projection
still says enabled; one `(provider, subject)` resolving in more than one
directory organization is `unavailable`, not a first-match; and a
coordinator that cannot answer is a closed `unavailable`, never an
exception through the service binding. `request-access` is the exception to
the administrator path: it takes the evidence the command carries, and
needs no administrator.

## Signing and verification keys

The three signing variables travel as a set: **none** means the
development fallback (an ephemeral Ed25519 key per isolate — dev-only;
refusing it in a deployment is the deploying tooling's call, since the
runtime cannot read deployment intent), **a partial set is an error**, and
a full set is **proven a pair at signer construction** — the private half
signs a fixed probe the public half must verify, so a mismatch is an
error at runtime construction (the first request into an isolate), not a
runtime that signs envelopes nothing verifies.

- `AUTHORITY_SIGNING_KEY` — pkcs8, base64
- `AUTHORITY_SIGNING_PUBLIC_KEY` — raw public key, base64
- `AUTHORITY_SIGNING_KEY_ID` — the id that goes into every envelope
- `AUTHORITY_VERIFICATION_KEYS` — the canonical serialized `VerifyKeySet`
  JSON from `org-hats/access`: every key that should verify during a
  rotation

Rotation is verifier-first: install the next key in
`AUTHORITY_VERIFICATION_KEYS` everywhere before the issuer switches, and
remove the old entry after its last envelope has expired. A suspected or
confirmed key exposure follows [key_compromise.md](key_compromise.md), which
removes the compromised key immediately instead of using the normal overlap.

## Configuration

Two Wrangler configs, two purposes:

- `wrangler.jsonc` — the test Worker: the two coordinators plus the
  harness `Counter`, a local-only `OPS_TOKEN` var, and the incremental
  migrations history.
- `wrangler.production.jsonc` — the deploying operator's Worker: both
  coordinators plus the subject guard, the full migration history (`v1`
  coordinators, `v2` guard), no `Counter`, no committed token,
  `workers_dev: false`, no routes. Its `name` is a
  neutral default (`org-hats-authority`), because Wrangler requires one; the
  host supplies its own with `wrangler versions upload --name`, and the
  Worker name is the host's fact, not the tag's. The Worker is
  reachable through its service binding; secrets come from an ignored,
  operator-held file (`wrangler secret put` / `--secrets-file`): the
  signing set above, `OPS_TOKEN`, and `AUTHORITY_ORGANIZATION_IDS` — the
  comma-separated evidence-resolution directory; there is no global
  registry.

An operation carries no identity-provider configuration or reference to one.
The host chooses the provider, and the runtime resolves the sealed
registration from the organization directory by issuer and client id.

The host rule for a configuration-only Worker Version's tag — the code
commit plus a stable digest of the organization ids and the live key set —
is in [deploy_runbook.md](deploy_runbook.md#configuration-only-versions).

## The host's deployment contract

Upstream's release act ends at an immutable `cloudflare-v*` tag and its
publication. Deploying that tag — the host's Cloudflare account, Worker
Versions, secrets, traffic, and service binding — is the consuming host's
act. The live deployment facts — version, Worker Version, tag, date — live
in one place, [binding-conformance.md](binding-conformance.md); the
host's ops porcelain owns the deploy verbs. A deployed tag can lag `main`;
the tag is the deployment unit.

The artifact gate is `bin/check-artifact`; the host-neutral runbook —
preflight, version upload, canary, rollback, acceptance, and the deployment
witness — is [deploy_runbook.md](deploy_runbook.md).

The host-side shape the runtime supports:

- verify the annotated tag, peel it to a commit, and require that commit's
  package version and `wrangler.production.jsonc` (no routes,
  `workers_dev: false`); the host asserts its own Worker name on its side,
  since the gate does not certify which Worker a tag lands on;
- export every named coordinator before upload; a failed export aborts;
- upload a Worker Version tagged with the full upstream commit, serving no
  traffic; activate it with `wrangler versions deploy`, never
  `wrangler deploy` — except a tag carrying a Durable Object migration,
  which only `wrangler deploy` applies (see
  [deploy_runbook.md](deploy_runbook.md#durable-object-migrations));
- carry `AUTHORITY_ORGANIZATION_IDS` and `AUTHORITY_VERIFICATION_KEYS` as
  the additive secrets; `OPS_TOKEN` and the signing trio survive a version
  upload;
- a configuration-only version changes only those two values and is tagged
  with the code commit plus a digest of them;
- activate at 100%, canary by percentage, and roll back by releasing the
  previous tagged version when no one-way migration separates them; never
  delete a version.

State restore, roster rebuild, routing-facts backfill, policy application,
and the binding smoke are separate acceptance acts, not deploy steps. They
are documented in [binding-conformance.md](binding-conformance.md) and
[migration-v2.md](migration-v2.md).

## Local credentials (passkeys)

The runtime's passkey helper is the WebAuthn surface beside the OIDC code
exchange. It is runtime surface, not the portable seam: a local credential
is an ordinary principal link, `(provider: "webauthn", subject: credential
id)`, and assertion evidence enters the same issuance path as any other.
The host owns the browser ceremony — prompts, conditional mediation,
cookies — and holds no signing key. The design decisions are normative in
[authority_redesign.md](authority_redesign.md#local-credentials-passkeys--design-decisions).

Four RPC methods on the `AuthorityRuntimeEntrypoint` service binding carry
the ceremonies. The WebAuthn methods take the activation secret as its
SHA-256 hex digest (`secretHash`), never the plaintext; the binding's
`activationAccept` and `activationInspect` take the secret and hash it
internally, so hash once and reuse the digest for both WebAuthn calls.

- `webauthnRegistrationOptions({ interfaceVersion, organizationId,
  secretHash, rpId })` mints the ceremony options against a live activation
  request. The challenge rotates on every call, so a stale options page
  cannot satisfy a later registration. `rp.id` is the relying-party id the
  host serves and is minted into the options; `residentKey: "required"`
  makes the credential discoverable, `attestation: "none"` states that no
  attestation is requested, and the only offered algorithm is ES256.
- `credentialFromRegistration({ interfaceVersion, organizationId,
  secretHash, rpId, expectedOrigin, credential: { response:
  { attestationObject, clientDataJSON } } })` verifies the browser's
  registration response (ceremony type and challenge, origin, RP-id hash,
  user presence, attestation when present) and commits the link,
  credential, and activation consume in one transaction. The strict claim
  guard is unchanged: an actor holding any link cannot gain a second
  credential through a claim. Adding a federated link to a passkey actor
  is an ordinary `/ops/organization/principal-link` act; adding a passkey
  to an already-linked actor requires the identity-reset recovery (unlink,
  enroll, re-link) — a direct per-actor enrollment ceremony is deferred
  with the per-link retire.
- `webauthnAssertionOptions({ interfaceVersion, organizationId, rpId,
  expectedOrigin })` mints a single-use challenge bound to that origin and
  RP id. Feed it to `navigator.credentials.get` with no
  `allowCredentials` list: login is usernameless and the credential is
  discoverable.
- `credentialFromAssertion({ interfaceVersion, organizationId,
  operationId, credentialId, response: { authenticatorData,
  clientDataJSON, signature } })` verifies the assertion against the
  stored key, consumes the challenge, advances the sign counter, and
  issues `{ envelope, refresh }` through the ordinary session path.
  Evidence is `provider: "webauthn"`, `subject: <credential id>`,
  `amr: ["webauthn"]`, with the verification instant as `auth_time`.
  Issuance is the same gate a federated login reaches: a disabled actor is
  `not-admitted`, and a revoked participation behaves as it does today.

Refusals after a well-formed ceremony are uniform: unknown credential,
unknown or spent challenge, origin or RP mismatch, a signature that does
not verify, a credential with no principal link, and a counter regression
are all `unauthenticated`, so the surface does not enumerate credentials.
Two counter rules are deliberate: a zero counter is accepted forever (the
synced-passkey signal), and a stored nonzero counter must strictly
advance — a regression is refused, not logged.

Two preconditions travel with the surface. **The relying-party id is the
zone apex**, so one credential works at every operation hostname, including
hostnames that did not exist at enrollment; that requires **zone purity** —
the deployment must control every subdomain of the zone, because a
subdomain can request the parent id. A zone the deployment does not fully
control must not use apex-scoped credentials. And **attestation is handled,
never required**: `none` and packed self-attestation parse and verify, but
no trust path, format, or authenticator model is demanded.

Credentials are organization-owned facts (schema version 6 adds the
credential and assertion-challenge tables). They are carried by
`/ops/export` and `/ops/restore` — every shipped schema restores — survive
an operation delete and `forget-operation` untouched, and are removed by
`unlink-principal` as part of the documented identity reset. Recovery is
the working order: unlink, re-mint, accept.

## Operations routes

`/ops/*` is authenticated by `OPS_TOKEN` as a bearer token, except the
public key distribution:

- `POST /ops/organization/bootstrap`, `POST /ops/operation/bootstrap` —
  typed, idempotent bootstrap
- `POST /ops/operation/bootstrap-preview` — the operation's local data
  changes without committing bootstrap; see [Bootstrap preview](#bootstrap-preview)
- `GET /ops/organization/principal-links?organizationId=…` — list the
  organization's `(provider, subject, actorId)` principal links
- `POST /ops/organization/principal-link` — bind a verified provider subject
  to an existing actor; the worker refuses a subject already linked in
  another organization in the evidence directory
- `POST /ops/organization/activation-request` — mint the first
  administrator's return-once activation secret
- `POST /ops/organization/revoke-activation` — revoke an actor's outstanding
  activation without disabling the actor
- `POST /ops/organization/unlink-principal` — emergency principal recovery;
  remove the actor's links and stored passkeys and revoke refresh authority
  without removing grants
- `POST /ops/operation/routing-facts` — `{ operationId, slug, sites }`,
  backfilling the operation's complete routing facts; a rename waits for
  history and is not this route's job
- `GET /ops/schema-status?coordinator=organization|operation&id=…` —
  includes the operation's roster-projection counts and freshness, plus
  `operationSlug`, `sitesWithPath`, and `routingFactsComplete`
- `GET /ops/audit?coordinator=…&id=…` — the coordinator's audit rows,
  `{ seq, at, actor, fact }` and nothing else. Secret-free by construction,
  so an operator can produce an audit trail without the sealed provider
  configuration that `/ops/export` carries alongside it; see
  [`assurance.md`](assurance.md)
- `GET /ops/export?coordinator=…&id=…` — canonical JSON. Carries every
  table, `sealed_idp_config` included; prefer `/ops/audit` when the audit
  trail is what is wanted. A wiped or never-bootstrapped operation answers
  `{ absent: true, coordinator: "operation", operationId: <requested id> }`
  instead — absence is a state result, never a snapshot of empty tables
- `POST /ops/restore` — `{ coordinator, id, snapshot }`, typed and atomic;
  a snapshot's undelivered outbox rows are re-delivered by the next drain,
  and the receiving intake recognises the replay by the outbox row id. The
  restore appends one audit row recording itself, written after the tables so
  the snapshot cannot overwrite the trace of the act that applied it — so a
  restored export differs from its snapshot by exactly that row
- `POST /ops/operation/delete` — `{ operationId }`. True deletion: every
  operation-owned fact goes, audit, replay claims, and the outbox included;
  the coordinator is left uninitialized and a deliberate bootstrap is
  possible again. Writes no audit row — the audit contract holds within a
  live operation, and the wipe's trace lives with the operator who ordered
  it (see `authority_redesign.md` § Audit attribution). Refuses a mismatched
  `operationId` before any mutation, on the first call and on every retry.
  Idempotent: `deleted: true` whether or not anything existed. The
  schema-version meta survives (migration state, not operation fact). A
  late roster or acceptance push delivered after the wipe is accepted as
  delivered-but-not-applied, so the drain does not wedge and nothing
  repopulates. Sessions in flight expire by envelope lifetime — deleting
  refresh state prevents refresh, not already-issued envelopes
- `POST /ops/organization/forget-operation` — `{ organizationId,
  operationId }`. Scoped cleanup on the organization side after an operation
  delete: that operation's invitation records, outbox rows addressed to it,
  replay claims naming it, and audit facts referencing it are removed, while
  actors, principal links, administrator standing, every other operation's
  history, and unrelated audit facts survive. Idempotent, and writes no
  audit row for the same reason delete does not. Run it for every
  participant organization enumerated from the pre-delete export, so the
  organization's outbox fan-out stops addressing a coordinator that no
  longer decides anything

### Bootstrap preview

This route first enters source at `640a93f` and is absent from
`cloudflare-v0.13.1`. A consumer must adopt a runtime tag containing that
commit before calling it; source availability is not deployment evidence.

`POST /ops/operation/bootstrap-preview` takes the same body and ops token
as operation bootstrap. It reports the operation's local data changes:

```json
{
  "ok": true,
  "value": {
    "coordinator": "operation",
    "changes": [
      {
        "table": "sites",
        "key": { "site_id": "site-example" },
        "before": { "site_id": "site-example", "display_name": "Old name", "short_name": null, "path": "yard", "aliases_json": "[]" },
        "after": { "site_id": "site-example", "display_name": "New name", "short_name": null, "path": "yard", "aliases_json": "[]" }
      }
    ]
  }
}
```

Each change names a table and its stable row key. `before: null` means a
new row; otherwise the row changes from `before` to `after`. Rows contain
the export's column names and values, excluding `created_at` and
`updated_at`. JSON-valued columns remain JSON strings, as in export. The
report covers `operation`, `sites`, `teams`, `participations`, and `grants`;
it contains changed rows only. An empty `changes` array means no change to
these data fields, even though applying bootstrap can update timestamps.
Consumers should identify rows by table and key rather than array position.

The preview executes the real synchronous bootstrap inside an outer
transaction that always rolls back. It inherits the writer's defaults,
validation, and conflict rules: existing team and grant facts are preserved,
so an attempted seeded rename or grant change does not appear as an update.
It does not enumerate those ignored input differences. Audit rows, outbox
state, and sequence increments also roll back; none is part of the report.
It never reconciles roster projections or delivers messages. A first call
can initialize an empty coordinator's schema, as other coordinator reads do;
it leaves no bootstrap data behind.

This is an observation of current local state, not a reservation or an apply
ticket. Apply validates again and may observe changes made since preview.
Success does not establish directory availability, a successful roster pull,
deployment-wide hostname uniqueness, or a usable login. Organization
bootstrap and its directory-guarded principal binding have no preview route
in this slice. The host retains responsibility for manifest review, registry
checks, deployment, and explaining ignored input differences.

Rollback uses Cloudflare's documented
[`transactionSync` exception semantics](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactionsync).
The workerd suite witnesses the nested transaction, unchanged exports and
sequence state, the absence of roster pulls, and correspondence with apply.

### The outbox

A fact every participating operation must learn — a roster image, an actor
disable, an unlink — is enqueued as **one addressed row per operation**, at
enqueue time. It used to be one row resolved at delivery, which made a single
row cost one coordinator subrequest per operation and left the subrequests one
invocation issues unbounded; a backlog past the platform cap then failed
partway and the one-second alarm re-attempted the same batch indefinitely.

Two consequences an operator can observe:

- **A drain delivers at most 25 rows** and reports the remainder as `pending`.
  A larger backlog clears across invocations on the alarm that already runs,
  at roughly 25 a second. One row is one subrequest, so that count is the
  subrequest bound.
- **An operation that joins after a fan-out is enqueued does not receive that
  message.** Reconciliation is the backstop, not delivery: the roster pull
  carries `disabled`, and an unlink that never arrived is still refused by the
  operation's live organization read on refresh. An organization with no
  participating operation enqueues nothing rather than one undeliverable row.

Delivered rows are pruned after seven days. The outbox is otherwise
append-only, and one row per target multiplies what an event retains, so the
pruning keeps that trade neutral. A delivered row is spent — it is not
evidence, and it is not what makes a retry safe, which is why the same
reasoning does not extend to `audit` or `claims`.

Every `/ops/*` request may carry `x-ops-operator: <id>` — 1–64 characters of
`A-Za-z0-9._:@-`, refused with `invalid-command` if malformed rather than
silently dropped. It is recorded as the audit row's `actor` in place of the
literal `operator`. Attribution only, never authorization: no handler branches
on it, and because the ops token is all-or-nothing anyone holding the token can
claim any identity. See [`assurance.md`](assurance.md).
- `GET /ops/verification-keys` — **public**, no token:
  `{ signingKeyId, keySet }` where `keySet` is the serialized
  `VerifyKeySet`

The reference host exposes the principal-link routes through its porcelain as
`qm ops authority link list` and `qm ops authority link bind`; the porcelain
passes through and relies on the authority's one-link and ambiguity refusals.

No `/ops/*` route is publicly routed in production. The one-time bootstrap
act runs through any authorized caller with the ops token —
`wrangler dev --remote` is the minimal transport; a private ops Worker
holding the binding is a standing door (the reference consumer built one).

## State lifecycle

Export is canonical JSON per coordinator — plain rows, not a SQLite file —
so the restore drill is about state semantics, not storage format. The
`org_actors` projection is deliberately outside it: it is derived from the
organizations, so a snapshot that carried it would restore a stale roster as
authority. Restore clears it and rebuilds by pulling before returning, and
`GET /snapshot` shows its contents for inspection.
Export, restore, and the operator snapshot are adapter-only behavior: the
portable runtime has no storage surface. `/snapshot` is the operation
Durable Object's internal inspection view, and it includes the derived
`org_actors` projection that export deliberately omits; it is not
restorable authority state.
Restore is typed and atomic; a failed restore leaves the previous state
intact. Refresh handles issued before a wipe survive the export → wipe →
restore round trip: recovery does not strand a session.

The operation schema is 7 and the organization schema is 3. Older exports
restore into them — every schema either coordinator has shipped is accepted,
so a schema bump never strands an export taken before it: columns the older
snapshot did not carry read as null, teams from an export without a status
restore as `active`, an operation or site from an export before schema 6
restores with no short name, a team from an export before schema 7 restores
with no short name, and
`POST /ops/operation/routing-facts` backfills the complete routing set. The
schema-2 → accepted-schema drill is a restore plus a typed backfill, not a
second bootstrap. Until the backfill, `routingFactsComplete` is false, so a
restored old export is visibly incomplete rather than silently usable.

## Conformance, tests, and workerd notes

The full portable inventory — the `OH-*` cases — runs against the real
coordinators in workerd (`src/conformance.ts` boots and resets them from
`CONFORMANCE_WORLD`), alongside the coordinator, ops, exchange, and demo
suites. A deployed runtime reached through a service binding has a separate,
narrower claim: the documented smoke subset in
[binding-conformance.md](binding-conformance.md). It is not the full
inventory.

```sh
pnpm --filter org-hats-cloudflare typecheck
pnpm --filter org-hats-cloudflare test
```

Two platform notes, both load-bearing:

- The vitest plugin has no `isolatedStorage`. Tests use unique object
  names or explicit resets and assert deltas rather than absolute values.
- workerd's ECDSA `sign` emits the raw `r||s` JWS form where the
  WebCrypto spec expects DER; the exchange converts raw to DER (including
  the leading zero a high-bit integer needs) and tries both, so the
  verifier does not depend on which shape the runtime expects.

## The demo

```sh
pnpm --filter org-hats-cloudflare demo
```

A self-contained page: bootstrap the demo world, sign in with fixed dev evidence
(no identity provider, no external service, no production secret), and
check access — a real signed envelope issued through the authority
runtime and verified through `org-hats/access`, with neutral facts and
allow/deny checks. The `/demo/*` routes are not a product surface, and
they carry no token: `GET /demo/bootstrap` resets and reseeds the
coordinators, `POST /demo/login` mints an envelope and refresh handle,
`/demo/access` verifies one, and `/increment` is a harness counter. They
refuse to serve unless the deployment sets `DEMO_ROUTES: "1"` — the test
config sets it, the reference production config deliberately does not —
so a routed deployment and its service-binding callers get 404s. The
[threat model](threat_model.md) carries the boundary.

## Portability constraint

The runtime uses only the standard Durable Object surface: SQLite
storage, alarms, namespace and service bindings, and Web Crypto. No
proprietary bindings (R2, KV, D1, AI, Vectorize, Hyperdrive, Browser
Rendering, or the Cache API) — a self-hosted workerd-compatible target
stays a deployment choice, not a redesign. The `AuthorityRuntime`
service binding is also the local-development seam: a local Worker can
point at a deployed authority through a binding, which a handed-out
namespace cannot express.
