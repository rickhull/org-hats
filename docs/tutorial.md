# Tutorial: from one person to a festival

*Build the model up one concept at a time. Each step adds a single idea, shows what it buys, and ends with what it still cannot say — which is the next step.*

The running example is a festival: a non-profit arts council runs a weekend in a big park, with side stages and a food row in reach, and subcontractors — audio, food, security — working beside it. The application is the festival's **dispatch board**, the shift channel where crews talk: to be on a crew is to be able to *send* as it. Keep that one act in mind and every rule lands.

The whole model is [`organization_model.md`](organization_model.md); its executable form is the TypeScript module [`src/`](../src) with walkthroughs in [`examples/`](../examples). Nothing here is new. It is the same model, seen in the order you would invent it.

## 1. One person, one capacity, one team

Start with the smallest thing that is still an organization: someone who does a job on a crew.

| Actor | Role | Team |
| --- | --- | --- |
| Avery Quinn | Volunteer | Gate Crew |

That row is a **grant**, and its human name is a **hat**: *Volunteer, held over Gate Crew*. Three entities appear, and no more:

- **Actor** — Avery, a person.
- **Role** — Volunteer, a capacity. Deliberately opaque: nothing yet says what a Volunteer may do.
- **Team** — Gate Crew, a group.

**It buys:** "Avery holds the Volunteer hat over Gate Crew."

**It cannot say:** what a Volunteer may *do*. The role named a capacity; no capability is attached. That is step 2.

## 2. What a role may do — capabilities

Attach actions to the role.

| Role | Action |
| --- | --- |
| Volunteer | `send` |
| Stage Manager | `read_log`, `resolve` |

A **capability** is a role→action edge, and it is the whole of the permission layer. One predicate reads it:

```
can(hat, action, target)  →  the role carries the action  AND  the grant reaches the target
```

The model names no action at all — `send`, `read_log`, `resolve` are the dispatch board's words, and another application brings its own. That is deliberate: the model stays reusable, and its vocabulary stays yours.

**It buys:** "Avery may `send` for Gate Crew."

**It cannot say:** whether Avery actually *speaks for* Gate Crew, or who else is on it. Holding a hat is a capacity, not a place in the group. That distinction is step 3.

## 3. A team is people — the member grant

A team is not just a name a hat points at; it is a group of people. Speaking on behalf of a team is inherent to teams — a team is exactly the kind of group that acts through its members — so the member's act on the dispatch board is the one that matters: a **member is one who may `send` as the crew**.

| Actor | Grant | Over |
| --- | --- | --- |
| Avery Quinn | Volunteer (`send`) | Gate Crew |

**Affiliation is capability-derived**, not a separate edge: an actor is a member of a team when they hold a grant over it whose role carries the speech act — here, `send`. The two questions then divide cleanly:

- **Speaking for a team** needs the worn hat to *reach* it and a held grant over it that speaks.
- **Acting on a team's work** (resolving its log entries, say) needs only the right grant.

**It buys:** Avery can speak *as* Gate Crew — his Volunteer grant may `send`, so it is his membership. "Who is on Gate Crew?" is the roster of send-grant holders.

One coupling to know: because affiliation is derived from capabilities, editing a role's capabilities changes *who is affiliated* — empty the capability table and the roster empties while the directory still answers.

**It cannot say:** what happens when one person holds *two* hats. That is step 4.

## 4. A working lead — two hats over one team

Blake is a working lead: he still crews, and he also manages. He holds two hats over the *same* team.

| Hat | Role | Over |
| --- | --- | --- |
| Stage Ops crew | Volunteer | Stage Ops |
| Stage Ops manager | Stage Manager | Stage Ops |

An actor wears **one hat at a time**. Wearing the Volunteer hat, Blake can `send` but not `resolve`; wearing the Stage Manager hat, he can `resolve` but not `send`. Capabilities never accumulate across hats — switching is a real switch.

Note that the two hats must be able to coexist. A model that allowed only one hat per (actor, team) could not express a manager who must sometimes wear down to an ordinary crew member.

Note also what *doesn't* change: Blake speaks for Stage Ops in either hat, because speaking rides on the **held** grant, not the worn one.

**It buys:** a lead who can manage and can also step down; and an audit trail of which hat each act was done under.

**It cannot say:** anything about a manager who is *not on the team*. That is step 5.

## 5. A manager who is not a member

Robin manages the Info Booth and also covers Stage Ops, and holds no send grant over either.

| Hat | Role | Over | Affiliated? |
| --- | --- | --- | --- |
| Booth manager | Stage Manager | Booth | no |
| Stage Ops cover | Stage Manager | Stage Ops | no |

**Managing a team never makes one a member, and there is no separate membership edge to set.** Affiliation is a held send grant, so Robin — who holds only managing grants — is affiliated with neither team and cannot speak for either, though she can `resolve` both.

This is also why the model refuses a hierarchy: a senior hat gains nothing automatically. Robin's Stage Ops cover is an explicit grant, not an inheritance from her Booth role.

**It buys:** cross-cover and matrix work without touching who belongs where.

**It cannot say:** *which* hat an actor starts with when they hold several. That is step 6.

## 6. Identity and landing — primary and default

When an actor holds several hats, two of them can be singled out:

