# Organization Model

*The full statement: entities, rules, boundaries, the permission seam, data relationships, and complexity bounds.*

The [project README](../README.md) gives the big picture. This is the detail. The model's executable form is the TypeScript module [`src/`](../src) — pure predicates and a schema, with the walkthroughs in [`examples/`](../examples). Where this document and the code disagree, this document is the tiebreaker and the code is wrong. For a guided build of the same ideas, one concept at a time, see [the tutorial](tutorial.md).

## What it is

The model describes an organization as **people holding capacities over groups**, bounded by *who fields a group* and *where it works*. It is deliberately small and repository-independent: it names no application, no action, and no object type. An application supplies its own vocabulary and reads authority from one predicate.

It has two layers:

- **The directory** — entities and relationships: who is who, in what capacity, on what team, in which organization, where.
- **Permissions** — an optional layer that attaches capabilities to roles. Its seam is defined here; its vocabulary belongs to the application.

## Entities

Five entities, in two kinds.

**Core** — the three a person names when describing an organization.

| Entity | Is | Examples |
| --- | --- | --- |
| **Actor** | An identifiable participant. | Alice, Bob |
| **Role** | An opaque capacity. | Coach, Senior Lead Instructor, Supervisor |
| **Team** | A named group, fielded by one organization and working at one scope. | Drive, Logistics |

**Boundaries** — the two coordinates that bound authority. They are entities as well: many teams reference the same one, and it constrains them.

| Entity | Is | Examples |
| --- | --- | --- |
| **Organization** | Who fields a team and whom its actors answer to. | a firm, a contractor, a volunteer body |
| **Scope** | Where authority reaches. Scopes nest. | an operation, a site, a floor |

A **role is opaque**: its identity depends on neither its capabilities nor its scope, so one `Supervisor` role serves every team and site that grants it. This is what prevents role explosion.

## Relationships

Two relationships, both many-to-many.

| Relationship | Between | Meaning |
| --- | --- | --- |
| **Grant** | Actor — Role | This actor may wear this role over a team or a scope. |
| **Capability** | Role — Action | This role may perform this action. The deferred layer; actions are the application's. |

A **grant** supplies the who and the where; the **role** supplies the capability. **Affiliation** is not a third edge: an actor is affiliated with a team by holding a grant over it whose role may author there — the *member grant*. A member is a grant, and supervising a team never makes one a member.

### The hat

A **hat** is the human name for a grant: a role held over a team or a scope. An actor can hold many hats and **wears one at a time**. Holding a hat is holding a grant; wearing it makes that grant active.

- **Primary** — the principal capacity in an organization, one per actor per organization where they hold grants.
- **Default** — the hat worn when none is chosen, so work can begin without a decision. Optional; absent it, the primary is worn.
- **Active** — the hat worn right now, at most one per session.

Primary is identity; default is the landing context and may be less privileged — the chief executive's primary hat is *CEO*, and their default, for least privilege, may be *Janitor*. **A primary role adds no authority while another hat is active.**

## Rules

1. **Grant before activation.** Only a held hat may be worn, and only while its grant is valid.
2. **One active hat.** Switching deactivates the previous one; capabilities never accumulate across hats. In RBAC terms this is dynamic separation of duty with the *universal* conflict set — every pair of held hats conflicts — enforced within one organization (C31).
3. **Affiliation is capability-derived.** An actor is affiliated with a team by holding a grant over it whose role may author there. Switching hats changes no affiliation, and supervising a team never confers it.
4. **Role gives capability; team and scope give reach.** Authorization consults the active grant's role and the target's team or scope. Scope is stated structurally, never in a role's name.
5. **Switching is explicit and auditable.** Record actor, old hat, new hat, and time, with a reason where it matters. Record grants, revocations, and exceptional activations too.
6. **No implicit hierarchy.** A senior role inherits nothing from a junior one. A senior actor holds and wears the junior hat to do junior work.
7. **Activation is re-validated.** The active grant is session state, not a token: every request re-checks it against the grants still held, so revocation takes effect at once.
8. **A hat must cover the scope to be worn there.** A hat is anchored at its team's scope, or at its own scope when it is scope-bound, and it covers that scope and everything nested inside it. *Admission* is any covering hat; the *worn* hat is the wearable default.

## Boundaries

**Organization** bounds authority. One organization fields a team, and every member of a team shares its organization; supervision never crosses organizations. An actor may be affiliated with more than one — a contractor, a volunteer, a board member — and their grants, primary, and default are stated per organization. An organization belongs to one **operation** — the outermost scope — so two operations hosted in one database may each field a team under the same name (a *Facilities* each); names are unique within an operation, never globally. That it belongs to a *root* scope is a **probe** (`organizations_not_at_a_root`), not a constraint: no `CHECK` can say "this id is a root", and a site-scoped organization would quietly let one operation hold two same-named orgs.

The organization is also the **read boundary**: an actor reads the teams of the organizations they are in **through a team** — a team-bound grant. A scope-bound configuring grant names an organization but puts the actor on no team, so it *admits and configures without adding read reach*.

