# org-hats

*Who may act, in what capacity, over which group, and where — a small, reusable organization model for the authorization core of an application.*

## In brief

`org-hats` is a small, dependency-free component that answers one question — **who may act, in what capacity, over which group, and where** — in a shape that stays small as the organization grows. It separates the *capacity* (a role such as Supervisor) from the *context* (the team, the organization, the place), so the number of roles stays flat while teams, sites, and organizations multiply.

It is a component to embed in an application, not a product or a service. The model is five entities and two relationships, and the decision rule is one line of logic; there are no runtime dependencies and no lock-in — SQLite today, Cloudflare D1 or anything else tomorrow. It sits *inside* role-based access control rather than beside it: the structural core an RBAC application is built on, not a replacement for one.

| | |
| --- | --- |
| **What it buys** | Roles that do not grow with the org chart. Access that can be enumerated and reviewed. Revocation that is immediate and explicit. Decisions as data — allow, or deny with a reason. A core small enough to read, test, and audit in an afternoon. No dependence on a particular database, cloud, or vendor. |
| **What it costs** | You supply the parts that are yours — identities, the objects being protected, the list of actions, and the audit log. This is the authorization core, not the whole system. |
| **What it leaves out** | Role hierarchy, declarative separation-of-duty constraints, and negative grants — each refused on purpose, the seam named, not half-built. Role *administration* is not an omission at all: granting is an action like any other, checked by the same rule and audited in the same row. |
| **Maturity** | The model is frozen and exercised; the package is published under the MIT license; the public surface is small and stable. |

## The problem

Any application with more than a few users has to answer *who may do this, as what, and over whom?* Two failures are common:

- **Context encoded in role names.** `stage-manager-bigpark`, `volunteer-gate` — a role per group and place, until roles outnumber people and no one can audit who may do what.
- **Authority, membership, and place entangled.** One table carries the person, the group, the permission, and the place, so every question must join all four.

## The model

Five entities and two relationships. The directory says who is who, on what team, in which organization, and where; permissions say which roles may perform which actions.

| Entity | Meaning |
| --- | --- |
| **Actor** | a person or process that acts |
| **Role** | a capacity — *Stage Manager*, *Volunteer* — with a name and no context |
| **Team** | a named group, fielded by one organization, working at one place |
| **Organization** | who fields a team; the boundary authority does not cross |
| **Scope** | a place — operation, site, floor; where authority reaches |

- A **grant** gives an actor a role **over** a team or a scope.
- A **capability** gives a role an **action**.

Two consequences carry most of the model:

- **A grant is a hat.** An actor holds many hats and wears **one at a time** — separation of duty at its strongest. The worn hat is the capacity in force, re-checked on every request, so revocation takes effect immediately.
- **Membership is not modeled — and that is the point.** The directory has no membership edge to drift out of step with a grant. An application defines its own roster rule over grants — commonly *a grant whose role carries a chosen action* (`heldCarries`) — and that rule is one atomic row, revocable in one delete. Supervising a team confers nothing the application has not said it confers.

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
- **Enumeration is not accumulation.** “What can this actor do?” enumerates held hats, through the port; “may this act proceed?” goes through the spine, one act at a time.
- **The role gives capability; team and scope give reach.**
- **Membership is the application's rule.** The model ships the halves — *presence* (the worn hat reaches) and *standing* (`heldCarries`: a held grant carries the action) — and the application composes what they mean.
- **Context lives in columns, never in role names.**
- **No hidden authority.** No inheritance, nothing implicit; every grant and every switch is explicit and auditable.
- **Permissions are assigned to roles, never encoded in them.**

## Relation to the literature

This is **Core RBAC's structural half** — who holds which capacity, over what — without its permission matrix, which belongs to the application. It does not compete with role-based access control; it is a component for building it. And it is a **position taken among these papers, not a synthesis of them**. The review's verdict: the literature forces no structural change here — every disagreement is a refusal the literature itself endorses, a deferral with a named landing spot, or a seam the vocabulary already expresses ([literature_review.md](docs/literature_review.md) § *What the review changed*).

The closest references, in order of closeness:

- **Core RBAC.** ANSI/INCITS 359-2004; from Sandhu, Coyne, Feinstein & Youman (1996), *Role-Based Access Control Models* — the RBAC96 family, model RBAC0. Read this first.
- **Team context.** Thomas (1997), *Team-Based Access Control (TMAC)* — the team as the context of a role, beside the role rather than inside its name.
- **Parameterized and contextual roles.** Giuri & Iglio (1997), *Role Templates for Content-Based Access Control* — the closest reference for what a grant is: a role **instantiated over a target**; and Covington, Moyer & Ahamad, *Generalized Role-Based Access Control* — the environment dimension, *where an act happens*.
- **The relationship graph.** Pang et al. (2019), *Zanzibar* — organizations, teams, and cross-organization peers as explicit edges rather than role names.
- **The failure this avoids.** Kuhn, Coyne & Weil (2010), *Adding Attributes to Role-Based Access Control* — context in a role's name multiplies roles until auditing is impossible.
- **The signature rules' nearest relatives.** Rule 7's re-validation is usage control's **ongoing authorization** (UCON); rule 8's cousin is **GEO-RBAC** — which senses the *user's* position where this model anchors the *grant*; and time-bounded hats are **TRBAC** territory, landing — if ever wanted — in the adapter, never the core.

