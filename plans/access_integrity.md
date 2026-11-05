# Access integrity — close the review findings

## Goal and scope

Reconcile E4's failure order with its existing witnesses and close the key-set
compatibility witness gap. These are bounded follow-ups to the access and
envelope review, not a redesign of policy or the authority seam.

E4 is a disagreement between text and deliberately tested behavior; resolve
that disagreement explicitly.

## Next work

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
