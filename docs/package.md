# The package

*What `org-hats` ships, and the rules that keep it a package rather than an application.*

## What ships

```
org-hats         pure core + the spine + the port    (bundler-safe; a Worker never sees node:sqlite)
org-hats/node    SqliteRepository                    (the reference adapter)
```

Zero runtime dependencies. `dist/` is committed, so nothing builds at install. The package is ESM-only; the adapter needs Node ≥ 22.5 for `node:sqlite`, while the core is runtime-neutral — the default entry is verified to load and run in **workerd** (esbuild resolves the `exports` map, and the ES2023 emit needs nothing special).

## Layout

```
src/
  core.ts        types, Target, predicates, path helpers, SCHEMA      (no node:*)
  port.ts        OrgHatsRepository + perRequest — the port and its memo   (no node:*)
  conformance.ts the OH-QM inventory as data + the runConformance harness (no node:*)
  decide.ts      the request spine — decide, with the two-edge heldAction shape (no node:*)
  testing.ts     fakeRepository — a fake port for tests                  (no node:*)
  node.ts        SqliteRepository + installSchema                        (node:sqlite)
  db.ts          the thin DatabaseSync wrapper                           (node:sqlite)
  index.ts       re-exports core + conformance + port + decide + testing
examples/
  model.ts       the core walkthrough, against SqliteRepository
  operations.ts  the operations-layer walkthrough
  conformance.ts the reference proof of the eleven OH-QM cases
  decide.ts      every decision shape, over the adapter and the fake port
  _assert.ts     the shared assert/refuses/same helpers
  check.ts       runs them all, in order
dist/            the committed build output (.js + .d.ts)
bin/check        the neutrality fence, then the examples
tsconfig.core.json  the fence: core + conformance + port + decide + testing, types: []
tsconfig.json       the build config (emits dist/)
```

## The published surface

```ts
// org-hats
export type Id = string;
export type Target = { kind: "team"; team: Id; scopePath: string }
                   | { kind: "scope"; scopePath: string };
export const onTeam: (team: Id, scopePath: string) => Target;
export const atScope: (scopePath: string) => Target;

export interface Grant { id: Id; roleId: Id; organizationId: Id; teamId: Id | null; scopeId: Id | null; primary: boolean; default: boolean; }
export interface HeldHat { readonly grant: Grant; readonly actions: readonly string[]; readonly anchorPath: string;
  readonly roleName?: string; readonly teamName?: string; readonly scopeName?: string; }
export type HatClaim = Id | ((hat: HeldHat) => boolean);

// The core names no action and privileges none. Presence and standing are
// structural; what any action means is the application's policy.

export const childPath: (parentPath: string, id: Id) => string;
export const leafScopeId: (scopePath: string) => string;
export const parentPath: (scopePath: string) => string;
export const scopeCovers: (ancestorPath: string, descendantPath: string) => boolean;
export function reach(hat: HeldHat, target: Target): boolean;
export function can(hat: HeldHat | null, action: string, target: Target): boolean;
export function heldCarries(hats: readonly HeldHat[], target: Target, action: string): boolean;
export function wearableAt<H extends HeldHat>(hats: readonly H[], scopePath: string): H[];
export function admitted(hats: readonly HeldHat[], scopePath: string): boolean;
export function wornHat<H extends HeldHat>(wearable: readonly H[], claim?: HatClaim | null): H | null;
export type HatSource = "claimed" | "default" | "primary" | "first";
export function selectWorn<H extends HeldHat>(wearable: readonly H[], claim?: HatClaim | null): { hat: H | null; source: HatSource | null };
export function organizationsOf(hats: readonly HeldHat[]): Id[]; // team-bearing hats

export const CONFORMANCE_CASES: readonly { id: string; description: string }[];
export function conformanceGaps(ran: Iterable<string>): { missing: readonly string[]; unknown: readonly string[] };
export function runConformance(bodies: ConformanceBodies): Promise<ConformanceResult>;

// the request spine — decisions as data, over any adapter
export function decide(repo: OrgHatsRepository, request: DecideRequest): Promise<Decision>;
// DecideRequest: action? (the worn hat's capacity check), heldAction? (a held
// grant over the target must carry it — presence ∧ standing, the two-edge
// shape), teamId?, claimedHatId? (id or matcher), organizationId?

// the fake port — two functions and a record, for tests
export function fakeRepository(hats: FakeHats, read?: FakeRead): OrgHatsRepository;

// the request-scoped memo — construct one per request
export function perRequest(repo: OrgHatsRepository): OrgHatsRepository;

// org-hats/node
export class SqliteRepository implements OrgHatsRepository { /* ... */ }
export function installSchema(db: DatabaseSync): void;
```

