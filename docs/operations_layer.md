# Operations Layer

*How an application maps operations, sites, and multi-organization cooperation onto the [organization model](organization_model.md) — without changing it.*

The organization model is the reusable authority core: actors, roles, teams, organizations, scopes, and the grants among them. It names no operation, no site, no resource. This layer is the application's: it **references** core entities by id and adds the operational things the core deliberately leaves out. Dependencies run one way — the application depends on the core, and the core never learns what an operation, a site, or a report is.

[`examples/operations.ts`](../examples/operations.ts) is this layer as an executable statement, built on the core without changing it.

## The mapping

Operation and site are not new entities. They are **scope values**; organization, team, actor, and the relationships are the core's, used unchanged.

| Operations-layer concept | Core concept |
| --- | --- |
| **Operation** — the customer and its envelope | the **root Scope** |
| **Site** — an administered operational boundary | a **nested Scope** |
| **Organization** — a firm, contractor, or volunteer body operating here | **Organization** (who fields a team) |
| **Team** — a group at a site, fielded by one organization | **Team** |
| Actor, Role, grant, capability | unchanged |

An operation contains sites; a site hosts teams from **several organizations**. Nothing about that is new to the core — a scope hosts many teams, and a team names exactly one organization — but it is what makes multi-organization work ordinary rather than exceptional.

## What the layer owns

- **Operation configuration** — identity provider, policies, jurisdictions, branding. An application entity keyed by the root scope's id.
- **Site records** — the operational boundary as a first-class thing: resources, reports, incidents, attachments. Application data, owned per site, never in the core.
- **Cooperation** — the edges below.

The core stays authority-only. It answers *who may act, as what, over which group, within which organization and scope*; the layer answers *what is here, and who may see it*.

## Cooperation

Organizations that share a site cooperate, and the cooperation is **team to team**, not organization to organization. A cooperation edge is a relation between two teams, carrying the application's policy in its kind:

```
team_link (team_a, team_b, kind, scope)
```

The reference policy has four properties worth keeping as the default:

- **Mutual** — if A cooperates with B, B cooperates with A.
- **Read-only** — the edge grants audience, never capability.
- **Scoped** — cooperation is local to a site.
- **Non-transitive** — A–B and B–C do not make A–C.

Two rules make it safe:

1. **It crosses the organization boundary by definition.** An intra-organization edge is redundant, because the organization read boundary already grants that audience.
2. **It is granted per team, never per organization.** There is no org-wide cooperation grant that would cover teams not yet created — cooperation arrives only by an explicit act, one pair at a time.

Store one row per pair, canonically ordered and uniquely indexed. That unique pair index already answers lookups from the lower endpoint; one more index on the upper endpoint makes a team's peers a single symmetric statement, each side on its own index. The edge also stores the site it is local to (`scope_id`), derived from the teams: the layer's one denormalization, checked when the edge is written.

## Read and act

Two questions, answered separately:

- **Acting follows the worn grant.** Capability comes from the active hat's role, reach from the grant — the core's rules. Cooperation adds nothing here.
- **Reading follows the organization, widened by cooperation.** An actor reads the teams of the organizations they are in through a team — a team-bound grant — at the site, and the peer teams of those teams, supervisors-only. A scope-bound configuring grant adds no read reach. An unreadable item returns *not found*, not *forbidden*, so its existence stays private.

Cooperation widens *audience*, never *authority*. A peer team's supervisor can read; they cannot act on what they read.

## Invariants

- The application references core ids; the core references no application concept.
- Operation and site are scopes: renaming one is a label change, and ids stay durable.
- A team names exactly one organization and exactly one scope.
- Cooperation is mutual, read-only, scoped, non-transitive, cross-organization, and per-team.
- Reading follows the organization; acting follows the worn grant.
- Multi-organization is ordinary: one actor, one login, grants stated per organization.

## Efficiency

The layer adds no traversal. Everything is an indexed lookup plus the rows it returns.

The read is a fixed number of queries plus one peer lookup per supervised team — bounded by how many teams you supervise, never by the size of the data; and a peer set is one hop, never a closure.

| Question | Bound | Index |
| --- | --- | --- |
| a team's cooperation edges | O(log n + k) | `team_link_identity` (a side), `team_link_by_b` |
| are A and B peers | O(log n) | `team_link_identity` (canonical pair) |
| a site's teams | O(log n + k) | `team_by_scope` |
| an organization's teams at a site | O(log n + k) | `team_by_org`, filtered by scope |
| site resources and reports | application-owned | application indexes |

Non-transitivity is what keeps it cheap: a peer set is **one hop**, never a closure. If transitivity is ever wanted, it is a new decision with a new cost, not a property to assume.

## Example

An operation **Riverbend Festival** is the root scope; **Big Park** and **East Stage** are nested sites. At Big Park, the **Council** fields Gate Crew and Stage Ops, **Ampwire Sound** fields Board, and **Long Table** fields Cart — three organizations, one site.

- A Council volunteer reads every Council team at Big Park by default. The organization is the read boundary.
- Stage Ops (Council) and Board (Ampwire) are peers. That edge adds one audience: Stage Ops' managers may read the Board crew's log, and Board's may read Stage Ops' — and nothing more.
- A Council duty manager holds grants over Stage Ops at Big Park and a crew at East Stage, belongs to neither team, and can manage both while speaking for neither. Supervision never crossed an organization to get there.

## What stays out

Organization-wide cooperation grants, cooperation that implies capability, transitive audience, sites as a third kind of containment, and any resource, report, or incident concept. Each is either an application decision or a change to the core — never an assumption smuggled into this layer.

**Design:** operation and site are scopes; organization fields teams; cooperation is a team-level, read-only, non-transitive edge; resources and reports belong to the application.
