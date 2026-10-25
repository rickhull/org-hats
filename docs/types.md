# The type layer — compile-time claims at runtime boundaries

*How org-hats uses TypeScript: what the compiler proves, what it does not,
and where validation takes over. The forward work is in
[`plans/type_leverage.md`](../plans/type_leverage.md).*

TypeScript is a structural, erased checker. It can prove shape,
exhaustiveness, and assignability at compile time. It cannot prove that a
JSON payload, a SQLite row, an identity-provider response, or a clock value
is what its type says. The discipline here is therefore two-part: make the
domain shape hard to misuse, and parse or verify every untrusted value at
the boundary.

## What the compiler is doing

- **Structural typing** means an object is accepted by its shape. A
  branded id is the exception: it is nominal only because a unique-symbol
  property makes the two shapes differ.
- **Discriminated unions** are the main tool. A literal `kind`, `ok`, `v`,
  or status field lets control flow narrow the whole object.
- **Literal, readonly, and optional types** preserve intent: `"team"` is
  not `string`; a `readonly` array cannot be mutated through its type;
  `exactOptionalPropertyTypes` distinguishes absent from `undefined`.
- **Conditional and mapped types** express the boundaries themselves:
  `Unbranded<T>` strips brands, and the compile-time `AssertPlainId` checks
  assert what a consumer is allowed to pass.
- **Assertions are not validation.** `as`, `any`, and a parsed JSON value
  can make the checker believe something false. The type system is a
  discipline, not a runtime guarantee.

## Brands and the public surface

The five domain ids are branded internally:

```ts
export type OrganizationId = Branded<"OrganizationId">;
export type ActorId = Branded<"ActorId">;
```

The brand is a compile-time phantom; at runtime an id is still a string.
The public seam deliberately does not expose it. Commands, claims, and
neutral access use `Unbranded<...>` for ids, so a host can pass an id it read
from its own records without importing a constructor. Evidence carries a
provider and subject, not a domain id.

```ts
target: { kind: "team", teamId } // plain string at the host boundary
```

The conversion happens once, at the runtime seam. `AssertPlainId` in
`src/contract.ts` checks that from the inside, and
`tests/consumer-surface.ts` compiles against `dist/` to check it from the
outside. Branding is an internal convenience, not a public type ceremony.

Fixture data enters the same way. `Unbranded<Snapshot>` describes
hand-written fixture shape; `fixtureSnapshot` converts once at the test
boundary, and `invariantProblems` checks coherence. The cast does not make
the data valid; the validator does.

## Unions that make invalid states unrepresentable

The strongest uses replace runtime checks with shape:

- **`GrantTarget`** is exactly one team or one site. The old two-optional
  command shape could express neither and both; the union cannot. Both
  runtimes lost their duplicate "exactly one target" checks.
- **`TargetRef`** is one shared operation/site/team union, re-exported by
  the model and the access module instead of written twice.
- **`RoleActions`** is `{found:true,actions} | {found:false}`. An unknown
  role cannot be silently coalesced with `?? []` into a wearable-but-
  powerless hat; the caller must decide whether it is a policy
  inconsistency.
- **`FailureKind`** is a closed union. A new kind is an interface-version
  change, and a host can map it exhaustively.
- **`AuthorityCommand`** is a discriminated union of complete business acts,
  each carrying only the fields that act needs.
- **`ParticipationEvent`**, **`ParticipationTransition`**,
  **`RefreshHandleOutcome`**, and **`Decision`** make the state machine's
  outcomes explicit rather than encoding them in optional fields or strings.

The rule of thumb: if a state has a name, give it a discriminant; if two
fields must move together, put them in one variant.

## Exactness, readonly, and the limits of both

`strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` are
on for the portable package and the typechecked tests. They catch real
mistakes: an index that may be absent, an object that sets `slug:
undefined` where the type requires omission, a fixture that writes a plain
string where a branded id is expected.

`readonly` prevents mutation through a typed reference, but it does not
deep-freeze a value or prevent an internal alias. `snapshotOf` returning
live internal arrays is a runtime isolation problem; a `DeepReadonly`
annotation would only hide it. Copy at the boundary; do not treat
`readonly` as immutability.

## Versions in the type system

Version literals are part of the contract:

```ts
export const AUTHORITY_INTERFACE_VERSION = 2 as const;
export const ACCESS_ENVELOPE_VERSION = 1 as const;
```

