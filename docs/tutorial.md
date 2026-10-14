# Tutorial: from one person to an operation

*Build the model up one concept at a time. Each step adds a single idea, shows what it buys, and ends with what it still cannot say — which is the next step.*

The whole model is [`organization_model.md`](organization_model.md); its executable form is the TypeScript module [`src/`](../src) with walkthroughs in [`examples/`](../examples). Nothing here is new. It is the same model, seen in the order you would invent it.

## 1. One person, one capacity, one team

Start with the smallest thing that is still an organization: someone who does a job on a team.

| Actor | Role | Team |
| --- | --- | --- |
| Avery Quinn | Coach | Drive |

That row is a **grant**, and its human name is a **hat**: *Coach, held over Drive*. Three entities appear, and no more:

- **Actor** — Avery, a person.
- **Role** — Coach, a capacity. Deliberately opaque: nothing yet says what a Coach may do.
- **Team** — Drive, a group.

**It buys:** "Avery holds the Coach hat over Drive."

**It cannot say:** what a Coach may *do*. The role named a capacity; no capability is attached. That is step 2.

## 2. What a role may do — capabilities

Attach actions to the role.

| Role | Action |
| --- | --- |
| Coach | `author` |
| Supervisor | `read_reports`, `resolve` |

A **capability** is a role→action edge, and it is the whole of the permission layer. One predicate reads it:

```
can(hat, action, target)  →  the role carries the action  AND  the grant reaches the target
```

The model itself never names an action — `author`, `resolve`, `read_reports` are the application's words. That is deliberate: the model stays reusable, and an application brings its own vocabulary.

**It buys:** "Avery may author for Drive."

**It cannot say:** whether Avery actually *speaks for* Drive, or who else is on it. Holding a hat is a capacity, not a place in the group. That distinction is step 3.

## 3. A team is people — the member grant

A team is not just a name a hat points at; it is a group of people. That fact is a grant too: the **member grant** is a team-bound grant whose role may `author`.

| Actor | Grant | Over |
| --- | --- | --- |
| Avery Quinn | Coach (`author`) | Drive |

**Affiliation is capability-derived**, not a separate edge: an actor is a member of a team when they hold a grant over it whose role may author. The two questions then divide cleanly:

- **Speaking for a team** needs the worn hat to *reach* it and a held author grant over it.
- **Acting on a team's work** (resolving its reports, say) needs only the right grant.

**It buys:** Avery can *speak for* Drive — his Coach grant may author, so it is his membership. "Who is on Drive?" is the roster of author-grant holders.

One coupling to know: because affiliation is derived from capabilities, editing a role's capabilities changes *who is affiliated* — empty the capability table and the roster empties while the directory still answers.

**It cannot say:** what happens when one person holds *two* hats. That is step 4.

## 4. A working lead — two hats over one team

Blake is a working lead: he still instructs, and he also supervises. He holds two hats over the *same* team.

| Hat | Role | Over |
| --- | --- | --- |
| Drive instructor | Coach | Drive |
| Drive lead | Supervisor | Drive |

An actor wears **one hat at a time**. Wearing the Coach hat, Blake can `author` but not `resolve`; wearing the Supervisor hat, he can `resolve` but not `author`. Capabilities never accumulate across hats — switching is a real switch.

Note that the two hats must be able to coexist. A model that allowed only one hat per (actor, team) could not express a lead who must sometimes wear down to an ordinary instructor.

**It buys:** a lead who can cover and can also step down; and an audit trail of which hat each act was done under.

**It cannot say:** anything about a supervisor who is *not on the team*. That is step 5.

## 5. A supervisor who is not a member

Robin supervises Logistics and also covers Drive, and holds no authoring grant over either.

| Hat | Role | Over | Affiliated? |
| --- | --- | --- | --- |
| Logistics lead | Supervisor | Logistics | no |
| Drive cover | Supervisor | Drive | no |

**Supervising a team never makes one a member, and there is no separate membership edge to set.** Affiliation is a held author grant, so Robin — who holds only supervisory, resolving grants — is affiliated with neither team and cannot speak for either, though she can `resolve` both.

This is also why the model refuses a hierarchy: a senior hat gains nothing automatically. Robin's Drive cover is an explicit grant, not an inheritance from her Logistics role.

**It buys:** cross-cover and matrix work without touching who belongs where.

**It cannot say:** *which* hat an actor starts with when they hold several. That is step 6.

## 6. Identity and landing — primary and default

When an actor holds several hats, two of them can be singled out:

- **Primary** — the principal capacity; *who you are*.
- **Default** — the hat worn when none is chosen; *where you land*.

They are usually the same, and they may differ on purpose. A chief executive's primary hat is **CEO**; their default, for least privilege, may be **Janitor** — so the powerful hat is available but not worn by accident.

For Blake: primary is **Supervisor** (he mostly supervises), default is **Coach**. He lands able to write reports and switches up when he needs to resolve.

An actor with one hat sets it as both and never meets the concept. Setting a default is optional: with none, the primary is worn.

**It buys:** least-privilege landing without hiding the principal identity — and without forcing every login to make a choice.

**It cannot say:** *where* any of this happens. Nothing so far has a place. That is step 7.

