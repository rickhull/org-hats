# The Cloudflare reference runtime

*The `org-hats-cloudflare` package as built: its coordinators, Worker
surface, configuration, and operational lifecycle. It is the reference
deployment of the portable semantics — optional, private, on its own `0.x`
cadence, consumed by deployment through a service binding rather than by
dependency. The portable modules and their contract are
[authority_redesign.md](authority_redesign.md); this document covers what
sits on top of them.*

## Shape: two coordinators and a Worker

Authority state has two owners, each a Durable Object class with SQLite
storage:

- **`OrganizationAuthority`** (`src/organization.ts`) — the facts that
  stay stable while an organization joins several operations: the
  organization record, actors, verified-principal links, organization
  administrators, invitations received, audit, idempotency claims, the
  outbox, and the sealed identity-provider configuration (stored
  opaquely; parsed only by the provider-callback exchange).
- **`OperationAuthority`** (`src/operation.ts`) — operation-local
  authority: the operation hostname slug, sites (including their canonical
  paths and alias labels), teams, grants, participation, the policy version,
  refresh records, admission requests, audit, claims, the outbox carrying
  invitations and revocations to organization authority, and the `org_actors`
  projection of each participating organization's roster.

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

## Routing facts (operation schema 4)

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
bind to. Over a `services` binding it exposes the four portable
`AuthorityRuntime` methods — `accessFromEvidence`, `refresh`, `context`
(names, wearable hats, and the selected hat from both coordinators), and
`command` — plus one runtime-only method:

**`evidenceFromProviderCode`** — the provider-callback exchange, the
identity-adapter surface for OIDC logins. The tenant's callback supplies
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
one verb per crossing. Discovery is cached a day and JWKS an hour per
isolate; a failing signature triggers exactly one JWKS refetch per
exchange, which is the key-rotation window.

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
a full set is **proven a pair at import** — the private half signs a fixed
probe the public half must verify, so a mismatch is a startup error, not a
runtime that signs envelopes nothing verifies.

- `AUTHORITY_SIGNING_KEY` — pkcs8, base64
- `AUTHORITY_SIGNING_PUBLIC_KEY` — raw public key, base64
- `AUTHORITY_SIGNING_KEY_ID` — the id that goes into every envelope
- `AUTHORITY_VERIFICATION_KEYS` — the canonical serialized `VerifyKeySet`
  JSON from `org-hats/access`: every key that should verify during a
  rotation

Rotation is verifier-first: install the next key in
`AUTHORITY_VERIFICATION_KEYS` everywhere before the issuer switches, and
remove the old entry after its last envelope has expired.

## Configuration

Two Wrangler configs, two purposes:

- `wrangler.jsonc` — the test Worker: the two coordinators plus the
  harness `Counter`, a local-only `OPS_TOKEN` var, and the incremental
  migrations history.
- `wrangler.production.jsonc` — the deploying operator's Worker: both
  coordinators, one fresh migration declaring both classes, no `Counter`,
  no committed token, `workers_dev: false`, no routes. The Worker is
  reachable through its service binding; secrets come from an ignored,
  operator-held file (`wrangler secret put` / `--secrets-file`): the
  signing set above, `OPS_TOKEN`, and `AUTHORITY_ORGANIZATION_IDS` — the
  comma-separated evidence-resolution directory; there is no global
  registry.

An operation carries no identity-provider configuration or reference to one.
The host chooses the provider, and the runtime resolves the sealed
registration from the organization directory by issuer and client id.

## Deployment contract

Upstream's release act ends at an immutable `cloudflare-v*` tag and its
push. Deploying that tag — the host's Cloudflare account, Worker Versions,
secrets, traffic, and service binding — is the consuming host's act. The
reference deployment is live at `cloudflare-v0.4.0`; the host's ops
porcelain owns the deploy verbs. A deployed tag can lag `main`; the tag is
the deployment unit.

The artifact gate is `bin/check-deploy`; the host-neutral runbook —
preflight, candidate, canary, rollback, acceptance, and the deployment
witness — is [deploy_runbook.md](deploy_runbook.md).

The host-side shape the runtime supports:

- verify the annotated tag, peel it to a commit, and require that commit's
  package version and `wrangler.production.jsonc` (Worker name, no routes,
  `workers_dev: false`);
- export every named coordinator before upload; a failed export aborts;
- upload a Worker Version tagged with the full upstream commit, serving no
  traffic; activate it with `wrangler versions deploy`, never
  `wrangler deploy`;
- carry `AUTHORITY_ORGANIZATION_IDS` and `AUTHORITY_VERIFICATION_KEYS` as
  the additive secrets; `OPS_TOKEN` and the signing trio survive a version
  upload;
- a configuration-only version changes only those two values and is tagged
  with the code commit plus a digest of them;
- activate at 100%, canary by percentage, and roll back by releasing the
  previous tagged version; never delete a version.

State restore, roster rebuild, routing-facts backfill, policy application,
and the binding smoke are separate acceptance acts, not deploy steps. They
are documented in [binding-conformance.md](binding-conformance.md) and
[migration-v2.md](migration-v2.md).

## Operations routes

`/ops/*` is authenticated by `OPS_TOKEN` as a bearer token, except the
public key distribution:

- `POST /ops/organization/bootstrap`, `POST /ops/operation/bootstrap` —
  typed, idempotent bootstrap
- `GET /ops/organization/principal-links?organizationId=…` — list the
  organization's `(provider, subject, actorId)` principal links
- `POST /ops/organization/principal-link` — bind a verified provider subject
  to an existing actor; the worker refuses a subject already linked in
  another organization in the evidence directory
- `POST /ops/operation/routing-facts` — `{ operationId, slug, sites }`,
  backfilling the operation's complete routing facts; a rename waits for
  history and is not this route's job
- `GET /ops/schema-status?coordinator=organization|operation&id=…` —
  includes the operation's roster-projection counts and freshness, plus
  `operationSlug`, `sitesWithPath`, and `routingFactsComplete`
- `GET /ops/export?coordinator=…&id=…` — canonical JSON
- `POST /ops/restore` — `{ coordinator, id, snapshot }`, typed and atomic
- `GET /ops/verification-keys` — **public**, no token:
  `{ signingKeyId, keySet }` where `keySet` is the serialized
  `VerifyKeySet`

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
Restore is typed and atomic; a failed restore leaves the previous state
intact. Refresh handles issued before a wipe survive the export → wipe →
restore round trip: recovery does not strand a session.

The operation schema is 4. Older operation exports (schema 2 or 3) restore
into it: columns the older snapshot did not carry read as null, and
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
allow/deny checks. The `/demo/*` routes are not a product surface.

## Portability constraint

The runtime uses only the standard Durable Object surface: SQLite
storage, alarms, namespace and service bindings, and Web Crypto. No
proprietary bindings (R2, KV, D1, AI, Vectorize, Hyperdrive, Browser
Rendering, or the Cache API) — a self-hosted workerd-compatible target
stays a deployment choice, not a redesign. The `AuthorityRuntime`
service binding is also the local-development seam: a local Worker can
point at a deployed authority through a binding, which a handed-out
namespace cannot express.
