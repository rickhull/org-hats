# Type safety — guarantees and current gaps

TypeScript checks the shape of trusted program values; it does not validate
JSON, prove a signature's issuer supplied complete claims, or isolate an
object from mutable aliases. [The type layer](types.md) describes the
intended boundaries. This document records the present findings against
those boundaries; the [type-safety plan](../plans/type_safety.md) carries
the work to close them.

## What the compiler protects

The five domain identifiers are branded internally, while the authority and
access surfaces accept plain strings. This keeps accidental mixing visible
inside the model without imposing constructors on hosts. The consumer fence
and compile-time assertions check that boundary ([P7](../specs/portability.md#p7--brands-stay-behind-the-public-surface)).
`GrantTarget`, command and result unions express alternatives with
discriminants; `ActiveGrant` records the revocation filter before ranking.
Strict compiler settings, the portable compiler fence, and typechecked tests
and examples ([P8](../specs/portability.md#p8--the-suites-and-examples-typecheck))
make these claims useful, but cannot establish runtime shape or ownership.

## Bootstrap boundary checks

The Cloudflare operation's `parsePolicyBundle` in
[operation.ts](../packages/cloudflare/src/http/operation.ts) establishes
the policy's runtime shape before the coordinator applies
[validatePolicyBundle](../src/policy.ts). Both bootstrap and bootstrap preview
use it. The [policy regressions](../packages/cloudflare/test/bootstrap-policy.test.ts)
reject numeric identifiers, versions, role titles, and actions without changing
exported state. Unknown read-policy axes remain visible to semantic validation.

Bootstrap also parses the actor's `disabled`, operation's `bounded`, and
grant's `primary` and `revoked` with
[`asBoolean`](../packages/cloudflare/src/http/parse.ts). Present non-booleans
are refused; omitted, `false`, and `true` retain their existing stored meaning.
The [flag regressions](../packages/cloudflare/test/bootstrap-flags.test.ts)
exercise refusal before persistence and valid stored values.

## Boundary gaps

- Other coordinator HTTP flags still use literal-true tests: intake actor
  `disabled`, grant-command `primary`, organization `operator`, and team
  retirement's `asOperationAdmin`. Their malformed values become false or
  absent; bootstrap's parsing fix does not cover those routes.
- ~~[parseAccessEnvelope](../src/contract.ts) checks containers, versions,
  depth, carriage fields, and expiry but asserts the complete claims type
  without checking all fields.~~ **Closed:** the gate now checks the complete
  required v1 claims shape after the expiry stage and before any caller can
  read a claim — a correctly signed `{v: 1, exp: 200}` is `unauthenticated`
  at the gate, never a `Verified` value whose accessors throw. E3's optional
  and unknown additive claims and E8's issuer-version provenance are
  unaffected; the spec's E4 table carries the new stage. Proven red first:
  the verified malformed result, the `invalid-signature` combined fault, and
  the `verify` throw on the missing `sites` array all reproduced before the
  fix.
- The in-memory engine keeps fixture policy references and shallow-copies
  nested fixture data at ingress ([engine.ts](../src/authority/engine.ts)).
  Its [snapshot](../src/authority/state.ts) copies arrays but shares grant,
  participation and site objects. A caller retaining mutable fixture data can
  change later policy or grant reach; a caller can also assign a returned
  readonly grant to a mutable structural type and change `revoked` without a
  cast. That changes engine state despite the snapshot isolation promise.
  This finding concerns the in-memory engine handle, not verified claims or
  an established Cloudflare runtime defect. The existing snapshot test
  checks array mutation, not nested objects.

One smaller maintenance exposure is the in-memory `OutboxMessage`: its
optional fields allow an actor-disabled message with no actor identifiers,
which delivery can consume without revoking the intended refresh records.
Current producers supply the fields; this is a representable future mistake,
not a known malformed message in the current flow.

The analysis is bounded to these seams. The policy and bootstrap-flag
regressions are proven red against the former behavior and green with the
parsers in place. Claims and ownership findings come from ad hoc probes;
they still require committed regressions and fixes.
