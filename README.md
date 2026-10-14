# org-hats

*Who may act, in what capacity, over which group, and where — a small, reusable organization model for the authorization core of an application.*

## In brief

`org-hats` is a small, dependency-free component that answers one question — **who may act, in what capacity, over which group, and where** — in a shape that stays small as the organization grows. It separates the *capacity* (a role such as Supervisor) from the *context* (the team, the organization, the place), so the number of roles stays flat while teams, sites, and organizations multiply.

It is a component to embed in an application, not a product or a service. The model is five entities and two relationships, and the decision rule is one line of logic; there are no runtime dependencies and no lock-in — SQLite today, Cloudflare D1 or anything else tomorrow. It sits *inside* role-based access control rather than beside it: the structural core an RBAC application is built on, not a replacement for one.

| | |
| --- | --- |
| **What it buys** | Roles that do not grow with the org chart. Access that can be enumerated and reviewed. Revocation that is immediate and explicit. A core small enough to read, test, and audit in an afternoon. No dependence on a particular database, cloud, or vendor. |
| **What it costs** | You supply the parts that are yours — identities, the objects being protected, the list of actions, and the audit log. This is the authorization core, not the whole system. |
| **What it leaves out** | Role hierarchy, separation-of-duty rules, and role administration. Each is deferred on purpose, with the seam named, rather than half-built. |
| **Maturity** | The model is frozen and exercised; the package is published under the MIT license; the public surface is small and stable. |

## The problem

Any application with more than a few users has to answer *who may do this, as what, and over whom?* Two failures are common:

- **Context encoded in role names.** `supervisor-northport`, `coach-drive` — a role per group and place, until roles outnumber people and no one can audit who may do what.
- **Authority, membership, and place entangled.** One table carries the person, the group, the permission, and the place, so every question must join all four.

## The model

Five entities and two relationships. The directory says who is who, on what team, in which organization, and where; permissions say which roles may perform which actions.

| Entity | Meaning |
| --- | --- |
| **Actor** | a person or process that acts |
| **Role** | a capacity — *Supervisor*, *Coach* — with a name and no context |
| **Team** | a named group, fielded by one organization, working at one place |
| **Organization** | who fields a team; the boundary authority does not cross |
| **Scope** | a place — operation, site, floor; where authority reaches |

- A **grant** gives an actor a role **over** a team or a scope.
- A **capability** gives a role an **action**.

Two consequences carry most of the model:

- **A grant is a hat.** An actor holds many hats and wears **one at a time**; the worn hat is the capacity in force, re-checked on every request, so revocation takes effect immediately.
- **Affiliation is not a third relationship.** An actor is affiliated with a team by holding a grant over it whose role may author. "Who is on this team" is derived — and supervising a team never makes one a member.

## The permission seam

The model names no action and no object; the application names both. Authority is two questions, composed:

```
can(hat, action, target)  =  capability(hat.role, action)  ∧  reach(hat.grant, target)
                              ─────────┬────────              ──────────┬──────────
                          the capacity            the object half: the target
                          (role → action)         falls inside the grant's reach
```

The role supplies the action; the grant supplies the reach — a **team** exactly, or a **scope** and everything nested inside it. One `Supervisor` role therefore serves every team and site. The object is a value the grant reaches, never part of a role's name.

## Principles

- **One active hat.** Switching deactivates the last; capabilities never accumulate across hats.
- **The role gives capability; team and scope give reach.**
- **Affiliation is a member grant** — a team-bound grant whose role may author. Supervising never makes one a member.
- **Context lives in columns, never in role names.**
- **No hidden authority.** No inheritance, nothing implicit; every grant and every switch is explicit and auditable.
- **Permissions are assigned to roles, never encoded in them.**

## Relation to the literature

This is **Core RBAC's structural half** — who holds which capacity, over what — without its permission matrix, which belongs to the application. It does not compete with role-based access control; it is a component for building it.

The closest references, in order of closeness:

