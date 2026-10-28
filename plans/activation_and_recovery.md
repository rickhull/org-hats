# Activation and principal recovery

**Status:** Accepted direction; contract and implementation not started.

## Goal

Add the authority-owned lifecycle that lets a pre-provisioned actor claim one
verified provider subject, and lets an organization administrator or operator
recover that actor by unlinking the subject. The lifecycle must preserve A10:
authentication creates no actor or grant, one `(provider, subject)` resolves
to one actor across the whole directory, and no unlinked evidence becomes a
roster.

This is Tier 1 only. Actor creation and profile updates, mutable organization
administrators, and team lifecycle are separate future work.

## Settled boundary

- An activation request names an existing organization actor. It stores the
  organization id, actor id, a hash of one opaque 16-byte secret, and lifecycle
  timestamps; it stores no evidence or plaintext secret.
- Creating the first administrator's request is an operator act. Creating any
  later request requires fresh evidence from an organization administrator.
- Accepting a request is anonymous except for the secret and verified evidence.
  It atomically validates the request and actor, enforces global subject
  uniqueness, binds the principal link, spends the request, and audits the act.
- Reissuing rotates the secret and revokes the previous request. Disabling or
  unlinking the actor revokes every outstanding request.
- Unlink is recovery, not offboarding. It leaves the actor enabled and its
  grants intact, but revokes refresh authority so live envelopes die at their
  existing bounded expiry. Ordinary unlink requires fresh evidence from an
  organization administrator; emergency unlink is an operator act.
- URLs, pages, QR rendering, delivery, login prompts, provider redirects, and
  source-based rate limiting remain host concerns. There is no short code.

## Decisions required before implementation

These decisions are part of the contract slice, not details to discover while
writing an adapter.

1. **Public use-case shape.** `activation-request` returns a secret and
   `activation-accept` is claim-authorized, while today's `command` accepts
   only evidence or an access envelope and returns only a receipt. Specify
   whether activation is expressed as dedicated `AuthorityRuntime` methods or
   as an additive command/result family. Keep the operator transport outside
   the portable authorization vocabulary.
2. **Non-consuming inspection.** Quartermaster's link route validates before
   provider authentication without spending the request. Specify whether the
   portable seam exposes an activation-inspection use case, exactly what it
   reveals, and how expired, spent, revoked, and unknown secrets remain
   indistinguishable where disclosure would create an oracle.
3. **Directory-wide serialization.** The Cloudflare runtime currently scans a
   configured organization directory before binding inside one organization
   coordinator. Two concurrent binds can pass that read before either writes.
   Activation must not widen that race into a public path. Specify and test a
   per-subject serialization point, or another mechanism that makes the global
   one-subject/one-actor invariant true under concurrent accepts while keeping
   organization state single-writer.
4. **Retry results.** Define idempotency for request creation, repeated accept
   by the same subject after consumption, and unlink. A retried request must
   not silently mint a new plaintext secret that cannot be recovered from the
   committed result.
5. **Lifetime and hashing.** Record the default request lifetime, clock
   boundary, secret generation source, hash representation, and constant-time
   comparison requirements in the normative contract. A request export may
   contain only the hash and lifecycle state.

## Work plan

### 1. Specify the portable contract and invariants

Create the normative activation contract and amend A10 and the identity
boundary. Settle the five decisions above, the typed refusal taxonomy, audit
facts, state transitions, and interface-version consequence before changing
runtime code.

**Likely paths:** `specs/activation.md`, `specs/authority.md`,
`docs/authority_redesign.md`, `docs/cloudflare.md`, `src/authority/types.ts`.

**Done when:**

- Every request state and transition has one authoritative owner and a typed
  outcome.
- Operator and organization-administrator paths authorize the same business
  acts without putting an ops bearer token in the portable interface.
- The consumer can review one complete public seam, including inspection and
  retry behavior, before implementation begins.

**Evidence:** inspect the changed Markdown and interface declarations; no
application check applies until executable types change.

### 2. Land the portable activation slice

Implement request, non-consuming inspection if specified, and acceptance in
the in-memory reference. Keep secret plaintext return-once, state mutation,
principal binding, idempotency claim, and audit commit atomic. Refuse missing,
disabled, or already-linked actors and a subject linked to another actor;
repeat acceptance by the same subject according to the settled retry rule.

**Likely paths:** `src/authority/types.ts`, `src/authority/state.ts`,
`src/authority/organization.ts`, `src/authority/engine.ts`,
`tests/activation.test.ts`.

**Done when:**

- The portable tests cover issue, inspect, accept, expiry, rotation, replay,
  actor disable, actor claimed in the meantime, and conflicting subjects.
- No request state contains verified evidence or plaintext secrets.
- The existing refused first-login behavior remains unchanged until a claim is
  explicitly accepted.

**Evidence:** `node --test tests/activation.test.ts`, `pnpm check`, and
`pnpm build`; tracked `dist/` matches `src/`.

**Depends on:** task 1.

### 3. Land portable unlink and refresh revocation

Implement ordinary administrator-authorized unlink and the trusted operator
entry used by adapters. Remove exactly the target actor's principal link,
revoke its activation requests, and send retryable refresh-revocation work to
every affected operation without disabling the actor or revoking its grants.

**Likely paths:** `src/authority/types.ts`, `src/authority/organization.ts`,
`src/authority/state.ts`, `src/authority/outbox.ts`,
`tests/activation.test.ts`.

**Done when:**

