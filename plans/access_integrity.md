# Access integrity — close the review findings

## Goal and scope

Make the access verifier expose the claims whose bytes it verified, enforce
the expiry shape, and reconcile E4's failure order with its existing witnesses.
These are bounded follow-ups to the access and envelope review, not a redesign
of policy or the authority seam.

The mutable-claims and missing-expiry reproductions require shared-object
mutation or malformed claims from a trusted signer. They are robustness gaps,
not demonstrated remote signature bypasses. E4 is a disagreement between text
and deliberately tested behavior; resolve that disagreement explicitly.

## Next work

Each numbered item is a separate, testable slice. Items 1 and 3 can proceed
independently; item 4 follows the parser and verifier changes so its wording
describes the resulting order.

### 1. Keep verified authority tied to signed bytes

**Work:** In `src/access/verify.ts`, take an owned snapshot of the claims
before the asynchronous signature check and build access from that snapshot.
Keep the verified projection protected from mutation through the original
envelope, returned claims, or arrays exposed by accessors. Choose the ownership
mechanism during implementation; a shallow copy does not isolate nested grants.

**Done when:** changing the original claims while verification is pending or
after it returns cannot add actions, expand reach, change bindings, or extend
expiry. Mutating a returned view cannot change subsequent access decisions.

**Closing evidence:** regression tests in `tests/access.test.ts` use a real
Ed25519 signature, control the pending verification deterministically, and
observe decisions through `NeutralAccess`. Prove the unsigned action/team
mutation succeeds against the current code before fixing it; confirm the
same test rejects that authority after the fix and an unchanged envelope
still verifies.

### 3. Validate expiry at the envelope boundary

**Work:** Have the named envelope parser in `src/contract.ts` reject an absent
or invalid `exp` before it yields typed claims. Require a finite whole number
of epoch seconds and return a closed failure value for malformed expiry;
retain `expired` for a structurally valid expiry at or before `now`.

**Done when:** a genuinely signed payload without `exp`, or with a nonnumeric
or fractional expiry, cannot yield verified access. Parser inputs containing
non-finite numbers also fail closed. Valid envelopes still verify one second
before expiry and fail at expiry. Optional claims remain compatible.

**Closing evidence:** access tests first reproduce successful verification of
signed claims without `exp` at epoch `9999999999`, then prove rejection after
the fix. Add focused invalid-shape cases and inspect all parser callers,
including runtime context and command authorization, for failure mapping.

### 4. Reconcile E4's failure precedence with its witnesses

**Work:** Compare [E4](../specs/envelope.md#e4--verification-fails-closed-in-a-fixed-order),
`parseAccessEnvelope`, and the malformed-envelope cases in
`tests/access.test.ts`. E4 says structure precedes format/version, while the
parser and tests classify an absent format marker as `wrong-interface-version`.
Unsupported versions also win over excessive claims depth today.

**Recommendation:** clarify the spec to describe the deliberate existing
classification and the resulting parser order. Do not silently change host
recovery behavior or weaken an invariant merely to match passing tests. If
review instead selects different behavior, re-review the failure mapping with
the consumer before implementing it.

**Done when:** the spec explicitly assigns precedence for absent format,
absent claims, unsupported versions combined with excessive depth, and invalid
expiry, and each assignment agrees with a named witness.

**Closing evidence:** inspect the text and witness cases together. A text-only
clarification needs no application checks; any changed executable witness
or parser behavior follows the behavioral verification below.

## Lower priority — witness key-set forward compatibility

**Work:** Add a public-boundary case in `tests/keyset.test.ts` with unknown
top-level and per-key fields, as promised by
[E5](../specs/envelope.md#e5--the-key-set-is-the-rotation-unit).

**Done when:** loading that key set still verifies the committed signed
vector. This is a coverage improvement; the current parser already complies.

**Closing evidence:** temporarily make the parser reject the added fields,
show the test fails, restore the parser, and confirm the only remaining
change is the intended test.

## Verification and retirement

For each behavioral slice, show its regression red before the fix and green
after it, then run `pnpm check`. Changes under `src/` also require
`pnpm build` and the resulting tracked `dist/` changes. At integration, run
the workspace gate (`pnpm verify`) sequentially; do not overlap a build with
`pnpm check`. The shared parser changes require runtime regression evidence
as well as portable evidence. No new failure kind or envelope version is
planned; any need for one reopens consumer review.

Remove each item when it lands, recording enduring guarantees in `docs/` and
`specs/` with its tests. Remove this file and its index entry when all items
are closed.
