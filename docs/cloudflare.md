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
  authority: sites, teams, grants, participation, the policy version,
  refresh records, admission requests, audit, claims, and the outbox
  carrying invitations and revocations to organization authority.

Every mutation commits with its audit event, idempotency claim, and outbox
rows inside one `transactionSync`. Work spanning the two coordinators is a
durable outbox message with a visible partial state and an alarm-driven
retry — never a distributed transaction. A duplicate or mismatched
principal link is refused at bootstrap: one identity is never two actors.

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

## Operations routes

`/ops/*` is authenticated by `OPS_TOKEN` as a bearer token, except the
public key distribution:

- `POST /ops/organization/bootstrap`, `POST /ops/operation/bootstrap` —
  typed, idempotent bootstrap
- `GET /ops/schema-status?coordinator=organization|operation&id=…`
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
so the restore drill is about state semantics, not storage format.
Restore is typed and atomic; a failed restore leaves the previous state
intact. Refresh handles issued before a wipe survive the export → wipe →
restore round trip: recovery does not strand a session.

## Conformance, tests, and workerd notes

The full portable inventory — the `OH-*` cases — runs against the real
coordinators in workerd (`src/conformance.ts` boots and resets them from
`CONFORMANCE_WORLD`), alongside the coordinator, ops, exchange, and demo
suites:

```sh
pnpm --filter org-hats-cloudflare typecheck
pnpm --filter org-hats-cloudflare test
```

Two platform notes, both load-bearing:

- The vitest plugin has no `isolatedStorage`. Tests use unique object
  names or explicit resets and assert deltas rather than absolute values.
- workerd's ECDSA `sign` emits the raw `r||s` JWS form where the
  WebCrypto spec says DER; the exchange's verifier accepts either shape,
  so tokens from spec-conformant runtimes and from workerd both pass.

## The demo

```sh
pnpm --filter org-hats-cloudflare demo
```

A self-contained page: bootstrap a twin, sign in with fixed dev evidence
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