- **Core RBAC.** ANSI/INCITS 359-2004; from Sandhu, Coyne, Feinstein & Youman (1996), *Role-Based Access Control Models* — the RBAC96 family, model RBAC0. Users, roles, permissions, sessions, and the two assignment relations. Read this first.
- **Team context.** Thomas (1997), *Team-Based Access Control (TMAC)* — the team as the context of a role, beside the role rather than inside its name.
- **Parameterized and contextual roles.** Giuri & Iglio (1997), *Role Templates for Content-Based Access Control*; Covington, Moyer & Ahamad (2001), *Generalized Role-Based Access Control*. The closest reference for a role scoped to a subject — a grant of a role *over* something.
- **The relationship graph.** Pang et al. (2019), *Zanzibar* — organizations, teams, and cross-organization peers as explicit edges rather than role names.
- **The failure this avoids.** Kuhn, Coyne & Weil (2010), *Adding Attributes to Role-Based Access Control* — context in a role's name multiplies roles until auditing is impossible.

Deliberately outside the model: role hierarchy (RBAC1), declarative separation of duty (RBAC2), and role administration (ARBAC97; Sandhu, Bhamidipati & Munawer, 1999). The full comparison — the RBAC mapping, the `can` split, and a reading list — is in [docs/rbac.md](docs/rbac.md).

## What is here

A TypeScript package, published as `org-hats`:

- **[`src/core.ts`](src/core.ts)** — the pure surface: the entities, `Target`, and the predicates (`can`, `reach`, `wornHat`, `wearableAt`, `admitted`, `scopeCovers`, `childPath`, `organizationsOf`). No runtime dependency and no `node:*`, enforced by [`tsconfig.core.json`](tsconfig.core.json).
- **[`src/port.ts`](src/port.ts)** — `OrgHatsRepository`, the one async persistence contract.
- **[`src/conformance.ts`](src/conformance.ts)** — the shared `OH-QM-01` … `OH-QM-10` inventory, as data.
- **[`src/node.ts`](src/node.ts)** — the SQLite reference adapter (`org-hats/node`), the only place a driver is spoken to.
- **[`examples/`](examples)** — the walkthroughs: the core, an operations layer that adds cross-organization peers, and the reference proof of the ten conformance cases.

```
org-hats         pure core + the async port    (a Worker never sees node:sqlite)
org-hats/node    SqliteRepository              (the reference adapter)
```

Zero runtime dependencies; `dist/` is committed, so nothing builds at install. See [docs/package.md](docs/package.md) for the layout, the port, and the build rules.

## Running

```
bin/check            # the neutrality fence, then the examples
```

`bin/check` needs only `node` — Node 24 runs `.ts` directly — and, for the fence, the dev dependencies:

```
pnpm install         # typescript + @types/node, once
pnpm build           # tsc -p tsconfig.json   -> dist/   (committed)
pnpm typecheck       # the fence (tsconfig.core.json) + the build config
```

CI runs the same on every push — install, build, a **stale-`dist/` guard**, then `bin/check` — in [`.github/workflows/check.yml`](.github/workflows/check.yml).

## Docs

- **[`docs/organization_model.md`](docs/organization_model.md)** — the full statement: entities, rules, boundaries, the permission seam, and complexity bounds.
- **[`docs/rbac.md`](docs/rbac.md)** — this model in RBAC terms: the mapping, the `can` split, and the reading list.
- **[`docs/tutorial.md`](docs/tutorial.md)** — a guided build from one person to a multi-organization operation.
- **[`docs/operations_layer.md`](docs/operations_layer.md)** — how an application maps operations, sites, and cooperation onto the model.
- **[`docs/package.md`](docs/package.md)** — what the package ships and the rules that keep it one.
- **[`docs/publishing.md`](docs/publishing.md)** — where it is published and how it mirrors.
- **[`docs/concerns.md`](docs/concerns.md)** — the tracked review queue.
- **[`plans/publish.md`](plans/publish.md)** — the remaining publishing work.

## Status

The model is frozen and exercised in the reference implementation. The permission layer is a seam — one `capability` table and one predicate — and is not yet wired into an application. [`docs/concerns.md`](docs/concerns.md) tracks the review queue.

## License

MIT. See [LICENSE](LICENSE).
