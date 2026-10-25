# org-hats

*A portable organizational authority subsystem — portable semantics, one
reference runtime.*

**The 1.x line on `main` is a deliberate break with the v0.4 surface.**
The v0.4 organization model — predicates, persistence port, request spine,
and the Node SQLite adapter — is not here; it lives at its tags (`v0.4.4`
last), and content returns only by being re-specified, never copied. The
released line is the latest `v1.x` tag;
`1.0.0` is historical. The Cloudflare runtime and demo are in place;
Quartermaster's deployment of the reference runtime is under way.

What ships here:

- **The root export** — the v1 organization model (`src/model.ts`):
  organization-scoped actors, operation-local grants over discrete team/site
  targets, worn-hat selection, the participation state machine, `decide`,
  `readReach`, and `invariantProblems`; plus the policy-bundle vocabulary
  (`src/policy.ts`).
- **`org-hats/authority`** — the normative authority interface
  (`AuthorityRuntime`, commands, the closed failure taxonomy) and the
  in-memory engine with its synthetic design twins, ready for consumer
  pilots and tests.
- **`org-hats/access`** — the verification-only module: `verify` a signed
  envelope under verification keys and get neutral authority facts; keys
  travel as the canonical `VerifyKeySet` (serialize, parse, build), and
  fixed vectors pin the format byte-exactly.
- **`org-hats/conformance`** — the executable inventory: table-driven cases
  over the synthetic twins, run through the public interface only.
  `CONFORMANCE_WORLD` carries the synthetic fixtures, principal links, and
  org-admin bootstrap; another runtime runs the same inventory by supplying
  its own world factory.

Everything under `src/` compiles with `types: []` and imports nothing
Cloudflare — `bin/check` enforces both fences. The Cloudflare reference
runtime lives in `packages/cloudflare` as a separate 0.x workspace package:
the two SQLite-backed coordinators, the `AuthorityRuntimeEntrypoint`
service binding (including the provider-callback exchange), ops routes,
key rotation, and export/restore — the reference document is
[`docs/cloudflare.md`](docs/cloudflare.md), and the self-contained demo
runs with `pnpm --filter org-hats-cloudflare demo`.

## Proof

```sh
node examples/pilot.ts
```

The pilot bootstraps the Professional Operation, resolves verified evidence,
issues and verifies a signed envelope with a distributed public key, calls
neutral predicates, and shows the bounded-expiry denial. `bin/check` runs it
after the suites.

Normative documents:

- [`docs/README.md`](docs/README.md) — the docs index and the
  docs/specs/plans split.
- [`docs/authority_redesign.md`](docs/authority_redesign.md) — the
  architecture; § Authority and § Access point at the shipped spec types.
- [`docs/envelope.md`](docs/envelope.md) — the v1 access-envelope format
  contract.
- [`docs/cloudflare.md`](docs/cloudflare.md) — the Cloudflare reference
  runtime as built: coordinators, Worker surface, keys, ops, state
  lifecycle.
- [`specs/README.md`](specs/README.md) — the named invariants: what must
  hold, what enforces it, and what follows when it stops holding.
- [`docs/lexicon.md`](docs/lexicon.md) — the normative vocabulary: the words
  this repository uses, and the ones it rejects.
- [`docs/migration-v1.md`](docs/migration-v1.md) — the 0.4 → v1 deltas.
- [`docs/migration-v2.md`](docs/migration-v2.md) — the 1.2 → 2.0 deltas:
  the `GrantTarget` command shape and the interface-version break.
- [`SECURITY.md`](SECURITY.md) — reporting and coordinated disclosure.
- [`plans/README.md`](plans/README.md) — the plans index; a plan names
  work in flight and is removed when realized.

Background (phase-1 toeholds; the bodies return by re-specification):

- [`docs/organization_model.md`](docs/organization_model.md) — the structural
  model in one piece.
- [`docs/rbac.md`](docs/rbac.md) — this model's position among RBAC
  references.
- [`docs/literature_review.md`](docs/literature_review.md) — the reading
  method and reference inventory.

Distribution is by git tag only; the consumer pins a commit. See
[`docs/publishing.md`](docs/publishing.md) for canonical host, mirror, and
the release ritual.
