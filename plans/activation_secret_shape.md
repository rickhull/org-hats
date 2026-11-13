# Activation secret shape across the runtime surface

The public service binding has two shapes for the same secret:

- `activationRequest` returns the plaintext secret; `activationAccept` and
  `activationInspect` take `secret` and hash it at the boundary.
- `webauthnRegistrationOptions` and `credentialFromRegistration` take
  `secretHash`, the SHA-256 hex digest, directly.

Phase 3 recorded the WebAuthn shape as "the same shape every other
activation route takes". That is true of the coordinator's internal routes
and false of the public binding, and the difference is a host footgun: a
host must hash for WebAuthn and not for the activation methods, and a wrong
digest encoding (case, padding, base64 rather than hex) fails as the
uniform `unauthenticated`.

## The work

Make the public runtime surface uniform: every activation and WebAuthn
method takes `secret`, and the runtime hashes it at the boundary with the
existing SHA-256 hex rule. The coordinator's internal routes keep taking
`secretHash`; the storage shape does not change, and the portable seam is
untouched — `ActivationAcceptInput` already carries the secret.

- change `WebauthnRegistrationOptionsInput` and
  `CredentialFromRegistrationInput` to `secret: string`;
- hash in `packages/cloudflare/src/webauthn.ts` (one shared helper with the
  runtime's existing `hashActivationSecret`) and send the digest on the
  internal routes;
- update `docs/cloudflare.md`, `docs/consumer-passkey.md`, and the relay
  note's input shape;
- keep the coordinator's `webauthnRegister` and challenge routes unchanged.

**Done when:** a host passes the plaintext secret to every public
activation and WebAuthn method and nothing else, and passing a digest where
the secret belongs is refused uniformly.

**Evidence:** a red-first registration test where the plaintext secret
succeeds and a 64-character hex digest fails as `unauthenticated`, plus a
test that the activation and WebAuthn paths compute the same digest; the
docs and relay note updated in the same change.

**Trigger:** before the consumer's host integration settles. Until then the
documented WebAuthn contract is the digest, and the relay note says so; if
the change lands after the consumer wires it, the input rename is a
breaking surface change and needs a tag of its own.
