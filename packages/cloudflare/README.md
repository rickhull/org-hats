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
- `wrangler.jsonc` declares the binding and the SQLite migration.

```sh
pnpm --filter org-hats-cloudflare typecheck
pnpm --filter org-hats-cloudflare test
```

The portable suite remains `pnpm check` at the repository root; it never
needs workerd, a Cloudflare account, or a network.

T6.2–T6.4 replace the counter with `OrganizationAuthority`,
`OperationAuthority`, and the runtime/ops entrypoints. This package is
`private` until the demo milestone decides how it is distributed.
