# Envelope — the invariants of the projection

Distilled from `docs/envelope.md` and held by `src/contract.ts`,
`src/access`, and the committed vectors. Ids are stable; see the
[README](README.md) for the protocol.

### E1 — One algorithm per format version

v1 signs with Ed25519 and nothing else. Another algorithm is a
format-version change, never a bundle option or a deployment setting.

*Held by:* the single sign/verify path in both engines; the in-memory engine
refuses an injected signer declaring another algorithm at construction,
witnessed by the E1 engine test; the fixed vectors commit its bytes. An
injected callback remains host-owned: checking its algorithm declaration
does not attest to its implementation.
*If it breaks:* what a verifier accepts becomes configuration-dependent,
and key material stops being comparable across a deployment.

### E2 — One canonical implementation

Signed bytes are the UTF-8 rendering of `canonicalJson(claims)` — keys
sorted, no whitespace — and issuer, verifier, and vectors all call the one
function in `src/contract.ts`. A host never reimplements it.

Claims nest no deeper than `ACCESS_CLAIMS_MAX_DEPTH` (8), leaf scalar
included.  The bound belongs to the format because the canonical bytes do:
every synthetic envelope nests to exactly 5, the smallest and the largest
alike, since depth follows the closed claims shape while breadth follows an
actor's reach.  The headroom is what lets an additive optional claim (E3)
appear without moving `ACCESS_ENVELOPE_VERSION`.  Breadth carries no such
bound — the authority issues claims too large for a cookie, and the host
refuses those at issuance against its own budget.

The access verifier takes an owned, deeply frozen copy of the depth-bounded
claims before the asynchronous signature check. Signed bytes and returned access
refer to that same copy, including unknown optional claims. Input mutations
and writes through returned views cannot change verified authority.

*Held by:* both engines import the same function; the vectors pin exact
bytes; `OH-ACCESS-03` fails tampered claims; `tests/envelope-size.test.ts`
pins the issued depth so a deepening shape fails at the issuer, not at a
verifier. The mutation tests in `tests/access.test.ts` witness the snapshot
and immutable views. E4 does the refusing.
*If it breaks:* signatures cross implementations only by coincidence, every
host that reimplemented the encoding owns a private format, or canonicalizing
unverified claims becomes unbounded recursion.

### E3 — Only authority-neutral claims grow additively

An optional claim joins the format without a version bump only when
ignoring it cannot widen effective authority or weaken a required check.
Canonical serialization covers whatever claims exist, so an older verifier
accepts a newer issuer's envelope and ignores what it does not read; that is
safe for descriptive facts such as `amr` and `auth_time`, not for a
restriction the verifier must enforce. A claim whose absence would widen
authority, and any removal or reinterpretation of an existing claim, is a
version change with a verifier-first rollout.

```js spec=E3 traits=portable,unit
// len's envelope, re-signed by a newer issuer of the same format version
// carrying a claim this verifier does not read.
const s = await spec.world();
const older = await s.issue("len");
const newer = await s.withExtraClaim(older, "riskTier", "routine");
const read = await s.verifyAt(newer, older.envelope.claims.iat + 1);
spec.expect(read.access !== undefined, "the unknown optional claim still verifies");
spec.expect(read.claims.operationId === older.envelope.claims.operationId, "the claims it knows read unchanged");
```

*Held by:* proven for the descriptive claims by `1.2.0` — `amr` and
`auth_time` landed with the format still `1`; every claim addition is
reviewed against this boundary, and a semantic change moves
`ACCESS_ENVELOPE_VERSION` (E8); the E3 executable example.
*If it breaks:* every additive change drags a paired consumer rollout and
the cheap window for growth closes — or, worse, an older verifier ignores a
restriction and grants authority the issuer meant to withhold.

### E4 — Verification fails closed, in a fixed order

The shared envelope parser returns the first refusal in the following order.
Basic container checks precede declaration checks; the remaining payload
checks follow the declarations they interpret.