`HeldHat` is the one derived record: the adapter joins `grant → role → capability` to fill `actions`, and `team → scope` to fill `anchorPath`. That is what lets every predicate stay pure and synchronous — the whole point of the split. It is **structural and open**: an interface, not a class; a consumer maps its own record onto it (or extends it) without ceremony. The three optional name fields are the common extension, adapter-filled from joins the adapter already makes and read by the predicates never — the legible snapshot (`stage-manager:stage ops@big park`) is words, and ids cannot produce them. `wearableAt` and `wornHat` are generic in the hat type — they only select from the array they are given, so a host's extended hat comes back as itself — and `wornHat`'s claim is an id **or a matcher** (`HatClaim`), so a name-keyed session claim never translates through a shim. One caution, stated where it belongs (on `HatClaim`): compose enough names to be unique — `roleName` alone is not (*Supervisor* over two teams), `role:team@scope` is, and the grant id is the unique key.

`anchorPath` is one path, not two, because a hat's *wearability* and its *reach* are the same test — coverage of the anchor scope:

```
scopeCovers(hat.anchorPath, target.scopePath)
  && (target.kind === "team" ? hat.grant.teamId === target.team : hat.grant.teamId === null)
```

## The port

```ts
export interface OrgHatsRepository {
  /** Every hat the actor holds in one operation — memoize per request. */
  hatsOf(actorId: Id, operationId: Id): Promise<readonly HeldHat[]>;
  /** The full read answer for a scope: the organization rule plus the host's peers. */
  readableTeamsAt(hats: readonly HeldHat[], operationId: Id, scopePath: string): Promise<readonly Id[]>;
}
```

Two questions, both async. The **org-side read rule** (`organizationsOf`, `scopeCovers`) is core, pure, and exported; the *query* and any peer union are the adapter's. The core never sees a driver. `src/node.ts` is the SQLite reference adapter; a host supplies its own (e.g. D1). Three notes for adapter writers, the last two learned from a consumer: **memoize `hatsOf` per request** — the port looks like a cheap pure function, but `decide` asks once per decision and a request path may decide several times (`/api/me`, dashboards); `perRequest(repo)` is that instruction in executable form, and it memoizes the *promise*, not the result, so concurrent asks within a request still read once (a consumer measured three concurrent login-path asks → one read); **an adapter may run under enforced foreign keys** (D1 enforces them; the reference turns them on explicitly), which orders inserts — the scope row precedes whatever references it; and the reference adapter's site filter is **`substr`, never `LIKE`** — a consumer measured D1 rejecting `LIKE` patterns of fifty characters and up, which UUID-built paths exceed one level below the root ([organization_model.md](organization_model.md) § *Efficiency*).

## The request spine

`src/decide.ts` composes the port and the predicates **once, in the order the rules require** — `hatsOf → wearableAt → wornHat(claim) → capability ∧ reach` — so the order is testable and the wrong order is inexpressible. Getting it wrong is how a revoked claim authorizes an act: the claim must be re-validated against the *wearable* set, not the held set (rule 7). One function over any adapter, with the **two-edge shape folded in**: set `heldAction` and the decision additionally requires a held grant over the target carrying it — presence from the worn hat, standing from a held one, the held-versus-worn distinction hosts should not reimplement (OH-QM-07). What `heldAction` *means* — membership, filing, representation — is the application's policy.

The contract, in three points:

- **A decision is data, never an exception.** `{ ok, hat, reason?, fallback, claimed, target, action }` — one shape for the audit row on allow and deny (rule 5). Reason codes: `unknown-actor`, `not-admitted`, `no-capability`, `out-of-reach`, `no-held-action`. Mapping them to 404/403 is the host's; an unreadable thing is *not found*, never *forbidden* ([operations_layer.md](operations_layer.md)).
- **A revoked claim falls back, and the drift is auditable.** `fallback` reports how the hat was chosen — `claimed | default | primary | first` — so OH-QM-04's fallback appears in the row instead of silently wearing the default.
- **“The claim resolved” is not “the claim mattered.”** When a row needs to know whether the claim *changed* what was worn — not merely that it resolved to the hat the landing order would have picked anyway — compare against the landing hat: `wornHat(wearableAt(hats, scopePath))` against the decision's hat. Free under the memo, one line in the host. The consumer has since looked (C65): no audit question has needed it, so the derivation is the standing answer — a field lands only if a row ever proves to need one.
- **The organization is request context** — C31's position, taken: an optional `organizationId` filters wearability, so an actor's hats in other organizations are not even wearable. A host serving team routes passes the team's organization; a host that disagrees ignores the field.
- **Enumeration is the port's; decision is the spine's.** RBAC96 answers “what can this user do?” with a union over activated roles; here that question is **enumeration** — `hatsOf` then `wearableAt`, names included — and the spine answers **one act at a time**. `/api/me` and dashboards are port questions; accumulation across hats is what the one-hat rule exists to prevent.
- **Two questions on one route are two decisions.** The consumer's report creation asks the two-edge question first (`action: null, heldAction` — whose report is this?), then a capability question (`action: "resolve"` — is this reporter a supervisor?): different facts, one memoized read. The memo is what makes the pattern free.