Read reach and affiliation are **different questions with similar names**, and they must not be confused: *read reach* follows any team-bearing grant, while *affiliation* — who may speak for a team — is a grant over that team whose role carries the authoring action. A supervisor holds read reach over an organization's teams while being affiliated with none of them.

**A grant's organization is who employs the holder.** It is independent of whether the grant is aimed at a team or a scope — a scope-bound configuring grant still names an employer — which is why `grant.organization_id` is `NOT NULL`. A grant is never anonymous, even when it reaches a whole site. (A real consumer arrived with grants that had a subject and a scope but no employer; the non-null field is what caught it.)

**Scope** is where authority reaches, and scopes nest: an operation contains sites, a site contains floors. The model privileges no level; *operation*, *region*, and *site* are scope values, and a host names its own. A scope-bound grant reaches the scopes nested inside it — a *spatial* reach, an ancestor check and nothing more — and never makes one role capable of another.

The outermost scope is the boundary the application supplies. Whether that boundary is a tenancy isolation unit is the application's concern, not the model's.

## Permissions

An optional layer, shaped here so it can be added without moving anything beneath it.

- **Capabilities are assigned to roles.** One relationship; the role's identity is untouched.
- **One predicate.**
  `can(activeGrant, action, target) → bool`
  Capability comes from the role, reach from the grant. The model names no action and no target; the application supplies both.
- **It stays cheap.** One active hat means a check is set membership in one role's capabilities, scoped by the target: flat indexed lookups. With no role hierarchy there is no traversal, and *who can do this* is answerable from a row.
- **Constraints are a separate concern.** *One active hat* is dynamic separation of duty at strength one. Declarative forms — two roles that may be held but not worn together, or may not both be held — are deferred, not denied.

### Role explosion

The failure mode this model is built to avoid: context encoded in role names until roles outnumber people. Its cause is putting the *where* or the *whom* into a role's identity. Here, context lives in the team, the organization, and the scope — columns, never names — and permissions attach to stable, opaque roles. `drive-team-handler` and `supervisor-northport` are the failure; `Supervisor` over `Drive` at `Northport` is the model.

## Example

An actor is affiliated with the **Drive** team — the **Coach** grant over it may author — and also holds the **Senior Lead Instructor** role over it.

