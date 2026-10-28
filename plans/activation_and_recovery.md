# Activation and principal recovery

**Status:** Contract approved 2026-10-28; implementation in progress.

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

## Approved contract

This section settles the cross-runtime decisions before executable types or
storage schemas make them expensive to change. It is the implementation
contract until the work lands and its durable facts move to `docs/` and
`specs/`.

### Portable surface

Activation adds three dedicated methods to `AuthorityRuntime`. They are
additive calls under interface version 3; the failure taxonomy and envelope
format do not move. `unlink` remains a typed organization command because it
returns an ordinary idempotent receipt and uses the existing command
authorization machinery.

```ts
interface ActivationRequestInput {
  readonly interfaceVersion: 3;
  readonly organizationId: string;
  readonly actorId: string;
  readonly evidence: PrincipalEvidence;
}

interface ActivationRequestResult {
  readonly requestId: string;
  readonly secret: string;
  readonly expiresAt: number;
}

interface ActivationInspectInput {
  readonly interfaceVersion: 3;
  readonly secret: string;
}

interface ActivationInspection {
  readonly usable: true;
}

interface ActivationAcceptInput {
  readonly interfaceVersion: 3;
  readonly secret: string;
  readonly evidence: PrincipalEvidence;
}

interface ActivationAcceptance {
  readonly applied: boolean;
  readonly actor: {
    readonly organizationId: string;
    readonly actorId: string;
  };
}

interface AuthorityRuntime {
  // Existing four methods stay unchanged.
  activationRequest(input: ActivationRequestInput):
    Promise<ActivationRequestResult | Failed>;
  activationInspect(input: ActivationInspectInput):
    Promise<ActivationInspection | Failed>;
  activationAccept(input: ActivationAcceptInput):
    Promise<ActivationAcceptance | Failed>;
}
```

The ordinary unlink body joins `OrganizationCommand`:

```ts
{ readonly kind: "unlink-principal";
  readonly organizationId: string;
  readonly actorId: string }
```

It requires `fresh-evidence`; an access envelope is refused for this
organization-scoped recovery act. The authorization's operation id has no
authority meaning for this command and is retained only because the existing
`CommandAuthorization` shape requires it. Removing that accidental field is
outside Tier 1.

The first-administrator request and emergency unlink are trusted adapter
operations, not new portable authorization variants. The in-memory handle may
expose an operator test harness; Cloudflare exposes OPS_TOKEN-protected routes.
No ops token, provider credential, or browser protocol value enters
`AuthorityRuntime`.

### Request state and secret

One request record contains:

```text
request id
organization id
actor id
SHA-256(secret)
issued at
expires at
consumed at, or null
revoked at, or null
```

The authority generates 16 random bytes with a cryptographic generator and
returns their unpadded base64url encoding (22 characters). Only the SHA-256
digest is stored. The default lifetime is 24 hours and is configurable by the
reference-engine constructor/runtime configuration; `now >= expiresAt` is
expired. Request exports, audit facts, errors, and logs never contain the
plaintext secret. Tier 1 retains terminal request rows; a later compaction
policy may remove them only after the longest supported retry window.

There is at most one active request per actor. Issuing another request
atomically revokes every earlier active request for that actor and returns the
only usable secret. Request creation intentionally takes no idempotency key:
retrying is a rotate-and-return operation, so a response lost at an unknown
outcome is recovered by retrying and invalidating the possibly committed
secret. An idempotency key cannot safely replay a return-once plaintext value
that authority does not store.

An enabled actor with any principal link cannot receive a request. The actor
may keep grants while unlinked; activation itself creates no actor, grant,
participation, or administrator standing.

### Inspection

Inspection is non-consuming because browsers, chat clients, and scanners may
prefetch a link. It returns only `usable: true` for an active request. It returns
the same `unauthenticated` failure with the same public detail for an unknown,
expired, consumed, or revoked secret. It never returns organization id, actor
id, display name, provider data, or request state.

Possession of a valid secret therefore proves only that an activation may
continue. The host may name the operation from its own route; it cannot use
inspection as a roster oracle. A host with an already authenticated session
may proceed directly to acceptance to obtain the same-subject replay outcome.

### Acceptance

Acceptance derives the request and target actor from the secret; neither id
is caller input. One atomic organization mutation requires:

1. the request exists, is active, and is not expired;
2. the actor exists, is enabled, and still has no different principal link;
3. the verified `(provider, subject)` is unbound globally, or already resolves
   to this actor; and
4. binding the link, consuming the request, and writing the audit event all
   commit together.

