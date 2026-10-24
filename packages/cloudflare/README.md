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

The operation coordinator, alarms, and outbox delivery are T6.3/T6.4.

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

T6.3–T6.4 add `OperationAuthority` and the runtime/ops entrypoints. This
package is `private` until the demo milestone decides how it is distributed.
