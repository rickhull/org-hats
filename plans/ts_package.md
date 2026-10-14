# The TypeScript package

*Plan for turning this repo into a publishable, usable, independent TypeScript package.*

## Goal

Publish `org-hats` as a small, dependency-free TypeScript package that:

- states the organization model as **pure types and predicates** over plain records;
- exposes a single **async persistence port** so the same core runs on Node's SQLite (the reference) and on Cloudflare D1 (a consumer's adapter);
- is consumable as a git dependency pinned to a tag.

This is an engineering contribution, not a research one: a *workable* model covering the common working arrangements, expressed as a clean reference implementation and the docs that explain it. The 80% claim is supported by the tutorial and the conformance cases, not by measurement.

## The razor

**Every artifact must be either the published surface a consumer imports, or the reference that proves the model. Anything else — a process artifact, an application concept, a second adapter, a registry — stays out.**

Applied:

| Artifact | Where it lives | Why |
| --- | --- | --- |
| Core types + predicates | `src/core.ts` → package `org-hats` | the published surface |
| The async port | `src/port.ts` → package | the one persistence contract |
| SQLite reference adapter | `src/node.ts` → `org-hats/node` | reference; the only `node:*` |
| Walkthroughs | `examples/` | prove the model; not shipped |
| Operations layer (peers, operation entity) | `examples/operations.ts` | application concept; not shipped |
| D1 adapter | a consumer | theirs |
| Conformance inventory | `src/conformance.ts` → package | the shared contract both sides run |
| npm registry | not used | one consumer; a git tag is shorter |

## Target layout

```
src/
  core.ts        types, Target, predicates, childPath, SCHEMA, actions   (no node:*)
  port.ts        OrgHatsRepository — the async persistence port          (types only)
  conformance.ts the OH-QM inventory as data + conformanceGaps           (no node:*)
  node.ts        SqliteRepository + installSchema                        (node:sqlite)
  db.ts          the thin DatabaseSync wrapper                           (node:sqlite)
  index.ts       re-export core + port + conformance
examples/
  model.ts       the core walkthrough, against SqliteRepository
  operations.ts  the operations-layer walkthrough
  conformance.ts the reference proof of the ten OH-QM cases
  check.ts       runs them all, in order
tests/           (later) the conformance cases keyed by id
docs/            model, tutorial, rbac, operations layer, concerns, plans
bin/check        the fence + examples (+ short-circuit)
package.json     exports ".", "./node"; files dist; zero runtime deps
tsconfig.json    build config (emits dist)
tsconfig.core.json  core only, types: []   (the neutrality fence)
```

## The rules the package states (unchanged from the model)

The model is frozen; this plan moves code, it does not change behavior. Recap of the shape both sides have agreed:

- five entities — Actor, Role, Team, Organization, Scope — and one relationship, **grant**, plus **capability** as the deferred permission edge;
- a grant is over a **team xor a scope**; a team is `(scope, name)`; scopes nest; orgs hang off the **root** scope (the operation);
- **affiliation is a member grant** (a team-bound grant whose role carries `author`) — no membership table;
- ids are **opaque, caller-supplied text**; every unique key survives a multi-operation host;
- roles and capabilities are **global** platform vocabulary, seeded, never customer rows.

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

`HeldHat` is the one derived record: the adapter joins `grant → role → capability` to fill `actions`, and `team → scope` to fill `anchorPath`. That is what lets every predicate be pure and synchronous — the whole point of the split. (A consumer maps its own `Hat` onto it mechanically.)

Why `anchorPath` and not two paths: a hat's *wearability* is its anchor scope's coverage (`team`'s scope for a team grant, the grant's own scope for a scope grant). *Reach for acting* is `scopeCovers(anchorPath, target.scopePath)` together with the team/scope rule. One derived path covers both.

`reach`:
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

Two questions, both async — D1's shape. Deliberately the two questions a consumer's request path already asked, minus the parts that are theirs. A Node adapter satisfies it here; a D1 adapter satisfies it there. The core never sees a driver.

