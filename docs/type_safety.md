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

## Boundary gaps

- The Cloudflare operation bootstrap casts its policy record to
  `PolicyBundle` in [operation.ts](../packages/cloudflare/src/http/operation.ts).
  [validatePolicyBundle](../src/policy.ts) checks policy consistency but
  does not first establish every field's runtime type: a numeric action can
  pass its checks. The cast and validator together therefore do not yet
  establish the parsing contract in [P9](../specs/portability.md#p9--untrusted-data-is-parsed-before-it-wears-a-domain-type).
- The coordinator HTTP boundaries treat values other than literal `true` as
  false or absent for flags. For example, `"true"` for a bootstrap grant's
  `revoked` or a bootstrap actor's `disabled` is omitted.
  A malformed privileged request can thus produce an active grant or enabled
  actor instead of being refused. This is a shape problem at the input
  boundary, not a claim that ordinary unprivileged callers control it.
- [parseAccessEnvelope](../src/contract.ts) checks containers, versions,
  depth, carriage fields, and expiry but asserts the complete claims type
  without checking all fields. A correctly signed claims object
  `{v: 1, exp: 200}` can verify at
  an earlier time and return a `Verified` value whose actor accessor throws.
  Supplying an expected site makes verification itself throw on the missing
  sites array. This requires a trusted issuer to sign malformed claims;
  it is not signature forgery.
  [E4](../specs/envelope.md#e4--verification-fails-closed-in-a-fixed-order)
  describes the verification boundary, and [E2](../specs/envelope.md#e2--one-canonical-implementation)
  the canonical JSON contract. Verified claims are nevertheless copied and
  deeply frozen; immutability does not establish their shape.
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

The analysis was bounded to these seams, not a complete audit. At inspection,
`pnpm check` passed 256 tests and the Cloudflare TypeScript check passed.
Ad hoc probes in `/tmp` demonstrated the examples; they are not committed
regression tests and do not establish a fix.
