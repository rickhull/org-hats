# Consumer session carriage

*How a host carries the signed access envelope and the refresh handle in a
browser session.  The routes, cookie names, and lifetime values belong to
the host.  The invariants here are what the authority's session contract
requires of any host that carries it in a browser.*

The authority issues an access envelope and states the refresh outcome; it
never reads a cookie and never knows a route.  A host that gets the carriage
wrong does not get a clean failure — the browser silently drops an oversized
cookie, and the login looks half-worked.  These are the rules that keep the
two sides honest.

## The two cookies

A browser session uses two host-only cookies:

- **Access** — the signed envelope, encoded for a cookie value.
- **Refresh** — the opaque handle that issuance returned, if it rotated.

Both are `__Host-` cookies: `Secure`, `Path=/`, no `Domain`, and `HttpOnly`.
`SameSite=Lax` is the reference choice; a stricter value is the host's call.
The names are the host's; only the attributes and the pairing are fixed.

The envelope is opaque to the host.  It does not parse the claims, choose a
hat, or derive a lifetime from anything but `exp`.

## Lifetimes and rotation

- The access cookie's `Max-Age` is exactly the envelope's remaining lifetime:
  `max(0, claims.exp - now)`.  It is not a fixed session length and never
  outlives the envelope.
- The refresh cookie's lifetime is the host's policy, bounded by the
  authority's rotation.  Rotation, not a host timer, is what ends a handle.
- A refresh handle is written only when issuance says it **rotated**.  A
  `kept` handle is not re-sent: the browser already holds it, and rewriting
  it would hide a host bug.
- A refused refresh, a revoked handle, and a logout all end the same way:
  both cookies are cleared.

## The size boundary

A browser caps one cookie at about 4 KB **including attributes**.  The host
reserves room for the attributes and measures the encoded envelope value,
not the raw JSON.  The reference budget is 3,800 bytes of encoded envelope;
a host may choose a tighter one.

The host refuses at issuance when the envelope exceeds its budget.  It does
not truncate, does not store a partial value, and does not let the browser
decide.  An envelope the browser drops is indistinguishable from a login
that half-worked.

Upstream documents the same 3,800-byte maximum as the figure a host should
plan around.  It does not add a size failure to the closed failure taxonomy:
the taxonomy has no "too large" kind, and an interface version is not worth
spending on it.  The host's refusal is therefore the binding check, and this
document is what makes the two limits agree.

The synthetic twins show why the check exists:

| Envelope | JSON bytes | Encoded bytes |
| --- | ---: | ---: |
| Professional operation, a coordinator | 600 | 904 |
| Festival, a gate administrator | 706 | 1,054 |
| Festival, site-wide read reach | 5,723 | 7,843 |

The last row is a real envelope the authority can issue today.  A host that
admits that reach in one envelope must use another carriage for it or narrow
the read projection; a 4 KB cookie cannot hold it, and no host-side check
makes it fit.  The portable engine does not bound envelope size, so the host
budget is the only boundary in force.

## Login state and the return path

The login round trip carries three one-time values, all created host-side:

- **state** — CSRF binding between the redirect and the callback;
- **nonce** — binds the ID token to this login; the authority verifies it;
- **PKCE verifier/challenge** — proves the code exchange belongs to the
  client that began the redirect.  The verifier is 43–128 unreserved
  characters; the challenge is `S256`.

The host stores the attempt keyed by `state`: operation, issuer, client id,
redirect URI, verifier, nonce, return path, and expiry.  The record is
single-use and short-lived; consuming it before the exchange is what makes a
replayed callback fail.  The state cookie is short-lived and is cleared on
every outcome.

The return path is an allowlisted value derived from the operation's own
sites, never a caller-supplied URL.  A caller that names an unlisted path is
refused before the provider is contacted.

## Refusal is one path

Every refusal clears both session cookies and the login-state cookie.  The
host returns its own product response; the authority's failure taxonomy is
closed and the host maps every kind.  A refused issuance may be audited with
the provider and subject the evidence carried — never a token, a code, or a
client secret.

## What upstream does not own

Routes, cookie names, response bodies, status codes, redirect policy, and
the choice between a cookie and another carriage are the host's.  Upstream
owns the envelope, the refresh outcome, and the provider exchange; this
document is the contract at the boundary between them.

## Related

- [`envelope.md`](envelope.md) — the envelope format, expiry, and claims.
- [`cloudflare.md`](cloudflare.md) — the reference runtime and the
  provider-callback exchange.
- [`../specs/authority.md`](../specs/authority.md) — A7, refresh handles die
  with the authority that issued them.
