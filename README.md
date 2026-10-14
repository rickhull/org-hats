# Organization Model

*A small, reusable way to say who may do what, for whom, and where — built to be applied to an application, not to be one.*

## The idea

An organization is **people holding capacities over groups**, bounded by *who fields a group* and *where it works*. The core is five entities and two relationships; an application adds its own on top (see the operations layer), and the core never learns what they are.

- **Core entities** — **Actor**, **Role**, **Team**.
- **Boundaries** — **Organization** (who fields a team) and **Scope** (where authority reaches).
- **Relationships** — a **grant** (an actor may wear a role over a team or a scope) and a **capability** (a role may perform an action). Affiliation is not a third edge: an actor is affiliated with a team by holding a grant over it whose role may author.
- A **hat** is the name for a grant: a role held over a team or a scope. An actor holds many hats and **wears one at a time**.

## Two layers

- **The directory** — entities and relationships: who is who, in what capacity, on what team, in which organization, where.
- **Permissions** — an optional layer that attaches capabilities to roles, behind one predicate: `can(activeGrant, action, target)`. Its seam is defined here; its vocabulary belongs to the application.

## Principles

- **One active hat.** Switching deactivates the last; capabilities never accumulate.
- **The role gives capability; team and scope give reach.**
- **Affiliation is a member grant** — a team-bound grant whose role may author. Supervising a team never makes one a member.
- **Context lives in columns, never in role names** — the cure for role explosion.
- **No hidden authority.** No inheritance, nothing implicit; every grant and switch is explicit and auditable.
- **Permissions are assigned to roles, never encoded in them.**

## The package

TypeScript is the package, published as `org-hats`. (A *package* is the unit of distribution — `package.json`, `exports`, `files`; a *module* is one file. This package is several modules.)

- **[`src/core.ts`](src/core.ts)** — the pure surface: records, `Target`, and the predicates (`can`, `reach`, `wornHat`, `wearableAt`, `admitted`, `scopeCovers`, `childPath`, `organizationsOf`). No runtime dependency and no `node:*` — enforced by [`tsconfig.core.json`](tsconfig.core.json), not by review.
- **[`src/port.ts`](src/port.ts)** — `OrgHatsRepository`, the one async persistence contract.
- **[`src/conformance.ts`](src/conformance.ts)** — the shared `OH-QM-01` … `OH-QM-10` inventory as data, so this package and a consumer's suite prove the same cases and fail on a missing id.
- **[`src/node.ts`](src/node.ts)** — the SQLite reference adapter (`org-hats/node`), the only place a driver is spoken to.
- **[`examples/`](examples)** — the walkthroughs: the core, an operations layer that adds cross-organization peers, and the reference proof of the ten conformance cases.
- **[`plans/ts_package.md`](plans/ts_package.md)** — the plan this layout implements.
- **[`plans/publish.md`](plans/publish.md)** — the plan for going public: what stays, what is genericized, what is removed.

The packaged surface:

```
org-hats         pure core + port       (bundler-safe; a Worker never sees node:sqlite)
org-hats/node    SqliteRepository       (the reference adapter)
```

Zero runtime dependencies; `dist/` is committed so no build runs at install. The default entry is verified to load and run in **workerd** (Cloudflare's runtime): esbuild resolves the `exports` map, and the ES2023 emit needs nothing special.

## Running

```
bin/check            # the package: the runtime-neutrality fence, then the examples
```

`bin/check` needs only `node` — Node 24 runs `.ts` directly — and, for the fence, the dev dependencies:

```
pnpm install         # typescript + @types/node, once
pnpm build           # tsc -p tsconfig.json   -> dist/   (committed)
pnpm typecheck       # the fence (tsconfig.core.json) + the build config
```

## Docs

- **[`docs/tutorial.md`](docs/tutorial.md)** — a guided build from one person to a multi-organization operation, one concept at a time.
- **[`docs/organization_model.md`](docs/organization_model.md)** — the full statement: entities, rules, boundaries, the permission seam, data relationships, and complexity bounds.
- **[`docs/rbac.md`](docs/rbac.md)** — this model in RBAC terms: the closest references, the mapping, and how to build a Core RBAC application on it.
- **[`docs/operations_layer.md`](docs/operations_layer.md)** — how an application maps operations, sites, and multi-organization cooperation onto the model without changing it.
- **[`docs/concerns.md`](docs/concerns.md)** — the tracked review queue.

## Status

The model is frozen and exercised in the reference implementation. The permission layer is a seam — one `capability` table and one predicate — and is not yet wired into an application. The TypeScript **package** is being made installable; see [`plans/ts_package.md`](plans/ts_package.md). [`docs/concerns.md`](docs/concerns.md) tracks the review queue.

## License

MIT. See [LICENSE](LICENSE).
