# Type safety at runtime boundaries

Close the gaps described in [the type-safety analysis](../docs/type_safety.md)
in the order below. [P9](../specs/portability.md#p9--untrusted-data-is-parsed-before-it-wears-a-domain-type)
and [E4](../specs/envelope.md#e4--verification-fails-closed-in-a-fixed-order)
remain obligations; the current violations do not lower them. Each slice
leaves the applicable tests green before the next begins.

## 1. Validate the complete access claims shape

Validate all required claims from `unknown` before exposing a verified result
or reading fields that depend on that shape. Preserve E4's format, version,
signature, expiry, and binding refusal order; preserve E3's acceptance of
unknown additive optional claims and E8's issuer-version provenance. Extend
the spec's ordered checks as needed to locate the new refusal without changing
the existing precedence.

**Done when:** a correctly signed envelope with incomplete or malformed
required claims is refused as a value and no consumer can read it as verified
claims. The existing failure taxonomy stays closed.
**Evidence:** real-signature regressions for claims `{v: 1, exp: 200}` with
verification time `100` first reproduce the malformed verified result and
accessor exception, plus the exception during expected-site checking, then pass;
combined-fault ordering, additive unknown fields, and historical issuer
versions retain their tests.

## 2. Own the in-memory world and snapshots

Copy nested policy and fixture data on ingress and copy nested snapshot objects
and arrays on egress. A readonly type alone cannot prevent mutation through a
retained alias.

**Done when:** mutations through retained input or returned snapshot aliases
cannot change a subsequent snapshot or issuance.
**Evidence:** regressions for both ingress and egress first demonstrate the
current mutation, then pass with the ownership boundary in place.

## 3. Make outbox message variants complete

Replace the internal `OutboxMessage` optional-field shape with a discriminated
union carrying the fields required by each kind, and update its producers and
consumers. Existing producers already provide their required fields. Do not
move the public interface version for this internal-only change.

**Done when:** an incomplete variant cannot be constructed in checked code
and existing delivery behavior remains unchanged.
**Evidence:** a compile-time negative assertion first fails against the
current optional-field shape, then rejects missing required fields;
the relevant delivery tests pass. If adding a test for an existing runtime
guard, remove the guard, prove the test fails, and restore it before handoff.

## 4. Parse the remaining HTTP flags

Apply the shared boolean parser to non-bootstrap fields: intake actor
`disabled`, grant-command `primary`, organization `operator` on activation
issuance, activation revocation, and principal unlinking, and retirement's
`asOperationAdmin`.
Preserve omitted and actual boolean values and the existing standing checks.

**Done when:** present non-booleans are refused before each route mutates
state, while valid requests retain their authorization and effects.
**Evidence:** HTTP regressions first reproduce each route's acceptance of a
malformed flag, then pass after parsing; accepted true, false, and omitted
values retain their existing tests.

## Completion

Keep public IDs plain, retain the actor's single name, and keep the nine
failure kinds closed. This plan chooses no new dependency or brand. Restore's
intentional treatment of missing tables as empty is outside this work; changing
it needs a separate compatibility decision.

Each defect regression is proven red against the current defect before the
fix and green afterward. For `src/` changes, run `pnpm build` and include the
tracked `dist/` output. Run `pnpm check`; for runtime changes run `pnpm verify`
sequentially in the checkout, never alongside `pnpm check`. Update the current
findings in `docs/type_safety.md` and the P9/E4 violation notices as the
relevant fixes land. Retire this plan when all slices and their evidence land.
