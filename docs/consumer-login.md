# Consumer login

*The host half of an OIDC login against the authority runtime.  The browser
routes, state, nonce, PKCE, cookies, and product responses are the host's.
The authority holds the provider registration and performs the token
exchange where the client secret is sealed.*

An identity provider authenticates the person and returns a signed ID
token.  The host never holds the client secret and never parses the token.
It starts a redirect, receives a code, and hands the authority exactly what
the callback holds.  The authority returns verified principal evidence;
issuance is a separate call.

## The flow

```text
browser ──► host /auth/start ──► provider /authorize ──► person authenticates
   ▲                                                        │
   │                                                        ▼
   └──── host /auth/callback ◄──── code + state ◄───────────┘
                    │
                    ├─ check state, spend the login attempt
                    ├─ authority: evidenceFromProviderCode(input)
                    │     discovery, token exchange, JWKS, ID-token verify
                    └─ authority: accessFromEvidence(evidence)
                          signed access envelope + refresh handle
                          → host session cookies
```

The route names are examples.  `consumer-session.md` covers the carriage
that follows: the two cookies, their lifetimes, rotation, and the size
budget.

## Who holds what

| Holder | Holds |
| --- | --- |
| Host | issuer, client id, redirect URI, state, nonce, PKCE verifier, return path, cookies, product responses |
| Authority runtime | reads the sealed registration; performs discovery, the authorization-code POST, JWKS, and ID-token verification; returns the evidence |
| Organization authority | stores the sealed registration and the principal links from a provider subject to an actor |
| Provider | the person's credentials and the signed ID token |

The host needs the public half — issuer and client id — to build the
authorize URL and to fetch the discovery document for the authorization
endpoint.  The authority resolves its own discovery, exchange, and JWKS by
issuer and client id; the secret never reaches the host or the browser.

## The three one-time values

- **state** binds the callback to this browser attempt; the host stores and
  checks it.  It is single-use and short-lived.
- **nonce** binds the ID token to this login request.  The host creates it
  and names the expectation; the authority verifies the token against it.
- **PKCE verifier/challenge** proves the code exchange belongs to the client
  that began the redirect.  The verifier is 43–128 unreserved characters;
  the challenge is `S256`.

All three are created host-side.  The authority verifies the nonce and the
code challenge; it never invents either.

## The runtime call

`evidenceFromProviderCode(input)` is a runtime-only method on the authority
entrypoint, not a portable-seam method.  Its input is exactly what the
callback holds:

```text
interfaceVersion, operationId, issuer, clientId, redirectUri,
code, codeVerifier, expectedNonce
```

There is no opaque provider handle, and nothing in the input is derivable
from one.  The verifier and redirect URI were created before the redirect.

The result is either `{ ok: true, evidence }` with a `PrincipalEvidence`
(`provider`, `subject`, and whatever `displayName`, `amr`, or `authTime` the
token carried), or `{ ok: false, failure }` from the closed taxonomy.
Issuance is the next call: `accessFromEvidence(evidence)`.

The authority finds the sealed registration by matching `issuer` and
`clientId` across its organization directory.  There is no global registry.
A missing or mismatched registration is `unauthenticated`, not a guess.

## Failure is a closed set

The provider exchange returns four kinds:

| Kind | When |
| --- | --- |
| `unauthenticated` | no matching sealed registration, a provider refusal, or a bad nonce, issuer, audience, expiry, or signature |
| `unavailable` | discovery, the token endpoint, or the key set could not be reached |
| `invalid-command` | an empty required field |
| `wrong-interface-version` | the caller and runtime disagree about the interface |

Later session and command calls add `expired`, `wrong-binding`,
`invalid-signature`, `not-admitted`, and `denied`.  The list is closed: a
new kind is an interface-version change, not an additive surprise.  The
host maps every kind to its own product response; `examples/consumer-access.ts`
is the reference mapping, and a `never` arm is what keeps it complete.

The exchange does not decide whether the person is admitted to the
operation.  Evidence in, issuance out: a known person with no grant is an
issuance or command failure, not an exchange failure.

## A refused first login

The authority keeps no unlinked-claim store, so a person the organization
has not linked cannot be remembered as a failed login.  The exchange still
returns the verified evidence before issuance is refused, which lets the
host audit the `(provider, subject)` pair an operator will bind later.  Log
that pair; never log the token, the code, or the client secret.

A login never creates an actor.  The principal link is an operator act, one
subject to one actor, and cross-organization ambiguity is `unavailable`
until an operator resolves it.

## Development providers

A test provider is useful for the full round trip and is not a product
surface.  A development provider is disabled in every deployment, uses
fixed synthetic subjects and a fixed test key, and cannot authorize a
product act.  The authority must still reach it over HTTPS, and its redirect
allowlist is exact even in development: a provider that redirects anywhere
teaches the one habit worth not teaching.

## What the host owns

Routes, response bodies, status codes, the login page, the return path, and
the session carriage are the host's.  Upstream owns the evidence exchange,
the envelope, and the refresh outcome; `specs/authority.md` and
`docs/envelope.md` are normative for those.

## Related

- [`consumer-session.md`](consumer-session.md) — cookies, lifetimes,
  rotation, and the size budget.
- [`cloudflare.md`](cloudflare.md) — the reference runtime and
  `evidenceFromProviderCode`.
- [`migration-v3.md`](migration-v3.md) — the interface-version cutover.
- [`../specs/authority.md`](../specs/authority.md) — refresh-handle rules.
