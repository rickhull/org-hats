# devidp — a test-only OpenID Provider

A development OpenID Provider used by the Cloudflare package's tests.  It
exercises the whole relying-party path — discovery, authorization, PKCE, the
token exchange, and ID-token verification against a published key set — with
no real provider and no network beyond the test.

It is a **test fixture**, not a package export and not a deployment.  It signs
nothing anyone should trust: an assertion about a subject, which is all a
provider produces.  The signing key is fixed so every isolate advertises the
key it signs with.

The routes are the protocol minimum:

- `/.well-known/openid-configuration`
- `/jwks`
- `/authorize` — validates the exact redirect allowlist, mints a signed code
  bound to the subject, nonce, client, redirect, and PKCE challenge
- `/token` — verifies the code and PKCE verifier, returns an ES256 ID token

Configuration used by the tests:

```text
DEVIDP_ENABLED=true
DEVIDP_SIGNING_KEY=<base64 PKCS#8 P-256 private key, fixed>
DEVIDP_CODE_KEY=<64 hex characters>
DEVIDP_CLIENT_ID=org-hats-dev
DEVIDP_REDIRECT_URIS=https://example.test/auth/callback
```

The fixed key is test material, not a secret.  A provider that redirects
anywhere is the one mistake worth not teaching, so the redirect allowlist is
exact even here.
