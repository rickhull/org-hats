# Consumer passkey login

*The host half of a local-credential ceremony against the authority runtime.
The runtime mints the options and verifies the proof; the host owns the
browser call, the encodings, and the session that follows. The host names
the operation for login and the claim secret for enrollment — never an
organization. The design
decisions are normative in
[authority_redesign.md](authority_redesign.md#local-credentials-passkeys--design-decisions).*

A passkey is a principal link like any other: `(provider: "webauthn",
subject: <credential id>)`. There is no identity provider on this path and
no password. Enrollment binds through a return-once activation claim; login
is usernameless, because the credential is discoverable.

## The flow

```text
enrollment
  host ── webauthnRegistrationOptions(secret, rpId) ──► runtime
    ◄── challenge, rp, user, pubKeyCredParams, authenticatorSelection
  browser ── navigator.credentials.create({ publicKey }) ──► authenticator
  host ── credentialFromRegistration(secret, rpId, expectedOrigin,
                                      response) ──► runtime
    ◄── { ok, actorId }        claim consumed; link + credential stored

login
  host ── webauthnAssertionOptions(operationId, rpId, expectedOrigin)
    ◄── challenge bound to that operation, origin, and RP id
  browser ── navigator.credentials.get({ publicKey }) ──► authenticator
  host ── credentialFromAssertion(operationId, credentialId, response)
    ◄── { ok, envelope, refresh }
        challenge consumed in the operation; counter advanced at the
        organization that owns the credential
```

The host turns the returned `envelope` and `refresh` into its own session
exactly as it does after an OIDC login; see
[consumer-session.md](consumer-session.md). The runtime holds no cookie and
writes no browser state.

## Who holds what

| Holder | Holds |
| --- | --- |
| Host | the activation secret until it is delivered, the browser calls, `rpId` and `expectedOrigin`, cookies, product responses |
| Browser/authenticator | the private key and (for a discoverable credential) the user handle; it signs only the challenge the runtime minted |
| Organization authority | the principal link `(webauthn, credential id)`, the public key, the sign counter, and the backup flags |
| Operation authority | the one-shot assertion challenges, bound to the operation, origin, and RP id |
| Runtime surface | the ceremony options, organization resolution, the proof verification, and issuance through the ordinary session path |
| Operator | activation-mint, a federated link for a passkey actor, and recovery; a direct passkey-add ceremony is not built |

The WebAuthn methods take the activation secret itself and hash it at the
boundary with the same SHA-256 rule `activationAccept` uses; the runtime
stores only the digest. Pass the same secret to both WebAuthn calls.

## Registration

`webauthnRegistrationOptions` takes the claim secret and resolves the
organization it names across the runtime's directory; the host never sees
or supplies that id. It returns options that are already
`PublicKeyCredentialCreationOptions` except for two browser conversions:

- `challenge` is base64url text — decode it to bytes;
- `user.id` is the actor id as a string — encode it with `TextEncoder`.

`rp.id` is the relying-party id the host serves (the zone apex by
contract), `residentKey` is `"required"` so the credential is discoverable,
`attestation` is `"none"`, and the only offered algorithm is ES256.

```js
const options = await runtime.webauthnRegistrationOptions({
  interfaceVersion, secret, rpId,
});
const credential = await navigator.credentials.create({ publicKey: {
  challenge: base64urlToBytes(options.challenge),
  rp: options.rp,
  user: { ...options.user, id: new TextEncoder().encode(options.user.id) },
  pubKeyCredParams: options.pubKeyCredParams,
  authenticatorSelection: options.authenticatorSelection,
  attestation: options.attestation,
  timeout: options.timeout,
} });
```

Encode `credential.response.attestationObject` and
`credential.response.clientDataJSON` as unpadded base64url and call
`credentialFromRegistration` with the same `secret`, `rpId`, and the
exact `expectedOrigin` the browser spoke to. On success the activation claim
is spent and the actor can log in; a failure is uniform, and a host cannot
tell "already linked" from "bad secret" (see below).

A claim enrolls at most one credential, and only for an actor with no links.
The two mixed-actor directions are not symmetric today:

- **Passkey first, federated second.** An actor with a passkey can gain a
  federated link through `/ops/organization/principal-link`; both methods
  then work.
- **Federated first, passkey second.** There is no self-serve door and no
  direct operator enrollment ceremony. The operator path is the identity
  reset in [Recovery](#recovery): unlink every link (which removes the
  actor's links and stored passkey), enroll the passkey through a fresh
  claim, then re-bind the federated subject. A direct per-actor passkey
  enrollment is deferred alongside the per-link retire, with the same
  trigger: a consumer's runbook needing a mixed actor without a reset.

## Login

`webauthnAssertionOptions` mints a single-use challenge **in the operation
coordinator**, bound to the `operationId`, `rpId`, and `expectedOrigin` in
the call. The operation is what the host knows before a session exists; the
organization is resolved only after the browser returns. Pass no
`allowCredentials` list: the credential is discoverable, so the
authenticator finds the user handle itself and the flow needs no username.

```js
const options = await runtime.webauthnAssertionOptions({
  interfaceVersion, operationId, rpId, expectedOrigin,
});
const credential = await navigator.credentials.get({ publicKey: {
  challenge: base64urlToBytes(options.challenge),
  rpId: options.rpId,
  timeout: options.timeout,
} });
```

Encode the response and send the credential's `rawId` as `credentialId`:

```text
credentialId, response.authenticatorData, response.clientDataJSON,
response.signature        // all unpadded base64url
```

After verifying the signature the runtime resolves the credential id across
its organization directory, consumes the challenge in the operation, advances
the stored sign counter at the organization that owns the credential, and
returns `{ envelope, refresh }`. Two matches for one credential id are
`unavailable`, never a guess. Issuance is the ordinary path:
evidence is `provider: "webauthn"`, `subject: <credential id>`,
`amr: ["webauthn"]`, and `auth_time` is the verification instant. A disabled
actor is `not-admitted`; a revoked participation behaves as it does for a
federated login.

## Failure is uniform

After a well-formed ceremony, the runtime refuses with `unauthenticated` for
every condition a caller might otherwise enumerate: unknown credential,
unknown, spent, or expired challenge, origin or RP-id mismatch, a signature
that does not verify, a credential with no principal link, and a counter
regression. The host shows the generic message; the person's next step is to
retry, and if that fails, to ask the operator.

The rest of the taxonomy is the usual closed set:

| Kind | When |
| --- | --- |
| `invalid-command` | malformed base64url, client data, or authenticator data |
| `invalid-signature` | a packed self-attestation whose signature does not verify (registration only) |
| `unavailable` | a coordinator could not be reached, or the operation is not bootstrapped |
| `wrong-binding` | the named operation does not exist |
| `not-admitted` | the actor is disabled at issuance |
| `wrong-interface-version` | the host and runtime disagree about the interface |

Enrollment failures are uniform in the same way: an unusable, spent, or
revoked claim and an actor already holding a link all say
`activation is not usable`. The page should not promise self-serve
replacement, and an already-linked actor needs an operator reset before a
passkey can be added.

## Counter rule

An authenticator that reports a zero sign counter is accepted forever; that
is the synced-passkey signal, and most platform passkeys use it. A stored
nonzero counter must strictly advance, and a regression is refused, not
logged. The challenge consume and the counter advance are separate
coordinator acts — the operation's consume is the replay control, the
organization's counter update is a compare-and-set — so two concurrent
assertions still cannot both advance, and a failure between the two is a
failed login, not a replay window.

## Recovery

A lost authenticator is an operator act, in this order:

1. `POST /ops/organization/unlink-principal` — the documented identity
   reset. It removes **every** link the actor holds and the stored passkey
   with them.
2. Mint a new activation request (`POST /ops/organization/activation-request`).
3. Repeat enrollment through the claim.

Under a mixed actor the unlink also removes the federated link and the
re-enrollment must rebuild everything. A per-link retire verb is deferred
until a consumer's runbook needs it; it travels with any revisit of the
claim-path guard, not before.

## Preconditions

- **The relying-party id is the zone apex.** One credential then works at
  every operation hostname, including hostnames that did not exist at
  enrollment. The `rpId` given to the options, to registration verification,
  and to assertion-option minting must be the same apex.
- **Zone purity.** The deployment must control every subdomain of the zone.
  A subdomain can request the parent relying-party id, so a zone the
  deployment does not fully control must not use apex-scoped credentials.
- **Exact origin.** `expectedOrigin` is the origin the browser spoke to, not
  a pattern. TLS and the host's routing are the host's duty.
- **No attestation policy.** `none` and packed self-attestation are
  verified, but no trust path, authenticator model, or device fleet is
  demanded. A managed-device policy is not available from this surface.

## What the runtime does not say

The assertion carries the authenticator's user-verification flag, but the
runtime does not infer it: `amr` is `["webauthn"]` whether the person
verified with a PIN or biometric or only demonstrated presence.
`userVerification` is `"preferred"` in the options. A consumer that needs
step-up must not read one into the envelope; surfacing user verification as
an additional `amr` value is an additive decision that waits for a consumer
with that requirement.

## Related

- [`consumer-session.md`](consumer-session.md) — cookies, lifetimes,
  rotation, and the size budget.
- [`activation.md`](activation.md) — the return-once claim, refusal
  uniformity, and recovery commands.
- [`cloudflare.md`](cloudflare.md#local-credentials-passkeys) — the runtime
  surface, storage, and the internal ceremony routes.
- [`authority_redesign.md`](authority_redesign.md#local-credentials-passkeys--design-decisions)
  — the normative decisions.
- [`threat_model.md`](threat_model.md) — the passkey threats, mitigations,
  and residual risks.
