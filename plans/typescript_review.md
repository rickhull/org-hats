# TypeScript review — concerns and plaudits

*Review of `src/` and `examples/` at v0.4.1 (October 2026), `bin/check` green. Concerns carry the next free ids (`C67`–`C74`) and are ordered by what I would fix first; the plaudits are recorded so a later change does not silently undo a boundary that currently holds. Verified-not-concerns are listed too, so they are not raised again.*

## Verdict

The TypeScript is unusually disciplined. The architecture's boundaries are **compiler-enforced**, not just documented — the neutrality fence, the discriminated decision union, and the absence of a single `any`/`@ts-ignore`/non-null assertion in `src/` are all real. The concerns below are almost all small. The one functional item worth a decision is `C67`, a deny reason that reports the wrong thing when `organizationId` is in play.

## Plaudits

1. **The fence is enforceable.** `tsconfig.core.json` compiles core/conformance/port/decide/testing with `types: []`, so a stray `node:*` import fails the build. This turns "the core is pure" from a claim into a fact (C50).
2. **No escape hatches in `src/`.** Zero `any`, `@ts-ignore`, or `!` assertions. The only cast is `src/db.ts:23,27` (`as unknown as T[]`), isolated to the one file that speaks to a driver, where it is unavoidable and honestly located.
3. **`Decision` is a discriminated union, and denial is data.** `DecisionAllow`/`DecisionDeny` + `DenyReason` give the audit row one shape for both outcomes, and make an unhandled reason a compile error.
4. **`perRequest` is correct in the subtle part.** It memoizes the *promise* (single-flight, no double query), not the resolved value, and is scoped to one request. OH-QM-11 proves the "memo outlives its request" failure cannot slip through (C62).
5. **`HatClaim = Id | ((hat) => boolean)`** removes the id-translation shim for a name-keyed session claim, and `Decision.claimed` records the right fact in both modes (C58).
6. **The generic selectors preserve the host's type.** `wearableAt<H extends HeldHat>` and `wornHat<H>` return the host's extended hat, so call sites need no casts (C57).
7. **The conformance inventory is data with drift detection on both sides.** `conformanceGaps` fails on a `missing` id *and* an `unknown` one, and grows safely — a new case is reported missing, never silently passing (C45).
8. **Path build and parse are colocated** (`childPath`/`leafScopeId`/`parentPath`), with the reason stated: the format is the model's, so its parser ships beside its builder (C59).
9. **The `substr(...) = s.path` decision is portable by argument**, with the D1 fifty-character measurement recorded — the kind of thing that stays fixed (C60).
10. **The DDL encodes what SQL can.** `CHECK ((team_id IS NULL) <> (scope_id IS NULL))` for team-xor-scope, partial unique indexes for one-primary/one-default per organization, and a probe named for the invariant a `CHECK` cannot state (C47).
11. **The toolchain is coherent.** `verbatimModuleSyntax` + `import type`; `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` lets Node 24 run `.ts` directly while emitting correct `.js`; strict everywhere.
12. **Comments explain *why*.** `port.ts`'s memoize-and-foreign-key header and the C60 note save a consumer a day. The examples double as an executable spec and run with plain `node`.

## Concerns

### C67 — `unknown-actor` conflates "unknown to the operation" with "no grant in this organization"

**Where** — `src/decide.ts:141` filters `held` by `organizationId`, then `src/decide.ts:170` tests `held.length === 0 → "unknown-actor"`.

**Why it matters** — the doc comment on `DenyReason` says *"The actor holds no grant in the operation"*, but the test is against the *organization-filtered* set. An actor who is known and holds grants in the operation, but holds nothing in the requested organization, is reported identically to an actor who does not exist. Measured:

```
robin, no org context      : allow
robin, foreign org context : unknown-actor   <-- robin holds a grant in the operation
ghost, no grants at all    : unknown-actor
```

