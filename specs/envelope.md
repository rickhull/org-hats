# Envelope — the invariants of the projection

Distilled from `docs/envelope.md` and held by `src/contract.ts`,
`src/access`, and the committed vectors. Ids are stable; see the
[README](README.md) for the protocol.

### E1 — One algorithm per format version

v1 signs with Ed25519 and nothing else. Another algorithm is a
format-version change, never a bundle option or a deployment setting.

*Held by:* the single sign/verify path in both engines; the fixed vectors
commit its bytes.
*If it breaks:* what a verifier accepts becomes configuration-dependent,
and key material stops being comparable across a deployment.

### E2 — One canonical implementation

Signed bytes are the UTF-8 rendering of `canonicalJson(claims)` — keys
sorted, no whitespace — and issuer, verifier, and vectors all call the one
function in `src/contract.ts`. A host never reimplements it.

*Held by:* both engines import the same function; the vectors pin exact
bytes; `OH-ACCESS-03` fails tampered claims.
*If it breaks:* signatures cross implementations only by coincidence, and
every host that reimplemented the encoding owns a private format.

### E3 — Claims grow additively within a version

An optional claim joins the format without a version bump, because
canonical serialization covers whatever claims exist: an older verifier
accepts a newer issuer's envelope and ignores what it does not read.
Removing or reinterpreting a claim is a version change with a
verifier-first rollout.

*Held by:* proven by `1.2.0` — `amr` and `auth_time` landed with the
format still `1` — and stated in `docs/envelope.md`.
*If it breaks:* every additive change drags a paired consumer rollout, and
the cheap window for growth closes.

### E4 — Verification fails closed, in a fixed order

Format and versions first — nothing unrecognized is interpreted — then the
signature against a known key id, then expiry, then the caller's expected
bindings.

*Held by:* the single `verify` order; `OH-ACCESS-01` through `OH-ACCESS-04`
and the vectors.
*If it breaks:* an unrecognized envelope gets interpreted before it is
trusted, or a valid envelope dies for a reason it cannot name.

### E5 — The key set is the rotation unit

Verification keys travel as one canonical `VerifyKeySet`; rotation is two
live keys — install the next set everywhere before the issuer switches,
retire the old key after its last envelope expires. An empty set, a
duplicate id, or a wrong algorithm fails closed at parse.

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

*Held by:* issuance and verification on both engines; `OH-ACCESS-02`; the
engine default is 900 seconds, configurable.
*If it breaks:* revocation latency becomes unbounded, or ordinary reads
regain a control-plane dependency the projection exists to remove.

### E8 — The envelope version and the interface version are independent

The envelope outlives the call signatures that produced it; each carries
its own version, and a mismatch is a named failure, never a
reinterpretation.

*Held by:* two separate constants and claim fields; `wrong-interface-version`
on either.
*If it breaks:* a call-signature change strands still-valid envelopes — or
a format change strands still-valid callers — and rolling upgrades lose
their ordering.