**Cost posture (C54):** one `hatsOf` per request; no cache — immediacy is conformance (OH-QM-03, OH-QM-04), and Zanzibar's bounded staleness is the opposite trade ([literature_review.md](literature_review.md) § Zanzibar). The scale answer is a **request-scoped snapshot**: `perRequest(repo)` answers a request's every decision from one consistent read, and never outlives the request — revocation lands on the *next* one.

`src/testing.ts` ships `fakeRepository` — the port is two questions, so a fake is two functions — for testing route wiring without a driver. `examples/decide.ts` walks every decision shape, over the adapter and the fake.

## The fence

`tsconfig.core.json` compiles `src/core.ts`, `src/conformance.ts`, `src/port.ts`, `src/decide.ts`, and `src/testing.ts` **alone**, with `types: []` and `lib: ["ES2023"]`. With no `@types/node`, a stray `import "node:sqlite"` in the pure core fails to compile — runtime-neutrality is enforced by the compiler, not by review. `bin/check` runs it first. (Proven: a file importing `node:sqlite` fails the fence; `src/core.ts` has no imports at all.)

`tsconfig.json` keeps `types: ["node"]` and includes everything; it is the *build* config.

## Build and package

- `rewriteRelativeImportExtensions` (TypeScript 5.7+) rewrites `./core.ts` → `./core.js` on emit, so the source keeps `.ts` specifiers — `node examples/model.ts` runs directly under Node 24 — **and** the build emits a correct `dist/`.
- `tsc -p tsconfig.json` emits `dist/`; **it is committed**, so no `prepare`/build runs at install.
- `package.json`: `exports` `"."` and `"./node"`, `files: ["dist"]`, `dependencies: {}`, `version 0.4.2`, `license: MIT`, and `repository`/`homepage`/`bugs` pointing at the canonical repo (see [publishing.md](publishing.md)).
- **Distribution is a git tag**, not a registry — the shortest path for a zero-dependency package with one consumer.

## The conformance inventory

`src/conformance.ts` carries `OH-QM-01` … `OH-QM-11` as **data** (`CONFORMANCE_CASES`) plus `conformanceGaps`, which fails a run on a missing or unknown id. The `OH` is this package, `QM` the first consumer's suite; the ids are kept stable so the two cannot drift. A host runs a body per id against its own adapter; `examples/conformance.ts` is the reference proof of all eleven, run by `bin/check`. `OH-QM-11` grew the inventory by design — a consumer observed that the memo's one-request lifetime was proved only in *its* suite; now two requests, two memos, and a revocation between them are the shared contract.

A note on the pair, in a consumer's words: **OH-QM-05 proves the audit *snapshot* survives revocation; OH-QM-11 proves the *authority* does not.** Both revoke a hat; one is about what must persist and the other about what must not. (The consumer mutation-tested the pair at its boundary: hoisting the memo to module scope fails both cases, for opposite reasons.)

## What stays out

The razor: **every artifact is either the published surface a consumer imports, or the reference that proves the model.**

| Artifact | Where it lives | Why |
| --- | --- | --- |
| Core types + predicates | `src/core.ts` → `org-hats` | the published surface |
| The async port | `src/port.ts` → `org-hats` | the one persistence contract |
| The request spine | `src/decide.ts` → `org-hats` | published surface — the rules composed in order |
| The conformance harness | `src/conformance.ts` → `org-hats` | published surface — a host proves the eleven against its own store |
| The fake port | `src/testing.ts` → `org-hats` | published surface — tests without a driver |
| The write side | `docs/writes.md` | reference documentation + SQL for a host's own migrations — not port surface (C53 concluded) |
| SQLite reference adapter | `src/node.ts` → `org-hats/node` | reference; the only `node:*` |
| Walkthroughs | `examples/` | prove the model; not shipped |
| Operations layer (peers, operation entity) | `examples/operations.ts` | application concept; not shipped |
| A host's adapter (e.g. D1) | the host | theirs |
| The Ruby reference | — | dropped; the TypeScript is the reference |
| A registry | — | a git tag is shorter |