| Stage | Refusal | Failure kind |
| --- | --- | --- |
| Outer container | Not a non-null, non-array object | `unauthenticated` |
| Format marker | Missing or different from `org-hats.access` | `wrong-interface-version` |
| Wrapper version | Missing or unsupported `envelope.v` | `wrong-interface-version` |
| Claims container | Missing, null, an array, or not an object | `unauthenticated` |
| Claims version | Missing or unsupported `claims.v` | `wrong-interface-version` |
| Claims depth | Exceeds E2's depth bound | `unauthenticated` |
| Carriage fields | Missing, empty, or non-string key id or signature | `unauthenticated` |
| Expiry shape | Missing, nonnumeric, non-finite, or fractional `exp` | `unauthenticated` |
| Required claims shape | Any required v1 claim missing or of the wrong type, after the depth bound (optional `amr`/`auth_time` and unknown additive claims excepted) | `unauthenticated` |

Only after parsing succeeds does verification check the signature against a
known key id (`invalid-signature`), elapsed expiry (`expired`), and then the
caller's expected operation and site bindings (`wrong-binding`). A
verification-key predicate that throws is `invalid-signature`.

This order also governs combined faults. An object without a format marker
is a format mismatch, even if it also lacks claims. An unsupported wrapper
version wins over an absent claims payload; an unsupported wrapper or claims
version wins over excessive claims depth. With supported versions, absent
claims, excessive depth, invalid expiry, and incomplete required claims are
`unauthenticated`. No signature check can repair any of these parser
refusals — a correctly signed envelope whose issuer supplied `{v: 1,
exp: 200}` is not forged, but it was never a readable claims object, and the
gate owns that refusal before the signature is consulted.

Declaration checks precede payload scans so an unsupported format or version
is refused without interpreting its payload. The distinction between
`unauthenticated` and `wrong-interface-version` follows the first failed
stage: the former means no usable authority and permits fresh login; the
latter identifies a declaration mismatch for the host to handle. It is not
a blanket rule that every malformed object receives `unauthenticated`.

Closed means *as a value*. The envelope is untrusted input whose declared
type is erased at runtime. The gate returns parsed `keyId`, `signature`, and
`claims`; the verifier, context, and command authorization read that result
rather than fields from the input beside it. No caller may read a claim
before the gate succeeds. This returned shape makes the obligation hard to
bypass; a reimplementation inherits the ordered checks, not the shape of
this implementation.

Canonical bytes are an input to the signature check, so supported claims
must pass the depth bound before any caller reaches `canonicalJson`. Its
recursion would otherwise overflow on input requiring only a public key id
and no valid signature. Unsupported declarations stop before that walk.

*Held by:* `parseAccessEnvelope` and `verify`; the E4 access tests for
structurally malformed envelopes, combined faults, unsupported versions with
excessive depth, claims depth, and missing carriage fields; the E4/E7 signed
expiry tests in the access, engine, and Cloudflare runtime suites;
`OH-ACCESS-01` through `OH-ACCESS-04` and the vectors.
*If it breaks:* an unrecognized envelope gets interpreted before it is
trusted, a valid envelope dies for a reason it cannot name, or a malformed one
leaves by an exception the closed taxonomy cannot describe.

**Known violation:** the ordered parser checks above do not establish every
required claims field. A correctly signed claims object containing only
`v` and a valid `exp` can reach `Verified` whose accessor throws, or make
verification throw when a site-binding check reads the absent sites array.
This violates the closed-value requirement; it requires a malformed payload
signed by a trusted issuer,
not a forged signature. **Closed:** the gate now validates the complete
required v1 claims shape after the expiry stage and before any caller can
read a claim; [Type safety](../docs/type_safety.md) records the red-first
evidence, and this order and E3's additive fields are preserved.

### E5 — The key set is the rotation unit

Verification keys travel as one canonical `VerifyKeySet`; rotation is two
live keys — install the next set everywhere before the issuer switches,
retire the old key after its last envelope expires. An empty set, a
duplicate id, or a wrong algorithm fails closed at parse; unknown fields are
ignored, so an additive field cannot brick live verifiers.

