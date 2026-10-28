# org-hats-cloudflare

The optional Cloudflare reference runtime: the two authority fact owners and
the subject-keyed race guard as Durable Objects, and the `AuthorityRuntimeEntrypoint`
Worker a consumer binds to. Private, on its own `0.x` cadence, consumed
by deployment through a service binding rather than by dependency.

**The reference document is [`docs/cloudflare.md`](../../docs/cloudflare.md)** —
the coordinators, the Worker surface (including the provider-callback
exchange), signing and key rotation, test versus production configuration,
the ops routes, export/restore, conformance, and the workerd platform
notes.

The basics:

```sh
pnpm --filter org-hats-cloudflare typecheck
pnpm --filter org-hats-cloudflare test    # real workerd, no mocks
pnpm --filter org-hats-cloudflare demo    # self-contained: bootstrap, dev login, verify
```

- `src/organization.ts` — `OrganizationAuthority`: actors, principal
  links, org administrators, invitations, sealed IdP configuration
- `src/operation.ts` — `OperationAuthority`: sites, teams, grants,
  participation, policy, refresh records
- `src/runtime.ts` — the portable `AuthorityRuntime` over both, plus
  `evidenceFromProviderCode`
- `src/subject-guard.ts` — per-provider-subject serialization for every
  principal-link writer
- `src/index.ts` — the entrypoint, ops routes, and demo
- `src/state.ts` — canonical export/restore
- `test/` — workerd suites; no `isolatedStorage`, so tests use unique
  object names and assert deltas

The portable package's suite (`pnpm check` at the repository root) never
needs workerd, a Cloudflare account, or a network. The runtime stays on
the standard Durable Object surface only — see the portability section of
the reference document.