- Primary: **Senior Lead Instructor**. Default: **Coach**.
- Instructing: the worn hat is **Coach**; supervisory capabilities are not active.
- Supervising: switch to **Senior Lead Instructor**.
- Exceptional Logistics cover: take a time-limited, scoped **Supervisor** grant over **Logistics** and wear it. It makes the actor neither a Logistics member nor an organization-crosser. (Time-limited in the host's grant lifecycle; the model stores no validity interval — D6.)

## Data relationships

A team is fielded by exactly one organization and works at exactly one scope; scopes form a tree, held as a materialized path.

**Identity keys**

- `grant` is identified by `(actor, organization, role, team?, scope?)`, NULL-safe.
- `team` is identified by `(scope, name)`: `drive@north` and `drive@south` are two teams that coexist.
- `organization` is identified by `(scope, name)` within its operation; `actor` names are labels, never keys — two operations may each have a *Avery Quinn*.

**Ids** are opaque and caller-supplied: the model stores them as text and never mints one, so a host passes its own UUIDs or slugs. One contract — a scope id must not contain `/`, because a scope's materialized path joins ids with it.

**Invariants**

- A grant is over a team **xor** a scope.
- At most one **primary** and one **default** per (actor, organization).
- The first grant an actor receives in an organization is its primary — a write check, since SQL cannot require a row to exist.
- Supervision never crosses organizations — a write check **and** a probe, because it spans two tables.

## Efficiency

Let *n* be a table's size and *k* the rows returned. Every question is **one indexed lookup plus the rows it returns** — or a small constant number of them, such as a capability lookup plus a reach check.

| Question | Bound | Index |
| --- | --- | --- |
| an actor's grants | O(log n + k) | `grant_by_actor` |
| the primary grant of (actor, organization) | O(log n) | `grant_one_primary` (partial) |
| the default grant of (actor, organization) | O(log n) | `grant_one_default` (partial) |
| a team's grants — the trust view | O(log n + k) | `grant_by_team` |
| a team's roster (affiliates) | O(log n + m) | `grant_by_team`, filtered by AUTHOR |
| does a role carry an action | O(log c) | `capability_identity` (covering) |
| an organization's teams | O(log t + k) | `team_by_org` (covering) |
| a team's organization | O(log t) | primary key |
| does scope A cover B | O(log s) | two point lookups + **O(1) string prefix** |
| is a hat wearable at a scope | O(log n + k) | `grant_by_actor`, one anchor lookup per hat |
| `can(activeGrant, action, target)` | O(log c + log s) | capability + reach |
| `maySpeak(activeGrant, team, held)` | O(log c + k) | worn reaches, a held grant authors |
| the worn hat | O(log n + k), k ≈ 1 | `grant_by_actor`, filtered |

**The rules that keep those bounds true**

1. **One lookup, no fan-out.** An authorization question never joins across tables; edges are read separately and combined in memory over a handful of rows.
2. **No hierarchy, so no traversal.** Capability is set membership in one role; there is no transitive closure to compute.
3. **Reach is spatial and prefix-based.** Scope containment is a prefix test on a stored path, never a recursive walk at request time. In the site-filtered read the path is *compared*, not index-seeked: `team_by_org` carries the query and `? LIKE s.path || '%'` filters its rows — correct at this fan-out, and the plan to verify.
4. **Context in columns, never in names.** Team, organization, and scope are values on the edge.
5. **Ids are durable; labels are not keys.** Renaming an entity changes a label, never a reference.
6. **Affiliation is read, not stored twice.** It is derived from a team-bound author grant, so a member is one row — no membership/grant pair to keep in step.
7. **Cross-entity invariants are checks *and* probes**, never silent assumptions.
8. **Denormalization pays for an index or it doesn't exist.** `grant.organization_id` duplicates a team-bound grant's team organization to key the two per-organization partial indexes, and the layer's `team_link.scope_id` duplicates the teams' scope to keep cooperation site-local. Both are deliberate; each is kept honest by a write check, never treated as a second source of truth.

The `examples/model.ts` walkthrough checks eight of these bounds against `EXPLAIN QUERY PLAN` and fails if the planner reports a scan. The toy adapter runs one `sqlite3` process per statement, so these bounds describe the schema, not latency.

## Implementation notes

Points of discipline, not of model shape:

1. **`grant.organization_id` must equal the team's organization** for team-bound grants, or the per-organization primary/default indexes silently lie. The write check plus the crossing-organizations probe are the guard.
2. **Activation re-validation is security-critical.** The active grant is session state; re-checking it on every request is what makes revocation immediate.
3. **The scope path is application-maintained.** Moving a scope rewrites its subtree's paths; if scopes move often, the upgrade is a closure table, not a change to the model.
4. **No hierarchy shifts coverage onto temporary grants.** Worth one stress test: a principal who must cover five functions.
5. **Per-organization primary/default is exercised** for an actor spanning two organizations (Ellis Novak, in `examples/operations.ts`).
6. **`grant_by_scope` has no caller.** It is retained deliberately for a scope-side trust view — which grants reach a scope — and is the one index the model keeps without a query: documented, not removed.
7. **Affiliation is capability-derived.** Editing a role's capabilities changes *who is affiliated*, not only what they may do: empty the capability table and the roster empties while the directory still answers. That is the fold's one new coupling, and it is deliberate.
8. **Every unique key survives a multi-operation host.** One database may hold many operations, so uniqueness is keyed on the operation (the root scope) wherever a name is client vocabulary: `organization` is unique per `(scope, name)`, teams per `(scope, name)`, and an actor's *name* is a label with no key at all. `role` and `capability` stay global on purpose — roles are platform vocabulary, seeded, not customer rows. The one rule a constraint cannot carry — that an organization's scope is a *root* — is the probe `organizations_not_at_a_root`.

## In the literature

The permission layer is **Core RBAC** (INCITS 359-2004): users, roles, and permissions, exercised by activating a subset of held roles in a session. Two omissions are deliberate:

- **No role hierarchy.** Inheritance turns a capability check into a traversal and *who could do this* into a graph query.
- **No declarative separation of duty**, beyond the fixed one-active-hat rule.

The organizational layer is what this model adds to RBAC: a **team** is a named affiliation and the unit a grant is scoped to, and **organization** and **scope** bound authority without living in a role's name. Everything kept is the standard mitigation for RBAC's known failure (§ *Role explosion*).

This model is not RBAC and does not try to be: it is the structural core an RBAC application is built on. [rbac.md](rbac.md) states that positioning in full — the closest references, the RBAC mapping, and the `can` split that replaces a role-per-object.

Three signature rules have nearest relatives the reading list carries: rule 7's re-validation is what the usage-control literature calls **ongoing authorization** (UCON); rule 8's wearability is the cousin of **GEO-RBAC's** spatially enabled roles — with the difference that GEO-RBAC senses the *user's* position while a hat's wearability is anchored on the *grant*; and time-bounded hats are **TRBAC's** territory, deferred (D6). The full review — consonance and dissonance, reference by reference — is [literature_review.md](literature_review.md).

## Outside the model

Reporting lines, team hierarchy, titles distinct from roles, multiple concurrent active hats, automatic inheritance, negative grants (there is no exclusion edge), complex policy expressions, declarative separation-of-duty constraints, and full org-chart fidelity. Add one only when a use case requires it. Named container levels (*operation*, *region*, *site*) and multi-tenancy belong to the application, not the model — see [the operations layer](operations_layer.md) for the mapping.

**Design principles:** five entities; two relationships; one active hat; no hidden authority; permissions assigned to roles, never encoded in them.