*Held by:* `parseVerifyKeySet`'s closed failures; the E5 key-set test loads
unknown top-level and per-key fields and verifies the committed envelope;
the rotation and retirement vector; `/ops/verification-keys` returns exactly
the set.
*If it breaks:* rotation stalls on distribution, or a verifier verifies
nothing while looking healthy — the deployment failure that looks like a
credential problem.

### E6 — Permanent ids, compact facts

The envelope carries permanent identifiers and only the compact facts a
host needs for local decisions; names are presentation, and a host maps
its own records onto neutral targets without widening them.

*Held by:* the claims shape; `NeutralAccess` exposes targets and
predicates, not product entities.
*If it breaks:* product vocabulary enters the portable module, or a host
acts beyond a target the envelope did not name.

### E7 — Expiry bounds the revocation window

`exp` is checked at verification (`now >= exp` dies), authorization changes
land no later than expiry, and privileged acts that need fresher authority
call the runtime directly. The number itself is the consumer's security
review's to own.

The number is the consumer's; that it is *a number* is not. `exp` is
`issuedAt + envelopeLifetimeSeconds`, so a lifetime that is not a positive
whole number yields an `exp` no clock comparison can be true of, and the
bound disappears with no error — the control fails open rather than closed.
Claims assembly refuses such a lifetime, and the in-memory engine refuses it
at construction, so a deployment that cannot bound expiry issues nothing
instead of issuing forever.

The shared envelope parser also requires `exp` to be a finite whole number.
Missing or invalid expiry is `unauthenticated` before signature verification;
a structurally valid expiry is compared with the clock after the signature
check, so an elapsed integer expiry remains `expired`. This gate covers the
access verifier, context, and envelope-based command authorization in both
runtimes, including malformed claims signed by a trusted issuer.

```js spec=E7 traits=portable,unit
// The clock is injected: the same envelope one second before exp, then at it.
const s = await spec.world();
const envelope = (await s.issue("len")).envelope;
const stillLive = await s.verifyAt(envelope, envelope.claims.exp - 1);
spec.expect(stillLive.access !== undefined, "one second before exp the envelope verifies");
spec.expectFailure(await s.verifyAt(envelope, envelope.claims.exp), "expired", "at exp it is dead");
```

*Held by:* issuance and verification on both engines; the signed malformed
expiry cases in the access, engine, and Cloudflare runtime suites;
`OH-ACCESS-02`; the engine default is 900 seconds, configurable; the E7
executable example.
*If it breaks:* revocation latency becomes unbounded, or ordinary reads
regain a control-plane dependency the projection exists to remove.

### E8 — The envelope version gates reading; the interface version is provenance

The envelope outlives the call signatures that produced it. Its version
pair — the `format` marker, the envelope's `v`, and the claims' own `v` —
is what a verifier gates on. The claims' `interfaceVersion` records which
authority interface issued them and is never compared with the verifier's,
so a command-vocabulary break cannot strand a live envelope. A change to
what the claims mean moves the envelope version instead.

The version pair is also the rollout contract: a verifier deployed ahead of
an issuer accepts both versions live during the transition, and the old
version retires only after its last issued envelope has expired. A new
verifier that accepts only the new version interrupts live sessions even
when the deployment order was otherwise correct.

The failure taxonomy is one closed list shared by the session and command
surfaces (`src/contract.ts`): a `FailureKind` means the same thing wherever
it appears, and adding one is an interface-version change for both
surfaces at once — never a verifier-only or issuer-only addition.

*Held by:* `verify`'s gate on the format and both `v` fields and its
deliberate non-check of `interfaceVersion`; the verifier-first rollout order
in `docs/envelope.md`; `OH-ACCESS-04`; the provenance vector.
*If it breaks:* a call-signature change strands still-valid envelopes — or
a format change strands still-valid callers — and rolling upgrades lose
their ordering.
