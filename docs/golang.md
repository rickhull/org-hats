# Go

*Our posture on a Go language surface: interesting, not needed yet.*

## A word on “bindings”

In this discussion *binding* means a language-level surface. It is not the
model's **Binding**, which is the operation and optional site an access
envelope is bound to ([lexicon.md](lexicon.md) § Access). The surfaces
below are named for what they do, not for the overloaded word.

## Current

No Go consumer of `org-hats` exists. We publish no Go module, and none is
planned for the current line. TypeScript remains the reference for the
contract, the authority and access modules, the Cloudflare runtime, the
conformance inventory, and the examples.

Quartermaster's Go work is its own operator engine — `qm` ledger, `plan`,
`doctor`, and Cloudflare API reads. It consumes JSON/CLI, not the authority
contract, and does not evaluate authority decisions. The `qm ops authority`
control plane stays TypeScript because it validates policy and uses the
pinned `org-hats` types. A Go surface for Quartermaster would be an unused
second language.

The idea is interesting because the seam is a wire contract: an access
envelope is signed bytes and a neutral result, not a TypeScript object graph.
A Go verifier could exist without porting the authority runtime. It is not
needed yet, so we do not carry one.

## What is realistic

| Surface | Realistic? | Why |
| --- | --- | --- |
| Type | Yes, useful | Go structs for the wire JSON: `AuthorityContext`, `HatSummary`, `GrantTarget`, `Failure`, `VerifyKeySet`, envelope claims, and commands. |
| Verifier / predicate | Yes, with care | Envelope verification and the `NeutralAccess` predicates (`mayAct`, `mayConfigure`, readable team ids). Canonical encoding is the hard part. |
| Client | Not really | The runtime is a Cloudflare service binding, not a public HTTP API; a Go host would have to expose its own surface. |
| Runtime | No | The runtime is TypeScript on Cloudflare. Go does not run it. |

Type correspondence is achievable and mostly mechanical. Verifier
correspondence needs byte-level canonicalization vectors. Client and runtime
correspondence are different products.

## Type correspondence

| TypeScript | Go | The catch |
| --- | --- | --- |
| `type OperationId = string & { __brand }` | `type OperationId string` plus parse/validate | Brands are compile-time only; the wire is a plain string. |
| readonly properties and arrays | Exported fields or accessors over unexported state; copies on return | Go has no readonly; convention or encapsulation. |
| `A \| B` discriminated union | Interface with a marker method, or a struct with `Kind` plus `json.RawMessage` | Needs a custom `UnmarshalJSON`; an unknown kind must fail closed. |
| `field?: T` | `*T`, with careful `omitempty` | Go conflates absent and zero; `omitempty` on structs does not do what you think. |
| `Record<K, V>` | `map[K]V` | Canonical key order and number formatting matter for signatures. |
| `Date` / epoch seconds | `int64` epoch seconds | Match the wire exactly; do not use `time.Time` casually. |
| `Promise<T>` | `(T, error)` / `context.Context` | Relevant only to a Go host or runtime, not the wire. |
| Failure union | Struct with `Kind` plus variant fields | A closed taxonomy needs vectors, not just structs. |
| `VerifyKeySet` | Struct plus `crypto/ed25519` | Straightforward. |
| `NeutralAccess` | Go interface or methods | Only if a Go host needs the predicates. |
| Conformance world | JSON fixtures and vectors | The shared guard; do not duplicate cases by hand. |

## Canonical encoding is the gate

The signed bytes must match the TypeScript implementation byte for byte.
`canonicalJson` sorts object keys (UTF-16 code-unit order), emits no
whitespace, preserves array order, and renders numbers and strings as JSON
does. Go's `encoding/json` is not a canonicalization spec: its default
string ordering is byte order, and sorting map keys is not enough because
number rendering and escaping can still differ. A Go verifier must
reproduce the exact bytes; byte-level vectors are the gate. If it only
matches the struct shape, it is a false friend. The current rule is the
repository's own `canonicalJson`, not JCS/RFC 8785; moving to a standard or
a shared neutral schema is a larger upstream change.

## Realistic shape

```text
org-hats/go/wire     wire structs, unions, validation, canonical encoding
org-hats/go/verify   envelope verification and the neutral-access predicates
org-hats/go/vectors  JSON conformance vectors shared with the TypeScript suite
```

Not a port of the authority engine, the model's snapshot types, the policy
engine, or the Cloudflare runtime. A Go host that implements authority is a
much larger project; a Go verifier or client is a projection.

## Schema source

The TypeScript `.d.ts` is not a neutral schema. Generating Go from it can
work for the simple structs, but conditional types, brands, and unions tend
to degrade. Hand-written wire types plus shared JSON vectors are more
reliable. A neutral JSON Schema or IDL shared by both sides is the clean
long-term answer, but it is a larger upstream change, not this one.

## Release shape

A published Go module fits the artifact model: it is another release
artifact, with Go consumers as subscribers. The tag is the release identity,
the module proxy or forge is the publication point, and the release record
names the module version. It tracks the portable `vX.Y.Z` line, separate from
`cloudflare-v*`, and carries its own `go.mod`/`go.sum`, `go test`/`go vet`,
and CI. Verify the module path and tag rules (`/v2`, submodule tag prefix)
with `go list -m`; do not invent a second version line.

## Recommendation

1. Do not publish Go bindings just to have them. Publish the wire contract
   and conformance vectors first if any cross-language consumer appears.
2. If a concrete Go host, client, or verifier appears, publish a thin
   `wire`/`verify`/`vectors` module — generated where the schema allows,
   hand-written for unions and optionals, tested against the same bytes.
3. Release it under the portable `vX.Y.Z` line with its own module tooling
   and CI; verify the module path and tag rules with `go list -m`.
4. Never port the runtime, the model's snapshot types, or the policy engine.
   They are not wire, and duplicating them creates two sources of truth.
5. Keep Quartermaster's engine language-neutral: no `org-hats` Go dependency
   unless it actually needs to verify an envelope or evaluate a predicate —
   which, per the ops-surface spec, it does not.

## Trigger

A committed Go consumer with a real use. Until then: interesting, not
needed. No shared tooling and no second source of truth.