- Unlink is idempotent under the settled retry contract and cannot unlink a
  different actor by presenting that actor's subject.
- New issuance fails after unlink; refresh fails after outbox delivery; a live
  envelope remains valid only until its original expiry.
- A fresh activation can bind a replacement subject to the still-enabled
  actor, while its grants remain unchanged.

**Evidence:** focused activation and engine tests, `pnpm check`, and
`pnpm build`.

**Depends on:** tasks 1 and 2.

### Checkpoint: portable semantics

- The public interface and conformance behavior are reviewed before the
  Cloudflare schema is treated as durable.
- `pnpm check` passes and `dist/` is current.
- No host presentation or delivery concept appears below the adapter seam.

### 4. Persist activation in organization authority

Add schema migration, export/restore coverage, request state, audit rows, and
transactional organization-coordinator behavior. No plaintext secret may
enter SQLite, state export, an audit fact, an error detail, or a log.

**Likely paths:** `packages/cloudflare/src/organization.ts`,
`packages/cloudflare/src/state.ts`,
`packages/cloudflare/test/organization.test.ts`,
`packages/cloudflare/test/state.test.ts`.

**Done when:**

- Upgrade from the current schema preserves existing organization state.
- Export/restore round-trips live, consumed, expired, and revoked requests
  using hashes only.
- Transaction tests prove that a refusal commits neither a bind nor a spent
  request nor an idempotency claim.

**Evidence:** focused Cloudflare organization and state suites.

**Depends on:** portable checkpoint.

### 5. Preserve global uniqueness during Cloudflare acceptance

Implement the task-1 directory serialization decision and route anonymous
acceptance through it before committing the organization-local bind. Fail
closed when directory state is unavailable, and prove that concurrent claims
for one subject cannot create two principal links.

**Likely paths:** `packages/cloudflare/src/index.ts`,
`packages/cloudflare/src/runtime.ts`, `packages/cloudflare/src/env.ts`,
`packages/cloudflare/test/runtime.test.ts`,
`packages/cloudflare/test/ops.test.ts`.

**Done when:**

- A deterministic concurrency test races two organizations and exactly one
  actor can own the subject.
- Same-actor retries return the settled idempotent outcome.
- Directory unavailability and ambiguity retain closed typed failures.

**Evidence:** focused runtime and ops suites.

**Depends on:** tasks 1 and 4.

### 6. Expose administrator and operator recovery paths

Wire fresh-evidence activation request and unlink through the runtime, and add
OPS_TOKEN-protected first-administrator request and emergency unlink routes.
Carry unlink refresh revocation through the durable outbox with retry and
lost-message repair behavior equivalent to actor disable, without changing
the roster projection's enabled state.

**Likely paths:** `packages/cloudflare/src/index.ts`,
`packages/cloudflare/src/runtime.ts`,
`packages/cloudflare/src/organization.ts`,
`packages/cloudflare/src/operation.ts`, relevant Cloudflare tests.

**Done when:**

- The ops routes are absent without valid operator authorization and never
  expose stored secret material after initial creation.
- Ordinary paths require fresh administrator evidence, not an operation
  envelope.
- Lost and duplicate outbox deliveries converge on revoked refresh records
  while the actor remains enabled.

**Evidence:** focused ops, runtime, organization, operation, and roster tests.

**Depends on:** tasks 3, 4, and 5.

### Checkpoint: reference runtime

- The portable and Cloudflare implementations pass the same activation and
  recovery conformance cases.
- State migration, export/restore, concurrent acceptance, and outbox recovery
  have explicit tests.
- `pnpm check:cloudflare` passes.

### 7. Close documentation, distribution, and consumer evidence

Document the final portable seam, Cloudflare routes and state, migration
impact, security boundary, and host responsibilities. Add conformance
inventory entries and consumer-surface type checks. Rebuild tracked
distribution output and run the full local gate.

**Likely paths:** `docs/`, `specs/`, `src/conformance.ts`, `tests/`, `dist/`,
and `packages/cloudflare/` documentation where required.

**Done when:**

- No binding behavior exists only in the Quartermaster relay or its private
  design documents.
- Public exports and examples use opaque secrets and contain no host route,
  delivery, or provider-specific policy.
- This plan can be removed because every done-when statement has durable
  evidence elsewhere.

**Evidence:** `pnpm verify`, `git diff --check`, and inspection of the built
`dist/` and changed documentation.

**Depends on:** reference-runtime checkpoint.

## Risks

| Risk | Consequence | Required mitigation |
| --- | --- | --- |
| Cross-organization accept race | One subject binds two actors | Settle and test serialization before adapter implementation |
| Secret leaks through observability or export | Claim takeover | Hash at rest; plaintext return-once; explicit log/export tests |
| Anonymous inspection becomes an actor oracle | Roster disclosure | Minimize response and collapse unusable-secret outcomes |
| Unlink is mistaken for offboarding | Enabled actor retains grants by design | Typed name, docs, audit text, and tests distinguish disable |
| Retry mints an unrecoverable second secret | Caller and authority disagree | Specify committed result/idempotency semantics first |
| Outbox loss leaves refresh alive | Recovery does not terminate sessions | Durable retry plus liveness/repair test; live envelope remains bounded |

## Completion

The plan is complete when a pre-provisioned actor can be claimed and
recovered through both reference implementations; every authorization,
refusal, retry, concurrency, revocation, and secret-handling invariant is
covered by the portable and Cloudflare gates; Quartermaster can integrate
without owning authority state; and `pnpm verify` passes with tracked `dist/`
current.
