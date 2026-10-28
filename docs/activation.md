# Actor activation and principal recovery

Activation links a pre-provisioned organization actor to one verified
provider subject. It never creates an actor, grant, participation, or
administrator. The authority owns the request lifecycle; the host owns URLs,
delivery, pages, provider redirects, and source-based rate limiting.

## Portable lifecycle

`AuthorityRuntime` exposes three activation calls in addition to its existing
session and command methods:

- `activationRequest` requires fresh evidence from an administrator of the
  target organization. It returns a request id, a 22-character return-once
  secret, and its expiry. Retrying rotates: every earlier active request for
  the actor is revoked and only the newly returned secret remains usable.
- `activationInspect` is non-consuming and returns only `{ usable: true }`.
  Unknown, expired, consumed, and revoked secrets return the same
  `unauthenticated` failure and public detail.
- `activationAccept` takes the bearer secret and verified evidence. The
  secret selects the organization and actor; neither is caller input. The
  authority atomically binds `(provider, subject)`, consumes the request, and
  audits the act. Repeating the consumed secret with the same subject returns
  `applied: false`; a different subject receives the uniform unusable result.

Requests expire after 24 hours by default. The in-memory reference runtime
allows the lifetime and secret generator to be injected for deterministic
tests. Production secrets contain 128 random bits and only their SHA-256
digests are stored. Request state contains no evidence, display name, or
plaintext secret.

Issuance intentionally has no idempotency key. Replaying a return-once secret
would require retaining recoverable plaintext; instead a retry revokes the
unknown-outcome secret and returns a replacement. Hosts must not apply generic
automatic POST retries, and delivery may present an older invalid link after a
newer one if notification ordering is not preserved.

## Recovery commands

Two fresh-evidence organization commands complete the lifecycle:

- `revoke-activation` idempotently revokes every active request for the actor
  without changing the actor, links, grants, or participation.
- `unlink-principal` idempotently removes every principal link targeting the
  actor, revokes active requests, and revokes refresh authority through the
  durable outbox. It leaves the actor enabled and its grants intact, so a new
  activation can bind replacement evidence. Existing signed envelopes remain
  valid only until their bounded expiry.

An access envelope cannot authorize either recovery command. The ordinary
path requires fresh evidence from an organization administrator. The
Cloudflare adapter also exposes OPS_TOKEN-protected equivalents for the first
administrator and for emergency recovery when the administrator is locked
out.

## Concurrent claims

Actors are organization-scoped; provider subjects are external account ids.
There is no platform-global user record. The two uniqueness directions are:

```text
(provider, subject) -> at most one (organization, actor)
activation actor    -> at most one accepted provider subject
```

The in-memory runtime commits each acceptance synchronously against its
engine-wide link map. Cloudflare routes every bind and activation acceptance
through `PrincipalSubjectGuard`, a deterministic Durable Object keyed by the
SHA-256 digest of canonical `[provider, subject]`. Its explicit queue keeps
the directory scan and target commit exclusive across awaited calls. The
target organization Durable Object serializes different subjects racing for
one actor. Exactly one claim wins; no check-then-bind race can create two
owners.

The guard owns serialization, not identity data. Organization authority
remains the durable owner of the principal link and audit. The configured
organization directory must contain every organization that can hold a link;
an unavailable member fails the bind closed.