## 7. Where work happens — scope and organization

Two boundaries appear, one of place and one of people.

- A **team** works at one **scope** (a place), and is fielded by one **organization** (who its people answer to).
- A **scope** nests: an operation contains sites, a site contains floors. The model privileges no level — *operation*, *region*, *site* are just scope values.

Now a site can host teams from several organizations, which is the ordinary multi-contractor reality.

| Site (scope) | Team | Organization |
| --- | --- | --- |
| Northport | Drive | Atlas |
| Northport | Logistics | Atlas |
| Northport | Workshop | Cobalt |

(A third organization, Beacon, joins in the operations-layer example at step 10.)

A grant can now be over a **team** (specific work) or over a **scope** (configuration, no team). And the organization becomes a ceiling: supervision never crosses it.

**It buys:** one place where teams from different organizations all work, each team answerable to exactly one of them.

**It cannot say:** who may *be* at a site at all, versus what they may wear once there. That is step 8.

## 8. Many sites, one operation — admission and wearability

Nest the scopes: **Acme Freight** is the operation; **Northport** and **Southport** are sites inside it.

| Actor | Hat | Over | Admitted at |
| --- | --- | --- | --- |
| Avery Quinn | Coach | Drive (Northport) | Northport only |
| Frankie Cho | Config | Acme Freight (operation) | every site |

A hat is *anchored* at a place — a team's scope, or a scope-bound grant's own scope — and it **covers that place and everything nested inside it**. Two questions fall out:

- **Admission**: may this actor be here at all? Any covering hat admits.
- **Wearability**: which hats may be worn *here*? Those that cover this scope.

Avery's Drive hat is anchored at Northport, so he is admitted there and nowhere else. Frankie holds no team at all; his operation-scoped Config hat admits him at every site and lets him configure all of them — which is exactly what an operation-scoped grant is for.

**It buys:** one login that follows the actor across an operation without leaking reach outside the places they belong.

**It cannot say:** what to do when one person genuinely belongs to two organizations. That is step 9.

## 9. One person, two organizations

People do not always have one affiliation. Ellis volunteers for an Atlas team and a Beacon team.

| Hat | Role | Over | Organization | Primary? |
| --- | --- | --- | --- | --- |
| Drive instructor | Coach | Drive | Atlas | ● |
| Facilities helper | Coach | Facilities | Beacon | ● |

One actor, one login, and a **primary per organization** — her principal capacity at Atlas differs from her principal capacity at Beacon, and neither leaks into the other. Grants are stated per organization, and supervision still never crosses a boundary.

**It buys:** contractors, volunteers, and board members who serve more than one body, without two logins and without authority bleeding between them.

**It cannot say:** how two organizations' teams, sharing a site, are allowed to *see each other's work*. That is step 10.

## 10. Organizations that cooperate at a site

At a site, organizations cooperate — usually **team to team**. This is the [operations layer](operations_layer.md); the core does not change. The layer adds one edge:

```
team_link (team_a, team_b, kind, scope)
```

with a default policy: **mutual**, **read-only**, **site-local**, **non-transitive**, and always across organizations.

| Link | Between | At |
| --- | --- | --- |
| peer | Drive (Atlas) ↔ Facilities (Beacon) | Northport |

Two questions, answered separately:

- **Acting** still follows the worn grant. Cooperation adds nothing to it.
- **Reading** follows the organization, widened by cooperation: an actor reads the teams of their own organization at the site, **plus the peer teams of teams they supervise** — and peers are supervisors-only.

So at Northport:

| Reader | Reads |
| --- | --- |
| Avery (Atlas member) | Drive, Logistics — no Beacon team |
| Blake (supervises Drive) | Drive, Logistics, **Facilities** — his peer |
| Casey (supervises Facilities) | Facilities, **Drive** |

And cooperation is **non-transitive**: Blake reads Facilities (Drive's peer) but *not* Workshop (Facilities' peer). A peer set is one hop, never a closure. It widens **audience, never authority** — Blake may read a Facilities report, but he cannot resolve one.

**It buys:** cross-organization visibility that is explicit, minimal, and one hop wide — the common case of teams from different companies covering the same site.

## 11. Wearing one at a time — and revocation

Two rules close the loop:

- **One active hat.** The worn hat is the capacity in force; nothing accumulates.
- **The worn hat is re-validated every request.** It is a selection, not a token: if the grant behind it is revoked, it is no longer held, so it can no longer be worn. Revocation takes effect at once.

Switching hats, granting, and revoking are all explicit and auditable — actor, old hat, new hat, time, and reason where it matters.

## Where to go next

- **Read the model**: [`organization_model.md`](organization_model.md) — eight rules, the boundaries, the permission seam, and the efficiency bounds.
- **Run it**: `bin/check` runs the examples and asserts every rule above. `examples/model.ts` is steps 1–8; `examples/operations.ts` is steps 9–10.
- **Extend it**: [`operations_layer.md`](operations_layer.md) shows how an application adds its own concepts without touching the core; [`concerns.md`](concerns.md) records what was decided and what is deferred.

The through-line, in one sentence: **people hold capacities over groups, bounded by who fields them and where they work; one hat is worn at a time; and permissions are assigned to roles, never encoded in them.**