The first application returns `applied: true`. Repeating the consumed secret
with the same subject returns the same actor with `applied: false`; it does not
store evidence on the request to achieve this, but compares the durable
principal link. A different subject, a request whose actor was linked by a
different subject, and every unusable-secret state fail without mutation.
Anonymous unusable-secret failures are uniform. A subject already bound to a
different actor is `denied`; directory ambiguity or unavailability is
`unavailable`.

### Directory-wide uniqueness

The current Cloudflare check-then-bind directory scan is insufficient under
two concurrent writers. Every principal-link writer — existing operator bind
and activation acceptance — must enter one deterministic coordination point
keyed by `SHA-256(canonicalJson([provider, subject]))` before scanning and
binding. The point owns serialization, not the principal-link fact; the
organization remains the sole durable owner of its link and audit.

The coordination point must keep one subject's scan-and-bind critical section
exclusive across awaited organization calls. It may be a subject-keyed
Durable Object or an equivalent mechanism with the same tested guarantee. A
plain Worker scan, an unlocked check followed by a write, or a local SQL
transaction in only the target organization does not satisfy the contract.
All binding entry points use the same guard, so activation cannot race manual
operator recovery.

### Unlink and revocation

`unlink-principal` removes every principal link targeting the named actor. It
leaves the actor enabled and leaves grants and participation unchanged. In the
same organization commit it revokes outstanding activation requests, records
the idempotency claim and audit, and emits durable refresh-revocation work for
operations. Duplicate delivery is harmless.

New evidence resolution fails immediately after unlink. Refresh fails once the
operation applies the revocation; the operation's existing organization
liveness read is the fail-closed repair for a lost message. Already-issued
envelopes remain valid only until their signed expiry. A later request can
bind a replacement subject to the actor.

Emergency unlink performs the same mutation through the operator adapter. It
does not bypass the state transition and is not offboarding; `disable-actor`
remains the offboarding act.

### Failure mapping

No new failure kind is added.

| Condition | Failure kind |
| --- | --- |
| Wrong interface version | `wrong-interface-version` |
| Caller evidence has no principal link | `unauthenticated` |
| Caller is not an organization administrator | `denied` |
| Target organization differs from caller organization | `wrong-binding` |
| Request target actor does not exist | `invalid-command` |
| Request target actor is disabled | `not-admitted` |
| Request target actor already has a link | `denied` |
| Inspect/accept secret is unknown, expired, consumed by another subject, or revoked | `unauthenticated` with one uniform detail |
| Accept subject belongs to another actor | `denied` |
| Directory is ambiguous or unavailable | `unavailable` |

Operator HTTP status mapping remains adapter policy and uses the existing
structured failure body.

### Threat model and boundaries

Trust crosses at fresh evidence, the bearer secret, OPS_TOKEN routes, and the
configured organization directory. Assets are the principal link, the
pre-provisioned actor's grants, activation secrets, and refresh authority.

- A stolen secret can claim its actor until expiry; short life, single use,
  rotation, and audit bound the damage. It is never logged or stored in
  plaintext.
- Secret enumeration receives uniform failures and no actor identity.
- A malicious caller cannot substitute actor or organization ids during
  acceptance because the secret selects both.
- A non-admin cannot mint or unlink through the portable surface; an operator
  path requires OPS_TOKEN and is not publicly routed in production.
- Concurrent subjects and organizations cannot defeat one-subject/one-actor;
  the shared guard is part of the security invariant, not an optimization.
- Unlink revokes refresh authority but intentionally does not promise
  immediate invalidation of live envelopes.

No new dependency, provider integration, browser route, cookie, address, or
personal-data field enters org-hats.

### Revocation act

One consumer requirement is not representable by the accepted three
mutations: the office wants to revoke an unclaimed request while leaving its
actor enabled. Reissue rotates rather than revokes, unlink requires a link,
and disable is offboarding. Minting and discarding a replacement would leave
an active request and is not an honest revocation.

Add an idempotent `revoke-activation` organization command,
authorized by fresh administrator evidence with an operator equivalent. It
revokes every active request for the actor and changes nothing else.

### Approval record

Rick approved these six decisions on 2026-10-28:

1. three additive activation methods; unlink stays a command;
2. inspection reveals only usability and uses one uniform unusable result;
3. request retry means rotate-and-return, with no idempotency key;
4. all Cloudflare binding writers share a deterministic subject guard;
5. unlink removes every link to the actor and revokes refresh, not grants; and
6. add `revoke-activation` to close the standalone-revocation gap.

## Work plan

### 1. Specify the portable contract and invariants

Review the proposed activation contract, then amend A10 and the identity
boundary with the implementation. Settle the six approval decisions, the
typed refusal taxonomy, audit facts, state transitions, and interface-version
consequence before changing runtime code.

**Likely paths:** `docs/activation.md`, `specs/authority.md`,
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
