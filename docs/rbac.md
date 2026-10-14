# This model and RBAC

*Not RBAC — the structural core an RBAC application is built on.*

## Thesis

This repository defines no permissions over objects. It defines **who** acts (Actor), the **capacities** they hold (Role), the **groups and places** those capacities are bounded by (Team, Organization, Scope), and the **session** in which one capacity is active. That is the structural half of RBAC. The half that names operations and objects belongs to the application. So this is not a rival to RBAC; it is a **compatible core component** for building it.

## The closest references, in order of closeness

- **Core RBAC — INCITS 359-2004 (the NIST standard), from Sandhu, Coyne, Feinstein & Youman (1996), "Role-Based Access Control Models" (the RBAC96 family, model RBAC0).** This is the family the model belongs to: users, roles, permissions, sessions, and the two assignment relations. Read this first; everything below is a variation.
- **Team-Based Access Control — Thomas (1997), "Team-based Access Control (TMAC)".** The closest reference for a **team** as the context of a role, and why context belongs beside the role rather than inside its name.
- **Parameterized / contextual roles — Giuri & Iglio (1997), "Role Templates for Content-Based Access Control"; Covington, Moyer & Ahamad (2001), "Generalized Role-Based Access Control" (GRBAC).** The closest reference for a role **scoped to a subject** — a grant of a role *over* something — which is what this model's grant is.
- **Zanzibar — Pang et al. (2019), "Zanzibar: Google's Consistent, Global Authorization System".** Relationship-based rather than role-based, but the closest industry model for the **directory graph**: organizations, teams, and cross-organization peers as explicit edges rather than role names.
- **Kuhn, Coyne & Weil (2010), "Adding Attributes to Role-Based Access Control".** The clearest statement of the problem this model avoids: context that lives in a role's *name* multiplies roles until auditing is impossible.
- **ARBAC97 — Sandhu, Bhamidipati & Munawer (1999).** Role *administration* (who may grant roles). Explicitly outside this model; the application or a later layer.

The permission layer here is Core RBAC almost exactly. The directory layer is the parameterized-role and relationship-graph literature.

## In RBAC terms

| Core RBAC (INCITS 359-2004) | Here |
| --- | --- |
| User (U) | **Actor** |
| Role (R) | **Role** |
| Operation (Op) | **Action** — the application's vocabulary |
| Object (O) | the object is the application's; the **Target** a check passes is its *reach* — a team or a scope |
| Permission (P ⊆ Ops × Obs) | *split*, see below |
| UA (users → roles) | **Grant** — actor → role over a subject |
| PA (permissions → roles) | **Capability** — role → action (the *operation half* of a permission) |
| Session | the **active grant** (the hat), re-validated each request |
| `session_roles(s)` | **one** active grant **per organization** — dynamic separation of duty at strength 1 |
| Role hierarchy (RH) | omitted, deliberately |
| SSD / DSD constraints | DSD(1) is the one-active-hat rule; declarative forms deferred |

## The one idea an RBAC practitioner needs first

Standard RBAC attaches a **permission** — an *(operation, object)* pair — to a role. This model **splits that pair**:

```
can(activeGrant, action, target)  =  PA(role, action)   ∧   reach(grant, target)
                                      ──────┬──────         ─────────┬─────────
                                    the capability        the object half:
                                    (role → action)       the target must fall
                                                          inside the grant's reach
```

The role side is `capability`. The object side is `reach` — a target is either a **team** (reached exactly) or a **scope** (reached spatially, including everything nested inside it). A permission is therefore not a row; it is the *composition* of a capability and a reach.

This is what lets one `Supervisor` role serve every team and site, instead of a `supervisor-northport` role per object. The role stays opaque; the object is a value the grant reaches.

### Three things to keep straight