- **Primary** — the principal capacity; *who you are*.
- **Default** — the hat worn when none is chosen; *where you land*.

They are usually the same, and they may differ on purpose. A festival director's primary hat is **Festival Director**; their default, for least privilege, may be **Volunteer** — so the powerful hat is available but not worn by accident.

For Blake: primary is **Stage Manager** (he mostly manages), default is **Volunteer**. He lands able to send on the board and switches up when he needs to resolve.

An actor with one hat sets it as both and never meets the concept. Setting a default is optional: with none, the primary is worn.

**It buys:** least-privilege landing without hiding the principal identity — and without forcing every login to make a choice.

**It cannot say:** *where* any of this happens. Nothing so far has a place. That is step 7.

## 7. Where work happens — scope and organization

Two boundaries appear, one of place and one of people.

- A **team** works at one **scope** (a place), and is fielded by one **organization** (who its people answer to).
- A **scope** nests: a festival contains sites, a site contains stages. The model privileges no level — *festival*, *site*, *stage* are just scope values.

Now one site can host teams from several organizations, which is the ordinary multi-contractor reality of a festival.

| Site (scope) | Team | Organization |
| --- | --- | --- |
| Big Park | Gate Crew | Riverbend Arts Council |
| Big Park | Stage Ops | Riverbend Arts Council |
| Big Park | Board | Ampwire Sound |

(A third organization, Long Table, joins in the operations-layer example at step 10.)

A grant can now be over a **team** (specific work) or over a **scope** (configuration, no team). And the organization becomes a ceiling: supervision never crosses it.

**It buys:** one place where the Council's crews and the audio contractor's team all work, each answerable to exactly one of them.

**It cannot say:** who may *be* at a site at all, versus what they may wear once there. That is step 8.

## 8. Many sites, one operation — admission and wearability

Nest the scopes: **Riverbend Festival** is the operation; **Big Park** (with the **Main Stage** nested inside it) and **East Stage** are sites within the half mile.

| Actor | Hat | Over | Admitted at |
| --- | --- | --- | --- |
| Avery Quinn | Volunteer | Gate Crew (Big Park) | Big Park only |
| Frankie Cho | Ops Director | Riverbend Festival (operation) | every site |

A hat is *anchored* at a place — a team's scope, or a scope-bound grant's own scope — and it **covers that place and everything nested inside it**. Two questions fall out:

- **Admission**: may this actor be here at all? Any covering hat admits.
- **Wearability**: which hats may be worn *here*? Those that cover this scope.

Avery's Gate Crew hat is anchored at Big Park, so he is admitted there and nowhere else — and it is wearable at the Main Stage, because Big Park covers it. Frankie holds no team at all; his festival-scoped Ops Director hat admits him at every site and lets him configure all of them — which is exactly what an operation-scoped grant is for.

**It buys:** one wristband that follows the actor across a festival without leaking reach outside the places they belong.

**It cannot say:** what to do when one person genuinely belongs to two organizations. That is step 9.

## 9. One person, two organizations

People do not always have one affiliation. Ellis volunteers for the Council and runs a cart for the food vendor.

| Hat | Role | Over | Organization | Primary? |
| --- | --- | --- | --- | --- |
| Gate volunteer | Volunteer | Gate Crew | Riverbend Arts Council | ● |
| Cart concessionaire | Concessionaire | Cart | Long Table | ● |

One actor, one login, and a **primary per organization** — their principal capacity at the Council differs from their principal capacity at Long Table, and neither leaks into the other. Grants are stated per organization, and supervision still never crosses a boundary.

**It buys:** volunteers who also vend, contractors who also perform, board members who also crew — without two logins and without authority bleeding between them.

**It cannot say:** how two organizations' teams, sharing a site, are allowed to *see each other's work*. That is step 10.

## 10. Organizations that cooperate at a site

At a site, organizations cooperate — usually **team to team**. This is the [operations layer](operations_layer.md); the core does not change. The layer adds one edge:

```
team_link (team_a, team_b, kind, scope)
```

with a default policy: **mutual**, **read-only**, **site-local**, **non-transitive**, and always across organizations.

| Link | Between | At |
| --- | --- | --- |
| peer | Stage Ops (Council) ↔ Board (Ampwire) | Big Park |

Two questions, answered separately:

- **Acting** still follows the worn grant. Cooperation adds nothing to it.
- **Reading** follows the organization, widened by cooperation: an actor reads the teams of their own organization at the site, **plus the peer teams of teams they manage** — and peers are managers-only.

So at Big Park:

| Reader | Reads |
| --- | --- |
| Avery (Council member) | Gate Crew, Stage Ops — no Ampwire team |
| Blake (manages Stage Ops) | Gate Crew, Stage Ops, **Board** — its peer |
| Casey (manages Board) | Board, **Stage Ops** |

And cooperation is **non-transitive**: Blake reads Board (Stage Ops' peer) but *not* Cart (Board's peer beyond it). A peer set is one hop, never a closure. It widens **audience, never authority** — Blake may read the audio crew's board, but he cannot resolve one of its entries.

**It buys:** cross-organization visibility that is explicit, minimal, and one hop wide — the common case of a promoter's crews and a contractor's teams covering the same stage.

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
