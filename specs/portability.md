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

The Cloudflare package is the reference runtime with first-class tooling, not a
requirement; a second runtime adapter appears only when a real consumer
commits to it, and no adapter SPI or pairing matrix is published ahead of
that. The fence and the shared conformance inventory are evidence that the
portable semantics are well-defined; they do not prove a second runtime,
which only a committed adapter can.

*Held by:* the in-memory and Cloudflare adapters sharing one internal
conformance inventory in this repository, `bin/check`'s fence (P1), and
nothing published between them.
*If it breaks:* "portable" erodes into marketing — speculative adapters
and compatibility matrices appear without an author who needs them, or the
docs imply a drop-in portability no second implementation has shown.

### P4 — The reference runtime stays on the standard surface

SQLite storage, alarms, namespace and service bindings, and Web Crypto —
no proprietary bindings. A self-hosted workerd-compatible target remains a
deployment choice, not a redesign.

*Held by:* the coordinator sources; the review rule that every binding a
test touches is a standard one.
*If it breaks:* deployment quietly requires one vendor's extras, and the
reference runtime stops being a reference.

### P5 — No real people in a public repository

The design tests are the synthetic example worlds (Professional Operation,
Festival, Berlin Airlift); real rosters, customer names, and production key
material live with the consumer or the operator.  Test-only signing keys in
fixtures are test material, not secrets.  A host's own world enters through
`defineWorld` and is not committed here with real data.

*Held by:* the committed fixtures are synthetic — the three twins, the
conformance invitee, the own-world example, the devidp test provider, and the
test-local worlds; the fixture boundary (`defineWorld`) is the entry for a
host's own world; the relay notes are written as if public; `SECURITY.md`
exists before production data.
*If it breaks:* it is an incident, not a bug — exposure cannot be un-pushed
from a public mirror.

### P6 — Release tags never move, and the manifest is the single pin

Distribution is by git tag only; `bin/release` takes the tag from the
selected package's manifest (root `package.json` or the Cloudflare
manifest), so manifest and tag cannot disagree; consumers pin tags, never
ranges, because a pin that moves under a verifier changes what a signature
means. Git does not make a tag immutable: a tag is a name, not a commit
hash, so immutability here is repository policy backed by verification,
never a property of the remote.

*Held by:* the release script's single source of truth; `bin/check-version`
matching each release tag to its manifest; the git policy that forbids
moving, forcing, or deleting a tag; the consumer's re-recorded acceptance at
each move.
*If it breaks:* a moved or floating pin silently redefines the seam under
every consumer at once.

### P7 — Brands stay behind the public surface

The five domain ids are branded internally, but every consumer-facing
command, claim, neutral-access result, and context takes or returns plain
strings for those ids. Evidence names a provider and subject, not a domain
id. A host passes ids it read from its own records without importing a
constructor.

*Held by:* the `AssertPlainId` compile-time assertions in `src/contract.ts`
and `tests/consumer-surface.ts`, which compiles against `dist/`; the
compile-only surface assertions in `tests/types.test.ts` pin the same ids
and the closed unions from the tests side. `bin/check`
runs the consumer fence on every change.
*If it breaks:* branding leaks into the installable surface, hosts need
constructors for ordinary ids, and the compile-time brand begins to move
what should be a wire-compatible value.

### P8 — The suites and examples typecheck

The root tests and the examples compile under `tsconfig.tests.json`; a
fixture that sends a shape the interface no longer accepts fails the gate
rather than failing at runtime.

*Held by:* `tsconfig.tests.json`, the `typecheck:tests` script, and the
typecheck and run steps in `bin/check`; pre-push, CI, and `pnpm verify` all
run that gate.
*If it breaks:* the compiler is silent about the test inputs, and an
interface break reaches the runtime as a fixture failure after the fact.

### P9 — Untrusted data is parsed before it wears a domain type

Every untrusted wire, storage, policy, or provider value passes a named
parser or verifier before it enters a branded domain position. The
envelope's version/signature gate is its parse; key sets, policy bundles,
SQLite rows, HTTP command bodies, and provider evidence have their own
decoders. Test fixtures are trusted design data, converted once and checked
by the suite and `invariantProblems`; a host's own world is validated by
`defineWorld` at that boundary.

*Held by:* `verify`'s format/version/signature gate; `parseVerifyKeySet`;
`validatePolicyBundle` at the Cloudflare bootstrap and in tests; the
Cloudflare `row.ts` decoders and ops body decoders; the fixture boundary in
`tests/helpers.ts` plus `invariantProblems`; `defineWorld` and
`tests/world.test.ts` for host worlds.
*If it breaks:* a brand becomes an assertion about data nobody checked, and
the type layer starts lying about storage, wire, or provider input.

### P10 — A host's world has a validating entry

`defineWorld` is the public validating entry for a host's own world. It
converts plain-id data once and refuses an invalid policy bundle, an
invariant violation, or a fixture carrying other than exactly one
operation. The built-in example worlds pass the same checks.

*Held by:* `defineWorld` in `src/authority/world.ts`; `tests/world.test.ts`
(pins one refusal per rule and revalidates every twin); the examples run in
`bin/check`; `docs/authority_redesign.md` § Verification strategy names the
boundary.
*If it breaks:* the first own-world fixture reaches a runtime as an
incoherent state, fixture mistakes surface as boot-time surprises instead of
a named error, and adoption depends on reading the engine.
