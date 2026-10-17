# This model and RBAC

*Not RBAC — the structural core an RBAC application is built on.*

## Thesis

This repository defines no permissions over objects. It defines **who** acts (Actor), the **capacities** they hold (Role), the **groups and places** those capacities are bounded by (Team, Organization, Scope), and the **session** in which one capacity is active. That is the structural half of RBAC. The half that names operations and objects belongs to the application. So this is not a rival to RBAC; it is a **compatible core component** for building it.

## The closest references, in order of closeness

- **Core RBAC — Sandhu, Coyne, Feinstein & Youman, *Role-Based Access Control Models* (IEEE Computer 29(2), 1996; the RBAC96 family, model RBAC0), canonized as ANSI/INCITS 359-2004.** This is the family the model belongs to: users, roles, permissions, sessions, and the two assignment relations. Read this first; everything below is a variation.
- **Team-Based Access Control — Thomas, *TMAC* (2nd ACM RBAC Workshop, 1997; journal version ACM TISSEC 2(1), 1999).** The closest reference for a **team** as the context of a role, and why context belongs beside the role rather than inside its name. TMAC's team is an ad-hoc collaboration; this model's is standing and organization-fielded — the citation is for the context, not the lifecycle.
- **Parameterized roles — Giuri & Iglio, *Role Templates for Content-Based Access Control* (1997).** The closest reference for what a grant *is*: a role **instantiated over a target** — the generic role stays, the binding carries the context. Their templates carry content *predicates* evaluated at access time; this model keeps the instantiation and deletes the predicate language.
- **Contextual roles — Covington, Moyer & Ahamad, *Generalized Role-Based Access Control* (GRBAC).** The precedent for an **environment** dimension in authorization — the idea that *where an act happens* participates in the decision. Their environment roles are *evaluated* (time of day, sensed place); a scope here is a static anchor on the grant. (Exact venue unverified — see [literature_review.md](literature_review.md).)
- **Zanzibar — Pang et al. (USENIX ATC, 2019).** Relationship-based rather than role-based, but the closest industry model for the **directory graph**: organizations, teams, and cross-organization peers as explicit edges rather than role names. Two sharp divergences — staleness and negation — are detailed in [literature_review.md](literature_review.md).
- **Kuhn, Coyne & Weil, *Adding Attributes to Role-Based Access Control* (IEEE Computer 43(6), 2010).** The clearest statement of the problem this model avoids: context that lives in a role's *name* multiplies roles until auditing is impossible. Same diagnosis, different cure: they generalize the condition algebra (the ABAC direction); this model deletes it — context is structural, never a predicate.
- **ARBAC97 — Sandhu, Bhamidipati & Munawer (ACM TISSEC 2(1), 1999).** Role *administration* (who may grant roles). Explicitly outside this model; the application or a later layer — though the organization boundary and scope coverage already carry the geometry ARBAC97 used for its administrative ranges. And the model can say *who may grant* with the vocabulary it already has: an action (`grant`) whose worn hat reaches the new grant's target, plus the organization write-check. Administration lands as data, not as a new concept.

The permission layer here is Core RBAC almost exactly. The directory layer is the parameterized-role and relationship-graph literature.

## In RBAC terms

| Core RBAC (INCITS 359-2004) | Here |
| --- | --- |
| User (U) | **Actor** |
| Role (R) | **Role** |
| Operation (Op) | **Action** — the application's vocabulary |
| Object (O) | the object is the application's; the **Target** a check passes is its *reach* — a team or a scope |
| Permission (P ⊆ Ops × Obs) | *split*, see below |
| UA (users → roles) | **Grant** — actor → role over a target |
| PA (permissions → roles) | **Capability** — role → action (the *operation half* of a permission) |
| Session | the **active grant** (the hat), re-validated each request |
| `session_roles(s)` | **one** active grant **per organization** — DSD with the *universal* conflict set: every pair of held hats conflicts |
| Role hierarchy (RH) | omitted, deliberately |
| SSD / DSD constraints | the one-active-hat rule is DSD at its strongest — the universal conflict set, per organization; declarative forms deferred (D2) |

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

This is what lets one `Stage Manager` role serve every team and site, instead of a `stage-manager-bigpark` role per object. The role stays opaque; the object is a value the grant reaches.

### Four things to keep straight

