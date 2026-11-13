# Passkey consumer JSON options — deferred, decision recorded

## The work

Move the consumer wire to the browser's JSON WebAuthn path:
`PublicKeyCredential.parseCreationOptionsFromJSON()` for registration
options, `parseRequestOptionsFromJSON()` for assertion options, and
`credential.toJSON()` for the response. Modern Web Guidance documents this
as the current browser-facing shape
(`passkey-registration`, `passkey-authentication`), and the response half
already fits our runtime — the registration input takes the `response`
subset, and the assertion input takes `credential.id` with the response
fields.

The options half does not fit yet. `parseCreationOptionsFromJSON` reads
`user.id` as base64url-encoded bytes; `webauthnRegistrationOptions` states it
as the actor-id string. Reaching the one-liner therefore means one of:

- emit `user.id` as the base64url of the UTF-8 actor id, and keep `name` as
  the readable actor id; or
- add a second options method or a versioned wire shape, leaving the current
  one untouched.

Either is a consumer-visible change. Quartermaster's host and its
hand-written binding mirror already translate the options and must move in
step; the next `cloudflare-vX.Y.Z` announcement is the natural coordination
point.

## Why deferred

The current wire works, a real device completed enrollment and assertion on
`cloudflare-v0.21.0`, and the transaction cost of changing it is a coordinated
consumer bump for a convenience the manual conversions already provide.
Nothing is blocked on it; the runtime's verification is unchanged either way.

## Done when

- `webauthnRegistrationOptions` output passes through
  `parseCreationOptionsFromJSON` unchanged, with no host conversion for
  `challenge` or `user.id`;
- `docs/consumer-passkey.md` shows the JSON path as the primary sample, with
  the manual conversions reduced to the polyfill fallback;
- Quartermaster's mirror is updated and re-pinned in a relayed note, and a
  real-device registration and usernameless assertion pass against the
  announced tag.

## Evidence

The runtime options test asserting the new `user.id` wire, the consumer
sample checked against `parseCreationOptionsFromJSON`, Quartermaster's
re-pinned mirror, and the device ceremony recorded in the relay note.