The **org-side read rule** (`organizationsOf`, `scopeCovers`) is core, pure, and exported; the *query* and the peer union are the adapter's. That division is the one a consumer proposed and we accept it.

## The fence (do this first)

`tsconfig.core.json` compiles `src/core.ts` and `src/port.ts` **alone**, with `types: []` and `lib: ["ES2023"]`. With no `@types/node`, a stray `import "node:sqlite"` in the core fails to compile — "cannot find module" — so runtime-neutrality is enforced by the compiler, not a review. `bin/check` runs it first.

The project `tsconfig.json` keeps `types: ["node"]` and includes everything; it is the *build* config.

## Build and package

- `rewriteRelativeImportExtensions: true` (TypeScript 5.7+, already pinned) rewrites `./core.ts` → `./core.js` in emit, so we keep `.ts` specifiers — `node examples/model.ts` still runs directly — **and** produce a correct `dist/`. Fallback if the installed `tsc` disagrees: `.js` specifiers and examples run against `dist/`.
- `tsc -p tsconfig.json` emits `dist/`; **commit it**, so no `prepare`/build runs at install (a consumer's requirement).
- `package.json`:
  ```json
  {
    "name": "org-hats",
    "version": "0.1.0",
    "type": "module",
    "exports": {
      ".":      { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "./node": { "types": "./dist/node.d.ts",  "default": "./dist/node.js" }
    },
    "files": ["dist"],
    "dependencies": {}
  }
  ```
  `private` removed, `dependencies` empty and stated, `devDependencies` only `typescript`/`@types/node`.
- Publish: a public GitHub repo, tag `v0.1.0`. A consumer pins a git tag. No registry.

## The appendix (dropped)

The Ruby reference was removed from the public package: it is a second copy of the fixtures to keep clean, and an afterthought. Lockstep (C36) passes entirely to the conformance inventory.

## Order of work

1. **The fence.** `tsconfig.core.json`; `bin/check` runs it; nothing else moves yet.
2. **The split.** `src/core.ts`, `src/port.ts`, `src/db.ts`, `src/node.ts`, `src/index.ts`; walkthroughs to `examples/`; delete the monolithic `Model`.
3. **Examples green.** `examples/check.ts` runs the core and operations walkthroughs against `SqliteRepository`, asserting the same rules and the same planner bounds.
4. ~~Appendix.~~ Dropped — the Ruby reference is not part of the public package.
5. **Build and package.** `rewriteRelativeImportExtensions`, `dist/`, exports/files/version, zero deps.
6. **Docs and README** reflect the package.
7. **The conformance inventory.** `src/conformance.ts` carries the ten `OH-QM` cases as data with `conformanceGaps`; `examples/conformance.ts` proves all ten against the reference adapter, in `bin/check`.
8. **Tag** `v0.1.0` — Rick's act.

## Acceptance (a consumer's checklist, mapped)

| Their item | Here |
| --- | --- |
| 1 `private`/version/exports/files | step 5 |
| 2 default entry free of `node:*`; adapter at `org-hats/node` | steps 1–2 |
| 3 compiled `dist/` committed | step 5 |
| 4 async `Repository` as the only persistence | step 2 |
| 5 a tag | step 7 |
| 6 `.ts` specifiers vs emit | `rewriteRelativeImportExtensions` (step 5) |
| 7 compiler-enforced neutrality | step 1, the fence |
| 8 `childPath` exported | step 2 |
| 9 conformance inventory as data | step 7 |

## Open questions

- **`HeldHat = { grant, actions, anchorPath }`** — confirmed with a consumer; structural and open (no exact type, no brand, no class).
- **Does the node adapter ship**, or live only in `examples/`? Ship it (they asked); it is the only `node:*`.
- **`rewriteRelativeImportExtensions`** supported by the installed `tsc`? Yes — TypeScript 5.9.3 rewrites `./core.ts` → `./core.js` on emit. Verified, not assumed.