- **Target is the object's reach, not the object.** The application holds the object (a report, a resource); what `can` receives is where that object lives — a team or a scope. A permission is `capability(role, action)` composed with `reach(grant, object's reach)`.
- **“Operation” is overloaded.** In this repository an *operation* is a customer and its envelope — the root scope — and never RBAC's operation. RBAC's operation is called an **action** here (`author`, `resolve`, `configure`).
- **The active grant is one per organization, not one per realm.** `wornHat` over the request's organization selects the capacity in force; an actor who spans organizations has one active grant in each, and the session's organization is the application's context. (That multi-organization landing is the one part of the session mapping that is not a clean RBAC0 correspondence; the host settles it
- **“Subject” means the accessor in the wider literature.** This repository says **target** for what a grant aims at — the `Target` type — and reserves *actor* for the one who acts. A grant is *over* a target; it is never “scoped to a subject.”
- **Enumeration is the port's; decision is the spine's.** RBAC96 answers “what can this user do?” with the union of the activated roles' permissions; here that question is **enumeration** — `hatsOf` then `wearableAt`, names included — and the spine answers **one act at a time**. `/api/me` and dashboards are port questions; accumulation across hats is what the one-hat rule exists to prevent.

## What this adds that Core RBAC does not have

Core RBAC has users, roles, permissions, and sessions — and nothing that says *where* or *for whom* a role applies. Implementations put that context into role names. This model makes it first-class:

- **Team** — a named group, the unit work is scoped to and a grant is aimed at.
- **Organization** — who fields a team; the boundary authority cannot cross.
- **Scope** — a nested place (operation → site → floor); where a grant reaches.
- **Grant target** — a role is held *over* a team or a scope, not in the abstract.
- **Membership** — not modeled. The application derives its roster from grants; the common derivation (an action-carried grant) is `heldCarries`. In RBAC terms, nothing beyond UA parameterized by target — the meaning of "member" is application policy.

These are the "parameterized roles" of Giuri & Iglio and GRBAC, plus the relationship graph of Zanzibar, assembled so that context never becomes part of a role's identity.

## What is not here (and where it goes)

- **Objects and operations** — the application names them. The model's seam is `capability` (role → action) and the target the application passes to `can`.
- **The permission matrix** — the seam is defined and empty; the application fills the `capability` table.
- **Role hierarchy (RBAC1)** — omitted on purpose. Inheritance turns a capability check into a traversal; a senior actor holds the junior hat explicitly instead.
- **Declarative constraints (RBAC2 SSD/DSD)** — only the fixed one-active-hat rule is built; the rest is deferred.
- **Role administration (ARBAC)** — deferred; the application grants and revokes.
- **Negative grants** — there is no exclusion operator: “everyone at this scope *except* that actor” is inexpressible as an edge. A restructure or an app-side denial — never a negation in the graph (D8).
- **Sessions and audit** — the application stores them; the model treats the active grant as session state and re-validates it.

## The generic-graph question

The practical alternative today is not another RBAC paper but a Zanzibar descendant — OpenFGA, SpiceDB. Why not just that? Because the differentiators here are exactly what a generic substrate does not give by default:

- a **fixed schema** — five entities, reviewable in an afternoon, not a bespoke tuple topology per application;
- **one active hat** — DSD as a session property, not a convention;
- **immediate revocation** — rule 7, conformance-proved (OH-QM-03, OH-QM-04), not bounded staleness;
- a **legible audit snapshot** — the hat recorded on the act (OH-QM-05), not a point-in-time reconstruction.

And the one place this model already speaks Zanzibar's language: the two-edge rule — `decide` with `heldAction`, `reach(worn) ∧ heldCarries(held, ·, action)` — is an **intersection**: the worn hat reaches the target *and* a held grant over it carries the action, exactly Zanzibar's `editor ∩ viewer` pattern.

## Building a Core RBAC application on it

1. **Enumerate operations.** Each becomes an action string — `author`, `resolve`, `configure`, whatever the application does.
2. **Define roles as capability bundles.** Assign actions to roles (PA). Keep the role opaque: no team, no site, no operation split into its name.
3. **Grant roles to actors over targets.** Assign a role to an actor over a team or a scope (UA), with at most one primary and one default per organization.
4. **Activate one role per session.** The worn grant is the capacity in force; re-check it against the grants still held on every request.
5. **Check `can(activeGrant, action, target)`.** The role supplies the action; the grant's reach supplies the target; the application supplies the object.

Everything an RBAC application needs to *decide* is then two indexed lookups, and the model holds no application concept at all.

## Reading

- Ferraiolo & Kuhn, *Role-Based Access Controls* (15th NCSC, 1992) — the origin.
- Sandhu, Coyne, Feinstein & Youman, *Role-Based Access Control Models* (IEEE Computer 29(2), 1996) — RBAC96; this model is RBAC0 plus a directory.
- Ferraiolo, Sandhu, Gavrila, Kuhn & Chandramouli, *Proposed NIST Standard for Role-Based Access Control* (ACM TISSEC 4(3), 2001) — the standard's model.
- ANSI/INCITS 359-2004, *Role Based Access Control* — the normative reference for Core RBAC.
- Thomas, *Team-Based Access Control (TMAC)* (ACM RBAC Workshop, 1997; TISSEC 2(1), 1999) — the team as role context.
- Giuri & Iglio, *Role Templates for Content-Based Access Control* (1997) — a role instantiated over parameters; the grant's ancestor.
- Covington, Moyer & Ahamad, *Generalized Role-Based Access Control* — the environment dimension (venue unverified; see [literature_review.md](literature_review.md)).
- Park & Sandhu, *The UCON_ABC Usage Control Model* (ACM TISSEC 7(1), 2004) — the literature name for rule 7: *ongoing authorization*.
- Damiani, Bertino, Catania & Perlasca, *GEO-RBAC* (SACMAT 2005; ACM TISSEC, 2007) — spatially enabled roles; rule 8's nearest relative.
- Bertino, Bonatti & Ferrari, *TRBAC* (ACM TISSEC 4(3), 2001) — temporal enabling; where time-bounded hats would go (D6).
- Kuhn, Coyne & Weil, *Adding Attributes to Role-Based Access Control* (IEEE Computer 43(6), 2010) — role explosion and the attribute answer.
- Sandhu, Bhamidipati & Munawer, *The ARBAC97 Model* (ACM TISSEC 2(1), 1999) — administration, deferred.
- Pang et al., *Zanzibar* (USENIX ATC, 2019) — the relationship graph.
- OASIS XACML 3.0 (2013); NIST SP 800-162 (2014) — vocabulary for the permission seam: the capability table is a PAP, `can` a PDP call, the application the PEP.

The full review — what each reference supports here, and where each disagrees — is [literature_review.md](literature_review.md).

## One line

**Where RBAC assigns permissions to roles and roles to users, this model assigns roles to actors over teams and scopes, bounds them by organizations, and activates one at a time** — the structural core an RBAC application sits on, with no permission and no object of its own.