- **Target is the object's reach, not the object.** The application holds the object (a report, a resource); what `can` receives is where that object lives — a team or a scope. A permission is `capability(role, action)` composed with `reach(grant, object's reach)`.
- **“Operation” is overloaded.** In this repository an *operation* is a customer and its envelope — the root scope — and never RBAC's operation. RBAC's operation is called an **action** here (`author`, `resolve`, `configure`).
- **The active grant is one per organization, not one per realm.** `worn(actor, organization, scope)` selects the capacity in force; an actor who spans organizations has one active grant in each, and the session's organization is the application's context. (That multi-organization landing is an open decision — see `concerns.md` C31 — and is the one part of the session mapping that is not a clean RBAC0 correspondence.)

## What this adds that Core RBAC does not have

Core RBAC has users, roles, permissions, and sessions — and nothing that says *where* or *for whom* a role applies. Implementations put that context into role names. This model makes it first-class:

- **Team** — a named group, the unit work is scoped to and a grant is aimed at.
- **Organization** — who fields a team; the boundary authority cannot cross.
- **Scope** — a nested place (operation → site → floor); where a grant reaches.
- **Grant subject** — a role is held *over* a team or a scope, not in the abstract.
- **Affiliation** — a **member grant**: a team-bound grant whose role may author there. It is what lets an actor *speak for* a team, and it is not a third edge — supervising never confers it.

These are the "parameterized roles" of Giuri & Iglio and GRBAC, plus the relationship graph of Zanzibar, assembled so that context never becomes part of a role's identity.

## What is not here (and where it goes)

- **Objects and operations** — the application names them. The model's seam is `capability` (role → action) and the target the application passes to `can`.
- **The permission matrix** — the seam is defined and empty; the application fills the `capability` table.
- **Role hierarchy (RBAC1)** — omitted on purpose. Inheritance turns a capability check into a traversal; a senior actor holds the junior hat explicitly instead.
- **Declarative constraints (RBAC2 SSD/DSD)** — only the fixed one-active-hat rule is built; the rest is deferred.
- **Role administration (ARBAC)** — deferred; the application grants and revokes.
- **Sessions and audit** — the application stores them; the model treats the active grant as session state and re-validates it.

## Building a Core RBAC application on it

1. **Enumerate operations.** Each becomes an action string — `author`, `resolve`, `configure`, whatever the application does.
2. **Define roles as capability bundles.** Assign actions to roles (PA). Keep the role opaque: no team, no site, no operation split into its name.
3. **Grant roles to actors over subjects.** Assign a role to an actor over a team or a scope (UA), with at most one primary and one default per organization.
4. **Activate one role per session.** The worn grant is the capacity in force; re-check it against the grants still held on every request.
5. **Check `can(activeGrant, action, target)`.** The role supplies the action; the grant's reach supplies the subject; the application supplies the object.

Everything an RBAC application needs to *decide* is then two indexed lookups, and the model holds no application concept at all.

## Reading

- Ferraiolo & Kuhn, *Role-Based Access Controls* (1992) — the origin.
- Sandhu, Coyne, Feinstein & Youman, *Role-Based Access Control Models* (1996) — RBAC96; this model is RBAC0 plus a directory.
- Ferraiolo, Sandhu, Gavrila, Kuhn & Chandramouli, *Proposed NIST Standard for Role-Based Access Control* (2001) — the standard's model.
- ANSI/INCITS 359-2004, *Role Based Access Control* — the normative reference for Core RBAC.
- Thomas, *Team-based Access Control (TMAC)* (1997) — the team as role context.
- Giuri & Iglio, *Role Templates for Content-Based Access Control* (1997); Covington, Moyer & Ahamad, *Generalized Role-Based Access Control* (2001) — parameterized and contextual roles.
- Kuhn, Coyne & Weil, *Adding Attributes to Role-Based Access Control* (2010) — role explosion and the attribute answer.
- Sandhu, Bhamidipati & Munawer, *The ARBAC97 Model for Role-Based Administration of Roles* (1999) — administration, deferred.
- Pang et al., *Zanzibar* (2019) — the relationship graph.

## One line

**Where RBAC assigns permissions to roles and roles to users, this model assigns roles to actors over teams and scopes, bounds them by organizations, and activates one at a time** — the structural core an RBAC application sits on, with no permission and no object of its own.
