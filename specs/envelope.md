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

Structure, then format and the envelope version pair — nothing unrecognized
is interpreted — then the signature against a known key id, then expiry, then
the caller's expected bindings.

Closed means *as a value*. The envelope is untrusted input whose declared type
is erased at runtime, so the gate refuses a non-object envelope, an absent
claims payload, and a missing key id or signature before reading a field, and
a verify predicate that throws is `invalid-signature`. Every caller of the
gate — the verifier, the context, and command authorization — inherits this,
and none of them may read a claim before it has run.

The gate returns the parsed envelope rather than a verdict about one, so that
obligation is discharged by the only expression that yields a claim: a caller
reads `keyId`, `signature`, and `claims` from the gate's result and never from
the input beside it. That is a property of an implementation, not of the
format — a reimplementation inherits the ordering rule above, not this shape —
but it is what makes the ordering hard to get wrong rather than merely
documented.

Structure includes depth. Canonical bytes are an input to the signature
check, so a verifier canonicalizes claims it has not yet verified; the gate
therefore refuses claims past E2's depth bound before any caller reaches
`canonicalJson`, whose recursion would otherwise overflow on input that
needs only a public key id and no valid signature.

Unreadable and unsupported are different answers. Something that is not
recognizable as an envelope — or too deep to read — declares no version, so
it is `unauthenticated`:
the caller presented no usable authority, and a fresh login is the remedy.
Only a recognizable envelope can disagree with us about a version, and that
stays `wrong-interface-version` — a deployment mismatch no login would fix.
Collapsing the two would tell a person with a damaged cookie to wait for an
outage that is not happening.

*Held by:* the single `verify` order; the shared `envelopeVersionFailure`
gate; `OH-ACCESS-01` through `OH-ACCESS-04` and the vectors.
*If it breaks:* an unrecognized envelope gets interpreted before it is
trusted, a valid envelope dies for a reason it cannot name, or a malformed one
leaves by an exception the closed taxonomy cannot describe.

### E5 — The key set is the rotation unit

Verification keys travel as one canonical `VerifyKeySet`; rotation is two
live keys — install the next set everywhere before the issuer switches,
retire the old key after its last envelope expires. An empty set, a
duplicate id, or a wrong algorithm fails closed at parse; unknown fields are
ignored, so an additive field cannot brick live verifiers.

*Held by:* `parseVerifyKeySet`'s closed failures; the rotation and
retirement vector; `/ops/verification-keys` returns exactly the set.
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

```js spec=E7 traits=portable,unit
// The clock is injected: the same envelope one second before exp, then at it.
const s = await spec.world();
const envelope = (await s.issue("len")).envelope;
const stillLive = await s.verifyAt(envelope, envelope.claims.exp - 1);
spec.expect(stillLive.access !== undefined, "one second before exp the envelope verifies");
spec.expectFailure(await s.verifyAt(envelope, envelope.claims.exp), "expired", "at exp it is dead");
```

*Held by:* issuance and verification on both engines; `OH-ACCESS-02`; the
engine default is 900 seconds, configurable; the E7 executable example.
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
