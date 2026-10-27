# Absorbing the Quartermaster consumer assets

**Status:** Proposed.  The boundary and the cookie-budget rule are settled;
each item below is reviewable and landable on its own.

`org-hats` owns the authority seam, and Quartermaster is its first committed
consumer.  Some of the consumer's work is contract-shaped — it implements or
proves an `org-hats` contract — and belongs here.  The rest is product policy
and stays with the host.  This plan absorbs the contract-shaped pieces and
leaves the product alone.  Delivery tooling is out of scope: the consumer's
`qm` porcelain is moving to Go and stays bespoke.

## Boundary

`org-hats` owns the authority engine, the access envelope, verification, the
provider exchange, binding conformance, and the deployment contract.

The host owns browser routes, state/nonce/PKCE creation, cookies, session
responses, routing, and ops verbs.  The cookie boundary in particular is the
host's: upstream states an envelope maximum, and the host applies the browser
budget and refuses above it.

Code is absorbed only when it implements an `org-hats` contract.  Host policy
is documented here as a guide or example, never published as a module.  A
piece that cannot be stated without naming the host is a host piece.

## 1. Binding conformance kit

**Why.**  `docs/binding-conformance.md` specifies the service-binding smoke,
but upstream has no executable implementation of it.  The consumer wrote one,
and its imports are only `org-hats/access` and `org-hats/authority`.

**Source.**  The consumer's `apps/ops/src/authority-smoke.ts` (266 lines) and
`apps/devidp` (403 lines, self-contained, ES256 with a fixed test key).

**Shape.**

- A runner taking the smoke's dependency seam — the `AuthorityRuntime`, the
  verification key set, an operation-status source, and a `disableActor`
  that reaches the organization authority directly — covering the six
  documented groups.  The stale-projection case needs the organization
  Durable Object, and the key set and status need a source; a small harness
  wires them.
- `devidp` as a workerd fixture, not a library: a separate Worker with its
  own signing key and configuration.
- A bootstrap/fixture contract for the dedicated operation the smoke
  consumes.

**Where.**  `packages/cloudflare/test/` for both, under the workerd ring.  No
package export; these are test assets, not surface.  The portable
`types: []` fence is untouched.

**Done when.**  The six groups run in `pnpm check:cloudflare` through that
seam against a real service binding; `exchange.ts` has an end-to-end provider
round trip through `devidp`; the portable ring still runs without workerd; no
consumer name, hostname, or real fixture appears in the checked-in assets.

**Tradeoffs.**  Adds roughly 700 lines and workerd time, and needs a fixture
contract that fixes a bootstrap shape the host may still be moving.  The
harness must not assume the consumer's ops Worker; the dependency seam is the
portability boundary.  Keep the runner test-only so it cannot become a second
public API.

## 2. Host session carriage contract

**Why.**  The envelope is issued upstream, but the browser carriage is the
host's.  The consumer discovered invariants that belong in the seam
documentation because they can fail silently: a browser drops an oversized
cookie, and the login looks half-worked.

**Source.**  The consumer's `session.ts` (184 lines), `login-state.ts` (105),
`return-path.ts` (14), and the state/PKCE portion of `auth.ts`.

**Shape.**  Document, and optionally exemplify, these invariants:

- two host-only `__Host-` cookies: the signed envelope and an opaque refresh
  handle;
- access-cookie max-age equals the envelope's `exp`, not a fixed session
  lifetime;
- an envelope that exceeds the browser cookie budget is refused at issuance,
  not truncated or silently dropped;
- upstream states an envelope maximum, and the host applies the full cookie
  budget including attributes;
- the refresh handle is re-sent only when issuance says it rotated;
- every refusal clears both cookies;
- login state is single-use with a short TTL;
- the return path is an allowlisted value, never a caller-supplied URL;
- the nonce is created host-side and verified upstream.

**Where.**  A new `docs/consumer-session.md`, or a section of
`docs/cloudflare.md`, cross-linked from `specs/authority.md` A7 and
`docs/envelope.md`.

**Settled by review.**  Both checks are required.  Upstream documents a
3,800-byte encoded maximum; the host enforces its cookie budget and refuses
above it at issuance.  The host value is the binding one, because the 4 KB
cap includes attributes, and the closed failure taxonomy has no "too large"
kind worth a version break.  The measurement test records the synthetic
envelopes, including the festival's site-wide reach, which already exceeds a
browser budget.

**Done when.**  The carriage rules are normative; the host budget is stated
as binding; the synthetic sizes are measured against it; no module is
published.

**Tradeoffs.**  Prose drifts; tie the budget rule to a test.  A published
helper package would blur the boundary the seam depends on.

## 3. Login integration guide

**Why.**  The consumer's `docs/identity_provider.md` explains the host half
of the provider login better than the seam docs do, but it is written for one
product.

**Shape.**  A host-neutral guide: the flow, who holds which value, the three
one-time values (state, nonce, PKCE), the refusal audit that logs the
provider and subject but never a token or secret, and the rule that a
development provider cannot authorize a product act.

**Where.**  `docs/consumer-login.md`.

