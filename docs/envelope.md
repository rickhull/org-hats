# The access envelope

*The v1 format contract for `SignedAccessEnvelope`. The TypeScript types in
`src/contract.ts` are the normative shape; this document records the
encoding, signing, and compatibility rules the types cannot. The format is
owned by `org-hats`; issuers and verifiers declare envelope-version overlap
and neither invents fields silently (see
[authority_redesign.md](authority_redesign.md) § Access).*

## Envelope

```
SignedAccessEnvelope {
  format: "org-hats.access"     // constant; anything else is not ours
  v: 1                          // envelope format version
  keyId: string                 // names the signing key that made signature
  claims: AccessEnvelopeClaimsV1
  signature: string             // base64url, below
}
```

The envelope is opaque to product code. Hosts transport it — typically as a
cookie value, using URI-encoded JSON or base64url — and hand it to the
verification-only `org-hats/access` module. Product code never reads the
claims; the session layer reads only `exp` to size the cookie. Only the
issuer writes them.  The carriage rules — the encoding, cookie attributes,
lifetimes, the 4 KB budget, and refresh rotation — are
[`consumer-session.md`](consumer-session.md).

## Claims

| Claim | Meaning |
| --- | --- |
| `v` | claims format version; it must equal the envelope's `v`, and an unrecognized value is `wrong-interface-version` |
| `interfaceVersion` | the authority interface that issued these claims — provenance, not a readability gate (see § Version and key compatibility) |
| `operationId` | the one operation this envelope is scoped to |
| `actor` | `(organizationId, actorId)` — the organization-scoped actor |
| `hat` | the selected, worn hat: role title, its actions, and the team/site ids it reaches |
| `memberTeamIds` | site-local views without a grant query: the teams the actor's wearable grants reach |
| `sites` | admitted sites: permanent id first, aliases as routing decoration |
| `readableOrganizationIds` | read reach, **computed by the issuer** under the active policy bundle |
| `readableTeamIds` | exceptional team grants only — a reached team whose organization is not in `readableOrganizationIds`; never an expanded list of every readable team |
| `configurableSiteIds` | where the holder may configure |
| `iat`, `exp` | epoch seconds; `exp` bounds the revocation window |
| `amr`, `auth_time` | the authentication event: opaque method references (RFC 8176) and its epoch seconds, copied from principal evidence at issuance and preserved through refresh; absent when the evidence carried none |

Read reach is an issuer computation, not a verifier reconstruction: the
verifier compares ids and evaluates the selected hat locally; it never
rebuilds organization unions, peer reach, fallback, or worn-hat rules.

The `hat` is the action layer. `readableOrganizationIds`/`readableTeamIds`,
`configurableSiteIds`, and `memberTeamIds` are separate issuer-computed
layers over the actor's wearable grants; the verifier compares each layer's
ids and never derives one from another. The `memberTeamIds` claim keeps its
historical name; neutral access exposes the same set as `teamReach()`.

`context()` is an authority call, not a verification: it re-reads current
organization state, so a disabled actor's context lists no wearable hats
while the signed envelope still verifies to its expiry. Verification reads the
signed claims; context asks the authority what is true now.

`amr` and `auth_time` are the OIDC claim names (`amr` from RFC 8176,
`auth_time` from OpenID Connect Core), carried verbatim the way `iat` and
`exp` are. They describe the authentication event the evidence recorded,
not the envelope: refresh re-issues both unchanged while `iat` moves, so a
policy reading "a hardware key, used within the last fifteen minutes" is
host code over these two claims — the values are host/IdP vocabulary that
org-hats copies and never interprets, and absence means the issuing
evidence carried none, which such a policy treats as failing closed.

## Encoding and signature

Signed bytes are the UTF-8 encoding of `canonicalJson(claims)`:

- object keys sorted (UTF-16 code-unit order), no whitespace;
- arrays keep their order; numbers and strings render as JSON renders them;
- `canonicalJson` in `src/contract.ts` is the single implementation — both
  issuer and verifier call it, and a host never reimplements it.

Signature: **Ed25519** (WebCrypto `Ed25519`), encoded unpadded base64url
(RFC 4648 §5), over the signed bytes; `keyId` names the key. One algorithm
in v1; another is a format-version change, not a bundle option.

## Version and key compatibility

- The gate on reading is the **envelope version pair**: the `format` marker,
  the envelope's `v`, and the claims' own `v`. The claims'
  `interfaceVersion` records which authority interface issued them and is
  deliberately not compared with the verifier's. An envelope outlives the
  call signatures that produced it, so a command-vocabulary break must not
  strand live sessions; a change to what the claims *mean* moves
  `ACCESS_ENVELOPE_VERSION` instead. `OH-ACCESS-04` pins this distinction.
- Verifier-first rollout: deploy a verifier accepting old and new versions,
  then the issuer, and retire the old version only after its maximum
  envelope lifetime has elapsed.
- Key rotation follows the same order: distribute the new verification key
  everywhere, then activate it at the issuer, and retain the old key until
  its last possible envelope has expired.
- Verification keys travel as a canonical `VerifyKeySet` from
  `org-hats/access`: JSON with `format`, `v`, and `keys` (each key id,
  algorithm, and raw public key). Parsing fails closed on an empty set,
  duplicate ids, a non-Ed25519 algorithm, or malformed key material. Unknown
  fields are ignored: a key set is operator-distributed configuration, so an
  additive field must not brick live verifiers — `format` and `v` carry
  compatibility. The set, not a single key, is the rotation unit.
- An unsupported envelope version, wrong operation/site binding, expiry,
  and a failed signature are closed failure kinds
  (`wrong-interface-version`, `wrong-binding`, `expired`,
  `invalid-signature`); the deploying host owns the product response to
  each.
- Additive optional claims (v1 gained `amr` and `auth_time` this way) need
  no format-version bump: canonical serialization covers whatever claims
  exist, so an older verifier accepts a newer issuer's envelope and
  ignores what it does not read.

## Fixed vectors

Committed as data at `tests/fixtures/envelope-vectors.json` (a clearly
labeled test-only keypair, so signatures are byte-exact across
implementations) and exercised by `tests/access.test.ts`: canonical
serialization; expiry; wrong envelope and claims version; interface-version
provenance; wrong operation binding; wrong site binding; forged signature;
tampered claims; unknown key id; key rotation and retirement.