The call surface carries the current interface version and refuses a
caller that speaks another. The verifier gates on the envelope's own
version pair — `format`, the envelope's `v`, and the claims' `v` — before
reading claims. The claims' `interfaceVersion` is issuer provenance, not a
readability gate; see [`specs/envelope.md`](../specs/envelope.md) E8.

A parsed envelope may therefore carry a historical interface value even
though the current call surface speaks `2`. The field is data, not the
static call type.

## Compiler fences and checked tests

The compiler is used as a boundary enforcer, not only as a build step:

- `tsconfig.authority.json` compiles `src/` with `types: []`; `bin/check`
  also rejects any Cloudflare import under `src/`.
- `tsconfig.json` builds the published declarations; `tsconfig.consumer.json`
  compiles the consumer surface against `dist/`.
- `tsconfig.tests.json` typechecks `src`, `tests`, and `examples` in
  `bin/check`, so a fixture can no longer drift from a public type and fail
  only at runtime.
- `packages/cloudflare/tsconfig.json` typechecks the reference runtime with
  the Worker types and includes its `test/` directory.

## Runtime boundaries

The type layer stops at these seams; each has a named parser or verifier:

| Boundary | Shape before conversion | What checks it |
| --- | --- | --- |
| Host command ids | plain strings | command validation and the runtime's boundary constructors |
| SQLite row | `Row` (`string \| number \| null`) | `row.ts` decoders, database constraints |
| Signed envelope | `SignedAccessEnvelope` | format/version gate, signature, expiry, expected binding |
| Verification key set | text | `parseVerifyKeySet` |
| Policy bundle | `PolicyBundle` | `validatePolicyBundle` at the Cloudflare bootstrap and in tests |
| HTTP command body | `unknown` / JSON | `readBody`, `asString`, `asGrantTarget` |
| Fixture snapshot | `Unbranded<Snapshot>` | `fixtureSnapshot` converts; `invariantProblems` checks in the tests |
| Principal evidence | `PrincipalEvidence` | the identity adapter verifies the provider assertion |

`canonicalJson` is a boundary too: its `JsonValue` type is the serializer's
contract, not a proof that an object is JSON-safe. The existing
`asJson`/`as unknown as JsonValue` assertions are centralized at that
boundary and should stay there.

## Known limits

These are current facts, not future promises:

- `AccessEnvelopeClaimsV1.interfaceVersion` is typed as the current
  interface literal, while the verifier accepts historical provenance; see
  `plans/type_leverage.md` item 1.
- `wearableGrants` filters revoked grants at runtime but returns
  `readonly Grant[]`; callers cannot see the filter in the type. An
  `ActiveGrant` refinement is planned.
- Session results (`{failure}`) and command results (`{ok:false,failure}`)
  use different discriminants. The asymmetry is workable, but result guards
  are not centralized.
- The Cloudflare package does not yet enable
  `noUncheckedIndexedAccess` or `exactOptionalPropertyTypes`, although it
  reads SQLite rows and optional columns.
- `packages/cloudflare` defines a local `Failure` shape alongside the shared
  `FailureKind`; the local copy can drift.
- The root package does not re-export the id aliases, and `NeutralAccess`
  lacks some accessors hosts need for the projection; those are tracked in
  `plans/code_review.md` R3.

## Rules of thumb

1. **Parse at the boundary, then brand.** A plain string becomes an id
   through one named conversion; a JSON value becomes a domain value through
   a validator, never through `as` alone.
2. **Prefer a small union to a boolean pair.** `GrantTarget` and
   `RoleActions` are better than two optionals plus a runtime check.
3. **Keep public ids plain.** Brand internally; prove the public surface
   with `AssertPlainId` and the consumer fence.
4. **Do not over-brand.** `GrantId`, `KeyId`, `RefreshHandle`, and
   `IdempotencyKey` are candidates only when a concrete mix-up appears.
   `EpochSeconds` is the strongest remaining numeric brand because
   seconds-versus-milliseconds is a real failure mode.
5. **Use `satisfies` and `never` for exhaustiveness.** A
   `Record<FailureKind, ...>` and an `assertNever` default make a closed
   union stay closed.
6. **Typecheck the tests.** A fixture that cannot build the interface is a
   latent runtime test failure; `bin/check` now prevents it.
