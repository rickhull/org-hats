# Local credentials (passkeys) — phased implementation

Build the WebAuthn runtime surface specified in
`docs/authority_redesign.md` § Local credentials (passkeys) — design
decisions. Nothing here moves the portable seam; all work lives in
`packages/cloudflare`. The consumer's pilot is gated on this feature
(relay thread "Asking early", closed by "the design decisions are
recorded").

## Decisions already made (do not relitigate per slice)

- Zero runtime dependencies. Hand-rolled CBOR subset + platform WebCrypto
  (option A of the dependency review). Everything cryptographic stays in
  `crypto.subtle`; the parser never computes a signature or derives a key.
- The door to `@simplewebauthn/server` stays open and is recorded here:
  if pilot interop failures cannot be reproduced and fixed cheaply,
  taking the library is an additive, compatible change (same routes, same
  storage). Deciding A now does not decide A forever.
- Strict claim guard: enrollment binds through the activation claim once;
  a second credential per actor is an operator act. No guard changes in
  this work.
- Zone-apex RP id, preconditioned on zone purity. Attestation handled,
  never required. Unlink stays actor-wide (identity reset).

## Phase 1 — the decoding layer (internal, no routes) — DONE

Landed: `packages/cloudflare/src/webauthn/cbor.ts` (refuse-don't-skip CBOR
subset, depth- and item-bounded) and `authenticator.ts` (authenticator
data, none/packed self-attestation, EC2-ES256 and RSA-RS256 COSE mapping,
extension blocks and attestation trust paths refused). Vectors in
`packages/cloudflare/test/webauthn-decode.test.ts` are built by an
independent in-test encoder written from RFC 8949, plus an ES256
round-trip: a packed self-attestation signed by a real keypair and
verified through the parsed COSE key via crypto.subtle — the proof that
all cryptography stays in WebCrypto.

A minimal CBOR decoder plus authenticator-data and COSE-key parsing in
`packages/cloudflare/src/webauthn/`, built as an untrusted-input boundary
with the envelope gate's discipline:

- size- and depth-bounded; unknown or unused CBOR constructs (indefinite
  lengths, tags, non-integer majors where integers are required) are
  refused, never skipped;
- COSE keys map to `crypto.subtle` verification inputs for ES256 (and
  RS256 if a vector demands it); Ed25519 reuses the existing key material
  path where applicable;
- no attestation-trust machinery: `none` and `packed` formats parse;
  trust paths are not evaluated (spec decision #5).

**Done when:** committed test vectors from real registration and
assertion ceremonies (headless authenticator during development) decode
byte-exactly, adversarial-malformed vectors are refused as values, and
the decoder is covered by negative tests for every CBOR construct it
declines to implement.
**Evidence:** `packages/cloudflare/test/webauthn-decode.test.ts`, red
where behavior must exist, green with the vectors.

## Phase 2 — org-side credential storage — DONE

Landed: schema v4 `credentials` table (organization chain), carried by
export/restore (a pre-credentials snapshot restores with none, and every
shipped schema stays restorable), internal DO routes for store/read/
counter, `unlink-principal` removing credentials with the links (the
identity reset), and the wipe drill proving operation delete +
forget-operation leave credentials intact. The schema-parity guard's
expected counts moved with the table.

A `credentials` table in the organization coordinator (credential id,
COSE public key, sign count, backup-eligibility flags read opaquely,
created/updated), keyed by credential id and joined to the actor through
the ordinary `principal_links` row `(webauthn, credential id)`:

- additive schema migration on the organization chain; export/restore
  carry the table;
- credentials are organization-owned facts: they survive an operation
  delete and `forget-operation` untouched (the wipe contract is
  operation-scoped);
- `unlink-principal` removes the actor's credential rows with the links —
  the documented identity reset.

**Done when:** a stored credential round-trips through export/restore, a
wipe/forget drill leaves it intact, and unlink removes it.
**Evidence:** schema and restore-matrix coverage in the Cloudflare suite.

## Phase 3 — registration through the claim

`POST /webauthn/registration` (host-facing, beside the OIDC exchange):
the host supplies the activation secret and the browser's registration
response; the runtime supplies the ceremony challenge, verifies the
attestation, stores the key, and runs the activation accept with
`(provider: "webauthn", subject: credential id)` evidence:

- the claim is the only self-serve door; the strict guard applies
  unchanged, so enrollment refuses for an actor who already holds any
  link;
- ceremony options (challenge, user, RP id = zone apex) are minted
  server-side and single-use, with the same rotation semantics as
  activation requests.

**Done when:** a fresh actor enrolls a passkey through the claim and can
be seen as an ordinary principal link; an already-linked actor is
refused; a replayed ceremony challenge is refused.
**Evidence:** Cloudflare suite registration tests, red-first.

## Phase 4 — assertion login

`POST /webauthn/assertion`: verify the assertion against the stored key
(origin and RP id checked against the zone apex, sign counter enforced
with a tolerance decision recorded when the first real counter behavior
is observed), then resolve the principal link and issue through the
existing session path — the same issuance an OIDC login reaches:

- a disabled actor is refused at issuance exactly as a federated login;
  a revoked participation behaves as today;
- the uniform refusal discipline carries over: enumeration-resistant
  failures for unknown credentials.

**Done when:** enrollment → logout → assertion login → issued envelope
works end to end, a wrong-origin assertion is refused, and counter
regression is refused or logged per the recorded tolerance.
**Evidence:** Cloudflare suite assertion tests plus one end-to-end test
driving both routes.

## Phase 5 — docs, relay, tag

`docs/cloudflare.md` route documentation (including the zone-purity
precondition and the no-attestation stance), the relay note to
Quartermaster ahead of the tag, then the release.

**Done when:** the docs are fenced-green, QM has the note, and the tag
is published.
**Evidence:** docs link fence, the relay outbox entry, the tag.

## Sequencing and gates

Each phase lands green and is independently committable; phases 1–2 are
internal and carry no public surface, so they can ship on any cloudflare
tag or wait for phase 5's. Phase 3 is the first public surface and is the
moment to re-show Rick the route shape before it merges. The pilot-interop
gate after phase 5 decides whether the SimpleWebAuthn door is walked
through: any interop failure we cannot reproduce and fix within one work
session triggers the recorded option-B revisit, which lands as its own
plan.
