# org-hats

*A portable organizational authority subsystem — portable semantics, one
reference runtime.*

**The `v1` branch is the 1.0 development branch and a deliberate break with
the v0.4 surface.** The v0.4 organization model — predicates, persistence
port, request spine, and the Node SQLite adapter — is not here; it lives on
`main` at its tags, and content returns to this branch only by being
re-specified, never copied. The current version is `1.0.0-alpha.1` (the
vertical path and the conformance inventory are in place; the 1.0.0 release
is prepared).

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
  envelope under verification keys and get neutral authority facts; fixed
  vectors pin the format byte-exactly.
- **`org-hats/conformance`** — the executable inventory: table-driven cases
  over the synthetic twins, run through the public interface only. Another
  runtime runs the same inventory by supplying its own world factory.

Everything under `src/` compiles with `types: []` and imports nothing
Cloudflare — `bin/check` enforces both fences. The Cloudflare reference
runtime arrives as a separate package later in the plan.

## Proof

```sh
node examples/pilot.ts
```

The pilot bootstraps the Professional Operation, resolves verified evidence,
issues and verifies a signed envelope with a distributed public key, calls
neutral predicates, and shows the bounded-expiry denial. `bin/check` runs it
after the suites.

Normative documents:

- [`docs/README.md`](docs/README.md) — the docs index and the docs/plans
  split.
- [`docs/authority_redesign.md`](docs/authority_redesign.md) — the
  architecture; § Authority and § Access point at the shipped spec types.
- [`docs/envelope.md`](docs/envelope.md) — the v1 access-envelope format
  contract.
- [`docs/lexicon.md`](docs/lexicon.md) — the normative vocabulary: the words
  this repository uses, and the ones it rejects.
- [`docs/migration-v1.md`](docs/migration-v1.md) — the 0.4 → 1.0 deltas.
- [`SECURITY.md`](SECURITY.md) — reporting and coordinated disclosure.
- [`plans/v1.md`](plans/v1.md) — the remaining work: release, consumer
  handoff, Cloudflare runtime, and demo.

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