**Recommendation** — carry the unfiltered count through `loadWorn` and test it, so the org-filtered emptiness falls to `not-admitted` (or to a distinct reason, if the consumer's audit wants one):

```ts
interface Worn {
  readonly target: Target;
  readonly held: readonly HeldHat[];   // organization-filtered
  readonly known: boolean;             // allHeld.length > 0
  readonly worn: HeldHat | null;
  readonly fallback: HatSource | null;
}
// ...
if (!known) return { ok: false, reason: "unknown-actor", hat: null, fallback: null, ...base };
```

This changes a *reason a consumer may map to a response*, so it is a C31-adjacent decision, not a private fix — but the current mapping is wrong on its own terms. If the consumer prefers the conflated reason (organization is "the operation" for them), say so in the comment and rename the reason; do not leave the comment asserting the opposite.

### C68 — `parentPath` / `leafScopeId` silently return garbage for non-canonical paths

**Where** — `src/core.ts:85,90`. They assume a leading and trailing slash; nothing enforces it.

**Evidence** (measured):

```
"a/b"  -> leaf "b",  parent "a"     (canonical: "a/")
"b"    -> leaf "b",  parent ""      (canonical: "/")
```

**Recommendation** — these are the *parser* half of a public builder, and a host that passes a bare id gets a truncated string rather than an error. Either state the precondition where it is legible (a `@throws`/`@param` sentence is thin for an exported API) or make the pair total: treat a path that does not end in `/` as a single leaf and return `"/"` for a parentless form, or assert the trailing slash. Whichever is chosen, `scopeCovers` needs no change — I verified the mandatory trailing slash already prevents `/a/` from covering `/ab/`.

### C69 — `addScope` silently falls back to the root when the parent does not exist

**Where** — `src/node.ts:125`: `parent === null ? "/" : (this.scopePath(parent) ?? "/")`.

**Why it matters** — a typo'd or stale `parent` id yields a scope quietly created at `/`, a wrong tree rather than a refusal — and inconsistent with `addGrant`, which refuses loudly. The reference adapter is the shape hosts copy.

**Recommendation** — throw when `parent !== null` and `scopePath(parent)` is `null`. The `?? "/"` is right only for the `parent === null` branch, which is already handled.

### C70 — the "open interface" promise is partly erased by the spine

**Where** — `src/core.ts` (`HeldHat`'s *"a host that needs more still extends"*), `src/port.ts` (`hatsOf` returns `readonly HeldHat[]`), `src/decide.ts` (`Decision.hat: HeldHat`).

**Why it matters** — `wearableAt`/`wornHat` are generic over `H extends HeldHat` (C57), so a host extension survives *those*. But the port widens to `HeldHat`, so a field beyond `roleName`/`teamName`/`scopeName` does not survive `decide` — which is exactly what the `HeldHat` doc invites. C65 says no audit field has been needed yet, so this may be a deliberate line.

**Recommendation** — take the position explicitly rather than leaving two paragraphs that disagree: either state in `HeldHat` that the three names are the contract *through the port and the spine*, or make `decide`/`Decision` generic over the hat type the way `wearableAt`/`wornHat` already are. The first is cheaper and probably right.

### C71 — `howWorn` re-derives precedence that `wornHat` owns

**Where** — `src/decide.ts:129` (`howWorn`) against `src/core.ts` (`wornHat`).

**Why it matters** — `wornHat` chooses claimed → default → primary → first; `howWorn` independently re-derives the same ladder. A change to either must be mirrored in the other, and a matcher claim is evaluated a second time (visible if a host matcher is not pure).

**Recommendation** — have the selector return the provenance once: an internal `wornWithSource(wearable, claim): { hat; source }`, with `wornHat` as the thin wrapper that drops `source` and `decide` as the caller that keeps it. Then the drift is inexpressible, and the duplicate matcher call goes away.

### C72 — hardening flags are one line away and currently off

**Where** — `tsconfig.json`, `tsconfig.core.json`.

**Evidence** — `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` add **exactly one** error across the repo:

```
src/node.ts(80,5): Type '{ … teamName: string | undefined … }' is not assignable to type 'HeldHat[]'.
```

i.e. only `teamName/scopeName: r.x ?? undefined` (`src/node.ts:94,95`).

**Recommendation** — turn both on. Fix the one error by omitting the key rather than writing `undefined` into it, so the public type is untouched:

```ts
...(r.team_name !== null ? { teamName: r.team_name } : {}),
...(r.anchor_name !== null ? { scopeName: r.anchor_name } : {}),
```

That buys checked index access across `wearable[0]`, `held[0]?.n`, and every array read — cheap hardening for a library whose whole thesis is that the compiler holds the line.

### C73 — the example helpers are duplicated four ways

**Where** — `assert` in `examples/{conformance,decide,model,operations}.ts`; `refuses` in `model.ts` and `conformance.ts`; `same` in `model.ts` and `operations.ts`.

**Recommendation** — one `examples/_assert.ts` exporting `assert`, `refuses`, `same`. Small, but the examples are the test suite (C36) and they should read as four proofs, not four copies of a header.

### C74 — minor nits

- **`hatsOf`'s capability query is not operation-scoped** (`src/node.ts:68`): it selects capabilities for every role the actor holds anywhere, a superset narrowed by the rows. Harmless; scope it to the operation if it ever matters.
- **`Db` prepares per call** (`src/db.ts`): no statement cache. Fine for the reference; worth a sentence if a host reuses it on a hot path.
- **`admitted` allocates** (`src/core.ts:138`): `wearableAt(...).length > 0` builds an array to test emptiness; `.some((h) => scopeCovers(h.anchorPath, scopePath))` avoids it.
- **`ConformanceBodies` is `Record<string, …>`** (`src/conformance.ts`): an `as const` id union would make a missing body a *compile* error while the runtime gap check stays. Optional; the runtime check is arguably the better contract across repos.
- **OH-QM-05 probes the schema by substring** (`examples/conformance.ts`): `!SCHEMA.includes("audit")` can false-positive if a future comment contains the word. A structured check would be sturdier.

## Verified not concerns

- **`scopeCovers` prefix matching is safe.** The mandatory trailing slash prevents `/a/` matching `/ab/` (measured `false`).
- **The read-rule direction is intended, not inverted.** A team scope must be an *ancestor* of the queried scope; C10 records operation-scoped teams being readable at nested sites.
- **`heldCarries` ignoring organization is correct.** `decide` filters `held` by organization first, then passes the filtered set.
- **`as unknown as T[]` in `db.ts` is sound by convention** — the caller supplies the row shape — and confined to the driver file.
- **C39, C31, C34 remain open by design.** `C67` is a narrow slice of C31 that can be fixed without settling the landing rule.

## Suggested order

1. **C67** — the only functional misreport; needs a one-line consumer conference, then a small change.
2. **C72** — cheapest hardening in the repo; one line plus two flags.
3. **C68, C69** — restore the "refuse loudly" posture to the two silent fallbacks.
4. **C71, C70** — remove the duplicate precedence; state the extension line where the port and spine meet.
5. **C73, C74** — tidy, as the examples are touched.

When any of these closes, file it in [`docs/concerns.md`](../docs/concerns.md) under its id. `C67`–`C73` are resolved there as of v0.4.2; `C74` is partial.
