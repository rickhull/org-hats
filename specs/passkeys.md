# Passkeys — the invariants of the local-credential surface

Distilled from [`docs/consumer-passkey.md`](../docs/consumer-passkey.md),
[`docs/cloudflare.md`](../docs/cloudflare.md#local-credentials-passkeys), and
the implementation in `packages/cloudflare/src/webauthn*`. Ids are stable; see
the [README](README.md) for the protocol.

### W1 — The registration wire is browser-shaped

`webauthnRegistrationOptions` returns options that are
`PublicKeyCredentialCreationOptions` except for two host conversions:
`challenge` is base64url text and `user.id` is the actor id as a string. Every
other member is passed through unchanged, including `pubKeyCredParams`, which
states the offered algorithm in the browser's COSE form —
`{ type: "public-key", alg: -7 }` — never as a JOSE name. `rp.id` is the
host's relying-party id, `residentKey` is `"required"`, and `attestation` is
`"none"`.

*Held by:* the registration suite's `[W1]` options test, which asserts the
exact shape and its rotation; the consumer document's two named conversions.
*If it breaks:* the browser refuses the ceremony before it starts — a real
device rejected a JOSE-shaped entry with "Missing required 'type' member" —
and the host, not the runtime, becomes the place a wire change has to be
discovered.

### W2 — Verification runs in a fixed order and refusal is uniform

Registration verifies the stored challenge, then client data (ceremony type,
challenge, origin), then the RP-id hash, then decodes the attestation, then
the packed self-attestation signature when present, then commits the link,
credential, and claim consume in one transaction. Assertion verifies client
data and the challenge's origin, parses authenticator data and requires user
presence, checks the RP-id hash, resolves the credential across the
directory, verifies the signature, consumes the challenge in the operation,
advances the counter at the owning organization, and issues.

A malformed input is `invalid-command`; an unreachable or ambiguous directory
is `unavailable`; a missing operation is `wrong-binding`; a disabled actor is
`not-admitted`; an interface mismatch is `wrong-interface-version`. Every
other well-formed failure — unknown credential, unknown or spent challenge,
origin or RP-id mismatch, bad signature, no principal link, counter
regression — is `unauthenticated`.

*Held by:* the `[W2]` mismatch tests in both ceremony suites; the closed
`FailureKind` union both runtimes share.
*If it breaks:* the refusal becomes an enumeration oracle for credentials,
organizations, and ceremony state, and a caller can tell "wrong origin" from
"unknown credential" without proving anything.

### W3 — A ceremony challenge is single-use and scoped

A registration challenge is minted against the activation claim's digest and
rotates on every options call. An assertion challenge is minted and consumed
inside the operation coordinator, bound at mint to the operation id, relying-
party id, and expected origin. Consume is the replay control; the
organization's counter compare-and-set is the ordering control. A failure
between the two is a failed login, not a replay window.

*Held by:* the registration `[W3]` consume test and the assertion `[W3]`
replay test; the operation coordinator's consume transaction.
*If it breaks:* a captured ceremony can be replayed, and a stale options page
can satisfy a later registration.

### W4 — The relying-party id and origin are bound exactly

The host's `rpId` is the zone apex by contract; the same value is minted into
the options, verified against the registration's authenticator data, and
bound into every assertion challenge. `expectedOrigin` is the exact origin the
browser spoke to, not a pattern. The host's `operationId`, `rpId`, and
`expectedOrigin` are caller configuration; the runtime re-derives each
binding from the ceremony bytes rather than trusting the call.

*Held by:* the assertion `[W4]` binding-and-rotation test; the registration
and assertion origin/RP mismatch refusals.
*If it breaks:* a credential for one host authenticates at another, or a
subdomain the deployment does not control can mint an apex-scoped credential.

### W5 — The counter rule is explicit about synced passkeys

A zero sign counter is accepted forever; that is the synced-passkey signal,
and most platform passkeys use it. A stored nonzero counter must strictly
advance. A regression is refused, not logged, and the advance is a
compare-and-set at the organization that owns the credential.

*Held by:* the assertion suite's `[W5]` counter test; the organization
coordinator's counter update.
*If it breaks:* a cloned authenticator replays a captured assertion, or a
synced passkey is refused forever for reporting zero.

### W6 — Enrollment stays claim-bound and unlink stays actor-wide

One activation claim enrolls at most one credential, and only for an actor
holding no link; the claim-path guard refuses an actor that holds any link.
Unlink is an actor-wide identity reset that removes every link and the stored
passkey; recovery is unlink, re-mint, enroll. A federated link added to a
passkey actor is an ordinary `principal-link`; adding a passkey to an
already-linked actor is the same reset, never a second claim.

*Held by:* the registration `[W6]` strict-guard and claim-consume tests; the
activation claim's any-link refusal.
*If it breaks:* a leaked activation secret grafts a credential onto an
already-claimed actor, which is the anti-graft property the claim exists to
hold.

### W7 — The parser set is closed, bounded, and refuses by name

The runtime accepts a fixed subset of the formats it must verify: RFC 8949
CBOR within depth and item bounds, COSE EC2 ES256/RS256 keys, the
attestation and assertion authenticator-data shapes it reads, and DER
conversion for packed self-attestation. Every other construct is refused by
name, never skipped or guessed. Cryptography stays in `crypto.subtle`; no
third-party WebAuthn implementation sits in the verification path.

Modern Web Guidance recommends a vetted library for server-side WebAuthn.
That rule addresses general implementations with a broad parser surface and
policy set; this surface is a closed verifier over fixed formats, and the
narrower parser is the easier one to bound and test. The recorded escape
hatch is unchanged: a pilot interop failure that cannot be reproduced and
fixed in one work session reopens the additive `@simplewebauthn/server`
option ([`docs/authority_redesign.md`](../docs/authority_redesign.md#local-credentials-passkeys--design-decisions)).

*Held by:* the decode suite's `[W7]` refusals for unknown constructs,
truncation, trailing bytes, extension blocks, and nesting beyond the bound;
the named parser boundaries in `webauthn/{cbor,authenticator,verify}.ts`.
*If it breaks:* unbounded or lenient parsing turns untrusted ceremony bytes
into unbounded work or a silently accepted construct, and the difference
between "we verify this" and "we skipped what we did not understand"
disappears.

### W8 — Passkey evidence is ordinary principal evidence

A verified assertion resolves a principal link `(provider: "webauthn",
subject: <credential id>)` and issues through the same session path as a
federated login: `amr: ["webauthn"]`, `auth_time` at the verification
instant, the ordinary `not-admitted` and revocation gates. The runtime holds
no cookie, writes no browser state, and does not promote the authenticator's
user-verification flag into `amr`.

*Held by:* the assertion `[W8]` end-to-end issuance test; the shared
`accessFromEvidence` path both login methods reach.
*If it breaks:* passkeys become a second session model with its own policy,
and the envelope stops being the one place a host reads authentication facts.

### W9 — The JSON registration wire needs no host conversion

`webauthnRegistrationOptionsJson` returns the same ceremony with `challenge`
and `user.id` as base64url text, so
`PublicKeyCredential.parseCreationOptionsFromJSON` accepts the result
unchanged. The host-wire method and its two conversions remain available and
unchanged; the JSON method is additive, not a replacement. Assertion options
already carry base64url `challenge` and `rpId`, so
`parseRequestOptionsFromJSON` needs no separate method.

*Held by:* the registration suite's `[W9]` JSON-options test, which decodes
`user.id` back to the actor id and checks the browser-shaped members.
*If it breaks:* every host reimplements the two conversions, and a wire
mistake surfaces only in a person's browser.
