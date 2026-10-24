# org-hats-cloudflare

The optional Cloudflare reference runtime: Durable Objects, SQLite storage,
and the authority Worker surface. It has its own 0.x cadence and is not part
of the portable package's release line.

## T6.1 — the harness

This package starts as a real workerd harness, not a mock:

- `src/counter.ts` is a SQLite-backed Durable Object proving durable storage.
- `src/index.ts` routes one request through the object.
- `test/counter.test.ts` runs inside workerd via `@cloudflare/vitest-plugin`
  and proves the value survives across requests.
- `wrangler.jsonc` declares the bindings and the SQLite migration.

## T6.2 — OrganizationAuthority

`src/organization.ts` owns the organization-side facts in SQLite:
organizations, actors, verified-principal links, organization administrators,
invitations, audit, idempotency claims, and the outbox. A mutation and its
audit/claim/outbox rows commit inside `transactionSync`; the sealed
identity-provider configuration is stored opaquely and never exposed. The
test suite exercises bootstrap and principal resolution, invite → accept,
duplicate and mismatched claims, early acceptance, disable, and revoke.

## T6.3 — OperationAuthority

`src/operation.ts` owns the operation-local facts: sites, teams, grants,
participation, policy, refresh records, audit, claims, and the outbox that
carries invitations to organization authority. Organization and operation
outboxes drain through namespace stubs; a failed delivery stays pending and
an alarm retries it. The tests cover invite → accept through both
coordinators, alarm retry, grants/select/revoke with idempotency,
refresh-record revocation, cross-coordinator actor-disable, and
operation-side participation revoke.

## T6.4 — runtime and conformance

`src/runtime.ts` implements `AuthorityRuntime` over the two coordinators;
`AuthorityRuntimeEntrypoint` is the RPC service shape. `src/conformance.ts`
boots and resets the coordinators from `CONFORMANCE_WORLD`, and the full
25-case portable inventory now runs against them in workerd. The Worker
exposes `/ops/verification-keys` for the public signing key.

## T6.5 — ops and state lifecycle

`OPS_TOKEN` authenticates the `/ops/*` routes:

- `POST /ops/organization/bootstrap`
- `POST /ops/operation/bootstrap`
- `GET  /ops/schema-status?coordinator=organization|operation&id=…`
- `GET  /ops/export?coordinator=…&id=…` — canonical JSON
- `POST /ops/restore` — `{ coordinator, id, snapshot }`
- `GET  /ops/verification-keys` — public, no token

Set `AUTHORITY_SIGNING_KEY` (pkcs8 base64), `AUTHORITY_SIGNING_PUBLIC_KEY`
(raw base64), and `AUTHORITY_SIGNING_KEY_ID` for a stable signer.
`AUTHORITY_VERIFICATION_KEYS` carries the canonical serialized
`VerifyKeySet` from `org-hats/access` — the new key is installed there before
the issuer switches, and the old entry is removed after its last envelope
expires. Without the signing-key variables the runtime generates an
ephemeral dev key per isolate.

Export is canonical JSON per coordinator, not a SQLite-file copy; restore is
typed and atomic. The restore drill covers the operation and organization
coordinators, and context returns names, wearable hats, and the selected hat.

## Portability constraint

The runtime uses only the standard Durable Object surface: SQLite storage,
alarms, namespace and service bindings, and Web Crypto. It does not use
Cloudflare-proprietary bindings (R2, KV, D1, AI, Vectorize, Hyperdrive,
Browser Rendering, or the Cache API). That keeps a self-hosted
workerd-compatible target a deployment choice rather than a redesign.

The `AuthorityRuntime` service binding is also the local-development seam: a
local Worker can point at a deployed authority through a service binding,
which a handed-out namespace cannot express. Export/restore is canonical JSON
per coordinator, not a SQLite-file copy, so the drill is about state
semantics rather than storage format.

```sh
pnpm --filter org-hats-cloudflare typecheck
pnpm --filter org-hats-cloudflare test
```

The portable suite remains `pnpm check` at the repository root; it never
needs workerd, a Cloudflare account, or a network.

The plugin has no `isolatedStorage` option. Do not assume a fresh store
between tests: use unique object names or explicit reset, and assert deltas
rather than absolute values. The organization tests use unique object names;
the counter test asserts `second === first + 1`.

## T7.1 — the demo

```sh
pnpm --filter org-hats-cloudflare demo
```

Open the local URL and use the three buttons: bootstrap the twin, sign in as
Dana with fixed dev evidence, and check access. The login issues a real signed
envelope through the authority runtime; the access button verifies it through
`org-hats/access` and shows neutral facts plus four allow/deny checks.

The demo uses the conformance world, so it bootstraps both twins and resets
the coordinators on first use. Dev evidence only: there is no identity
provider, no external service, and no production secret. The page and the
`/demo/*` routes are not a product surface.

This package is `private`; it is consumed by deployment through a service
binding, not by dependency.