**Done when.**  A host can implement the redirect and callback from this
document alone; it names no customer, hostname, provider registration, or
consumer path; `specs/authority.md` remains normative for the envelope half.

**Tradeoffs.**  Overlaps the consumer's `specs/login.md`; this document is
normative for the seam, and the consumer's remains normative for its product.

## 4. Consumer access example

**Why.**  The consumer's `packages/access` maps the closed failure taxonomy
to product responses with an exhaustive switch.  The `never` arm is the best
demonstration that a new failure kind is an interface change.

**Shape.**  An example that verifies an envelope, maps every `FailureKind`,
and keeps the "right proof, wrong operation is a 404" distinction.  Status
codes and messages are illustrative, not prescribed.

**Where.**  `examples/consumer-access.ts`, run by `bin/check`.

**Done when.**  The example runs with the other examples, and adding a
hypothetical failure kind breaks the build.

**Tradeoffs.**  Publishing the mapping as a module would prescribe one
product's responses.  Keep it an example.

## 5. Exchange hardening review

**Why.**  Two independent implementations of the provider exchange are a
review opportunity.  The consumer's copy carries a bounded JWKS cache policy
and follow-time endpoint checks that upstream does not yet carry.

**Shape.**  Compare the consumer's `oidc.ts` with
`packages/cloudflare/src/exchange.ts`.  The consumer's policy is deliberate
and should be ported if the exchange moves wholly into the runtime:

- JWKS cached an hour by default, clamped to the issuer's `Cache-Control`
  max-age between one minute and 24 hours;
- an unknown `kid` forces one refetch, floored at 30 seconds; when the floor
  blocks it, verification falls back to the cached keys and fails closed;
- secure-endpoint checks at the point a URL is followed, and discovery
  validation.

The production login already exchanges and verifies through the runtime; the
consumer file is the development path and its tests.

**Done when.**  Each difference is either ported with a failing test first,
or recorded as rejected with its reason.  Nothing is copied wholesale.  The
dev-only path can then be deleted on the host side once the kit carries
`devidp` and the end-to-end exchange, provided the host keeps state, nonce,
PKCE, cookies, and return-path, and a test that the runtime wiring still
works.

**Tradeoffs.**  This is security-sensitive; a port needs its own tests.  The
consumer's duplicate exchange verification is deleted there, not absorbed
here.

## 6. Configuration-version tag rule

**Why.**  A configuration-only deployment changes sealed organization state
and keys, not code; a tag derived only from the commit cannot distinguish two
configurations.

**Shape.**  State the host-neutral rule in `docs/deploy_runbook.md`: a
configuration version's tag derives from the code commit plus a digest of the
organization ids and the live key set, so a repeat is idempotent and a
changed configuration cannot reuse an ambiguous tag.

**Done when.**  The rule is stated alongside the existing deploy and rollback
contract and cross-referenced from the configuration section of
`docs/cloudflare.md`.

**Tradeoffs.**  Deployment policy rather than platform behavior; keep it
host-neutral and free of consumer command names.  The tag-creating porcelain
stays with the host.

## 7. Policy bundle example (optional)

**Why.**  The consumer validates its own policy bundle with
`validatePolicyBundle` and `actionsOf`, and the pattern is worth showing.

**Where.**  `examples/` or `tests/`, over a synthetic bundle from the shipped
twins.

**Done when.**  The example validates a bundle and prints a role's actions;
it carries no customer policy.

**Tradeoffs.**  Low value; `org-hats` already validates bundles.

## Non-goals

- The consumer's `qm` porcelain: moving to Go, bespoke by decision.
- Routing and the registry, ops verbs, and the loopback client: host product.
- The notes relay and `moshpit`: agent tooling, owned by the consumer and not
  vendored.
- The consumer's policy bundle and exact product responses.
- The consumer's dev-only JWKS/ID-token verification: it duplicates
  `exchange.ts` and is deleted on the host side once the kit lands; not
  absorbed here.
- Any real roster, customer, hostname, or provider registration.

## Order

The boundary, the workerd placement, and the cookie-budget split are settled.
Land item 1 with item 2's exchange fixture; then items 3 and 4; then item 5;
then items 6 and 7.

Each item lands as its own commit with its own verification.  Documentation
items follow the documentation rule.  Code items run the workerd ring and,
before a release, the full local gate.

## Verification

- The portable ring stays workerd-free.
- New fixtures run under `pnpm check:cloudflare`.
- Documentation links resolve; absorbed prose names no consumer or customer.
- `bin/check-artifact` and the release metadata are untouched.

## Related

- [`docs/binding-conformance.md`](../docs/binding-conformance.md) — the
  contract the runner implements.
- [`docs/cloudflare.md`](../docs/cloudflare.md) — the reference runtime,
  provider exchange, and configuration.
- [`docs/envelope.md`](../docs/envelope.md) — envelope format and expiry.
- [`specs/authority.md`](../specs/authority.md) — refresh-handle and session
  invariants.
- [`docs/deploy_runbook.md`](../docs/deploy_runbook.md) — the host-neutral
  deploy contract.