Two Zanzibar relations carry the posture. The two-edge rule — `decide` with `heldAction`, presence ∧ standing — **is** Zanzibar's *intersection* operator: the worn hat reaches *and* a held grant carries. And where Zanzibar trades immediacy for bounded staleness, this model keeps immediacy (a conformance case, not a tuning knob) and answers scale with a request-scoped snapshot (`perRequest`). The practical descendant question — *why not OpenFGA or SpiceDB?* — is answered in [docs/rbac.md](docs/rbac.md) § *The generic-graph question*.

Deliberately outside the model: role hierarchy (RBAC1), declarative separation of duty (RBAC2), and negative grants (no exclusion edge). Role administration is not outside at all: **granting is an action** — a `grant` action whose worn hat reaches the new grant's target, plus the organization check — so ARBAC97 lands as data, not as a new concept (C53). The full comparison — the RBAC mapping, the `can` split, and a reading list — is in [docs/rbac.md](docs/rbac.md); the reference-by-reference review — what each supports here, where each disagrees, and the citation precision a practitioner should verify — is in [docs/literature_review.md](docs/literature_review.md).

## What is here

A TypeScript package, published as `org-hats`:

- **[`src/core.ts`](src/core.ts)** — the pure surface: the entities, `Target`, and the predicates (`can`, `reach`, `heldCarries`, `wornHat`, `wearableAt`, `admitted`, `scopeCovers`, `childPath`, `leafScopeId`, `parentPath`, `organizationsOf`) — optional display names on `HeldHat`, and `HatClaim` (a claim is an id or a matcher). The core names **zero actions** and privileges none. No runtime dependency and no `node:*`, enforced by [`tsconfig.core.json`](tsconfig.core.json).
- **[`src/port.ts`](src/port.ts)** — `OrgHatsRepository`, the one async persistence contract, plus `perRequest` — the request-scoped memo: one consistent read per request, however many decisions it makes.
- **[`src/conformance.ts`](src/conformance.ts)** — the shared `OH-QM-01` … `OH-QM-11` inventory, as data, plus `runConformance` — the harness that runs a host's bodies and diffs the ids against the inventory.
- **[`src/decide.ts`](src/decide.ts)** — the request spine: `decide` composes the port and the predicates in the order the rules require, with the two-edge shape (`heldAction`) folded in. A decision is data — allow, or deny with a reason.
- **[`src/testing.ts`](src/testing.ts)** — `fakeRepository`, an in-memory port for tests: the port is two questions, so a fake is two functions.
- **[`src/node.ts`](src/node.ts)** — the SQLite reference adapter (`org-hats/node`), the only place a driver is spoken to.
- **[`examples/`](examples)** — the walkthroughs: the core, an operations layer that adds cross-organization peers, the reference proof of the eleven conformance cases, and the request spine's every decision shape.

```
org-hats         pure core + the spine + the port    (a Worker never sees node:sqlite)
org-hats/node    SqliteRepository                    (the reference adapter)
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
- **[`docs/literature_review.md`](docs/literature_review.md)** — the references in detail: per-paper consonance and dissonance, the uncited relatives (UCON, GEO-RBAC, TRBAC), and citation notes.
- **[`docs/tutorial.md`](docs/tutorial.md)** — a guided build from one person to a multi-organization operation.
- **[`docs/operations_layer.md`](docs/operations_layer.md)** — how an application maps operations, sites, and cooperation onto the model.
- **[`docs/package.md`](docs/package.md)** — what the package ships and the rules that keep it one.
- **[`docs/writes.md`](docs/writes.md)** — the write side: the transaction rule, the invariants statement by statement, and administration as an action — documentation and reference SQL for a host's own migrations, not port surface.
- **[`docs/publishing.md`](docs/publishing.md)** — where it is published and how it mirrors.
- **[`docs/concerns.md`](docs/concerns.md)** — the tracked review queue.
- **[`plans/publish.md`](plans/publish.md)** — the remaining publishing work.
- **[`plans/reference_impl.md`](plans/reference_impl.md)** — the reference implementation: what shipped in v0.2.0, what remains (write-side statements, D1 adapter), and the positions it takes.

## Status

The model is frozen and exercised in the reference implementation. The permission layer is a seam — one `capability` table and one predicate — and is not yet wired into an application. `v0.2.0`–`v0.2.3` grew the spine, the harness, the consumer-review surface, and `perRequest`; `v0.3.0` made the core name zero actions; **`v0.4.0` is the membership retreat**: membership is the application's policy, not a model concept — `heldCarries` ships as the standing half, `decide` gains `heldAction`/`no-held-action`, and `maySpeak`/`decideSpeak`/`affiliated` are gone. Decided jointly with the consumer. [`docs/concerns.md`](docs/concerns.md) tracks the review queue.

## License

MIT. See [LICENSE](LICENSE).
