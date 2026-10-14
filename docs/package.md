# The package

*What `org-hats` ships, and the rules that keep it a package rather than an application.*

## What ships

```
org-hats         pure core + the async port    (bundler-safe; a Worker never sees node:sqlite)
org-hats/node    SqliteRepository              (the reference adapter)
```

Zero runtime dependencies. `dist/` is committed, so nothing builds at install. The package is ESM-only; the adapter needs Node ≥ 22.5 for `node:sqlite`, while the core is runtime-neutral — the default entry is verified to load and run in **workerd** (esbuild resolves the `exports` map, and the ES2023 emit needs nothing special).

## Layout

```
src/
  core.ts        types, Target, predicates, childPath, SCHEMA, actions   (no node:*)
  port.ts        OrgHatsRepository — the async persistence port          (types only)
  conformance.ts the OH-QM inventory as data + conformanceGaps           (no node:*)
  node.ts        SqliteRepository + installSchema                        (node:sqlite)
  db.ts          the thin DatabaseSync wrapper                           (node:sqlite)
  index.ts       re-exports core + port + conformance
examples/
  model.ts       the core walkthrough, against SqliteRepository
  operations.ts  the operations-layer walkthrough
  conformance.ts the reference proof of the ten OH-QM cases
  check.ts       runs them all, in order
dist/            the committed build output (.js + .d.ts)
bin/check        the neutrality fence, then the examples
tsconfig.core.json  the fence: core + conformance + port, types: []
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
export interface HeldHat { readonly grant: Grant; readonly actions: readonly string[]; readonly anchorPath: string; }

export const AUTHOR: "author"; // and READ, RESOLVE, CONFIGURE

export const childPath: (parentPath: string, id: Id) => string;
export const scopeCovers: (ancestorPath: string, descendantPath: string) => boolean;
export function reach(hat: HeldHat, target: Target): boolean;
export function can(hat: HeldHat | null, action: string, target: Target): boolean;
export function maySpeak(worn: HeldHat | null, target: Target, held: readonly HeldHat[]): boolean;
export function wearableAt(hats: readonly HeldHat[], scopePath: string): HeldHat[];
export function admitted(hats: readonly HeldHat[], scopePath: string): boolean;
export function wornHat(hats: readonly HeldHat[], claimedId?: Id | null): HeldHat | null;
export function organizationsOf(hats: readonly HeldHat[]): Id[]; // team-bearing hats

export const CONFORMANCE_CASES: readonly { id: string; description: string }[];
export function conformanceGaps(ran: Iterable<string>): { missing: readonly string[]; unknown: readonly string[] };

// org-hats/node
export class SqliteRepository implements OrgHatsRepository { /* ... */ }
export function installSchema(db: DatabaseSync): void;
```

`HeldHat` is the one derived record: the adapter joins `grant → role → capability` to fill `actions`, and `team → scope` to fill `anchorPath`. That is what lets every predicate stay pure and synchronous — the whole point of the split. It is **structural and open**: an interface, not a class; a consumer maps its own record onto it (or extends it) without ceremony.

`anchorPath` is one path, not two, because a hat's *wearability* and its *reach* are the same test — coverage of the anchor scope:

```
scopeCovers(hat.anchorPath, target.scopePath)
  && (target.kind === "team" ? hat.grant.teamId === target.team : hat.grant.teamId === null)
```

## The port

```ts
export interface OrgHatsRepository {
  /** Every hat the actor holds in one operation, with actions and anchor path resolved. */
  hatsOf(actorId: Id, operationId: Id): Promise<readonly HeldHat[]>;
  /** The full read answer for a scope: the organization rule plus the host's peers. */
  readableTeamsAt(hats: readonly HeldHat[], operationId: Id, scopePath: string): Promise<readonly Id[]>;
}
```

Two questions, both async. The **org-side read rule** (`organizationsOf`, `scopeCovers`) is core, pure, and exported; the *query* and any peer union are the adapter's. The core never sees a driver. `src/node.ts` is the SQLite reference adapter; a host supplies its own (e.g. D1).

## The fence

`tsconfig.core.json` compiles `src/core.ts`, `src/conformance.ts`, and `src/port.ts` **alone**, with `types: []` and `lib: ["ES2023"]`. With no `@types/node`, a stray `import "node:sqlite"` in the pure core fails to compile — runtime-neutrality is enforced by the compiler, not by review. `bin/check` runs it first. (Proven: a file importing `node:sqlite` fails the fence; `src/core.ts` has no imports at all.)

`tsconfig.json` keeps `types: ["node"]` and includes everything; it is the *build* config.

## Build and package

- `rewriteRelativeImportExtensions` (TypeScript 5.7+) rewrites `./core.ts` → `./core.js` on emit, so the source keeps `.ts` specifiers — `node examples/model.ts` runs directly under Node 24 — **and** the build emits a correct `dist/`.
- `tsc -p tsconfig.json` emits `dist/`; **it is committed**, so no `prepare`/build runs at install.
- `package.json`: `exports` `"."` and `"./node"`, `files: ["dist"]`, `dependencies: {}`, `version 0.1.0`, `license: MIT`, and `repository`/`homepage`/`bugs` pointing at the canonical repo (see [publishing.md](publishing.md)).
- **Distribution is a git tag**, not a registry — the shortest path for a zero-dependency package with one consumer.

## The conformance inventory

`src/conformance.ts` carries `OH-QM-01` … `OH-QM-10` as **data** (`CONFORMANCE_CASES`) plus `conformanceGaps`, which fails a run on a missing or unknown id. The `OH` is this package, `QM` the first consumer's suite; the ids are kept stable so the two cannot drift. A host runs a body per id against its own adapter; `examples/conformance.ts` is the reference proof of all ten, run by `bin/check`.

## What stays out

The razor: **every artifact is either the published surface a consumer imports, or the reference that proves the model.**

| Artifact | Where it lives | Why |
| --- | --- | --- |
| Core types + predicates | `src/core.ts` → `org-hats` | the published surface |
| The async port | `src/port.ts` → `org-hats` | the one persistence contract |
| SQLite reference adapter | `src/node.ts` → `org-hats/node` | reference; the only `node:*` |
| Walkthroughs | `examples/` | prove the model; not shipped |
| Operations layer (peers, operation entity) | `examples/operations.ts` | application concept; not shipped |
| A host's adapter (e.g. D1) | the host | theirs |
| The Ruby reference | — | dropped; the TypeScript is the reference |
| A registry | — | a git tag is shorter |
