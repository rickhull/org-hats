# Portability — the fence, the runtime, the posture

Distilled from `docs/authority_redesign.md`, `AGENTS.md`, and
`docs/publishing.md`. Ids are stable; see the [README](README.md) for the
protocol.

### P1 — The fence is law

Everything under `src/` compiles with `types: []` and imports nothing
Cloudflare or Node-only. When code and the fence disagree, the code is
fixed.

*Held by:* `bin/check` — the compiler fence and the cloudflare-import
guard — on every change.
*If it breaks:* a generic consumer inherits platform dependencies it never
chose, and "portable" starts needing qualifications.

### P2 — The portable suites never need the platform

The portable packages' tests run with `node --test` alone — no workerd, no
Cloudflare account, no network. Runtime-specific tests belong to
`packages/cloudflare` and say so.

*Held by:* the split check scripts (`pnpm check` vs `pnpm check:cloudflare`)
and the CI jobs they back.
*If it breaks:* proving the model requires a platform, and the fence of P1
loses its cheapest enforcement.

### P3 — Portable semantics, one reference runtime

Cloudflare is the reference deployment with first-class tooling, not a
requirement; a second runtime adapter appears only when a real consumer
commits to it, and no adapter SPI or pairing matrix is published ahead of
that.

*Held by:* the in-memory and Cloudflare adapters sharing one internal
conformance inventory in this repository, and nothing published between
them.
*If it breaks:* "portable" erodes into marketing — speculative adapters
and compatibility matrices appear without an author who needs them.

### P4 — The reference runtime stays on the standard surface

SQLite storage, alarms, namespace and service bindings, and Web Crypto —
no proprietary bindings. A self-hosted workerd-compatible target remains a
deployment choice, not a redesign.

*Held by:* the coordinator sources; the review rule that every binding a
test touches is a standard one.
*If it breaks:* deployment quietly requires one vendor's extras, and the
reference runtime stops being a reference.

### P5 — No real people in a public repository

The design tests are the synthetic twins (Professional Operation,
Festival); real rosters, customer names, and key material live with the
consumer or the operator.

*Held by:* the twins are the only fixtures; both relay notes are written
as publishable; `SECURITY.md` exists before production data.
*If it breaks:* it is an incident, not a bug — exposure cannot be
un-pushed from a public mirror.

### P6 — Releases are immutable tags, and the manifest is the single pin

Distribution is by git tag only; `bin/release` takes the tag from
`package.json`, so manifest and tag cannot disagree; consumers pin tags,
never ranges, because a pin that moves under a verifier changes what a
signature means.

*Held by:* the release script's single source of truth; the consumer's
re-recorded acceptance at each move.
*If it breaks:* a moved or floating pin silently redefines the seam under
every consumer at once.
