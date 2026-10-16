# Literature review

*What each reference supports here, where it disagrees, and what a well-read practitioner should verify before citing. [rbac.md](rbac.md) states the positioning; this file carries the evidence.*

## How to read this

One section per reference, three questions each: **what it says**, **what it supports here** (mapped to named entities, rules, predicates, conformance cases, and concern ids), and **where it disagrees**. This model is not a synthesis of these papers; it is a **position taken among them**. Consonances mark proven ground; dissonances are the model's own claims, stated as claims — each one is load-bearing somewhere in `src/` or in the docs. Venue details that could not be verified from this shelf are flagged in [§ Citation precision](#citation-precision) rather than asserted.

## Core RBAC — Sandhu, Coyne, Feinstein & Youman (1996); ANSI/INCITS 359-2004

**What it says.** RBAC0: users, roles, permissions, sessions, joined by two assignment relations — users to roles (UA), permissions to roles (PA). A session activates a *subset* of the user's roles; the session's permissions are the union over the activated set. RBAC96 adds role hierarchy (RBAC1), constraints (RBAC2), and both (RBAC3); ANSI canonized the family, with Core RBAC ≈ RBAC0 plus review functions.

**Supports here.**

- **Grant = UA, parameterized.** The `grant` table is user-assignment with target columns; `grant_identity (actor, organization, role, team?, scope?)` is UA made unique per binding.
- **Capability = PA, halved.** The `capability` table is permission-assignment restricted to the operation half; the object half is composed at check time as `reach` — the `can` split, which is the repo's central move.
- **Session = worn hat.** RBAC96's session maps to `wornHat`, and the docs' own table says so.
- **Exceeds the standard, twice.** (a) ANSI Core is silent on when a live session reflects a revocation; rule 7 makes immediacy a *conformance requirement* (OH-QM-03, OH-QM-04). (b) `wornHat`'s resolution order — claimed, then default, then primary, then first — has no standard analog; it is a least-privilege *landing rule* (the festival director whose default is *Volunteer*).
- **Review functions, half-answered by design.** "Review the permissions of a role" becomes "review the actions of a role" (one covering index). "Review the objects a role reaches" has no answer — objects are the application's. That is the structural-half position, stated as an ANSI delta rather than an accident.

**Where it disagrees.**

- **The session is per organization, not per realm.** An actor spanning organizations has an active hat in each; DSD holds only *within* one organization, and a request must carry the organization context or the guarantee is vacuous. This is C31/C34 — the one unclean part of the RBAC0 correspondence, and genuinely novel rather than borrowed: the literature has no precedent for an org-partitioned session. Claim it; do not apologize for it.
- **One hat, not a subset.** ANSI's DSD is a *declared* set of conflicting role pairs; this model hard-codes the **universal conflict set** — every pair of held hats conflicts. That is the strongest SoD stance available, and it is a policy choice dressed as a session model. It should be named as such (it now is, in rule 2).
- **Hierarchy as the flatness tool.** RBAC96 treats inheritance (RBAC1) as *the* way to keep roles few; this model gets flat roles structurally — parameters and edges instead of inheritance. The position in one sentence: RBAC96 scales by inheritance, Giuri–Iglió by parameters, Zanzibar by edges; this model scales by parameters + edges and refuses inheritance (D1).

## Team-Based Access Control — Thomas (2nd ACM RBAC Workshop, 1997; journal ACM TISSEC 2(1), 1999)

**What it says.** In collaborative settings, access rights depend on the role *and the team*: a team is a grouping of users, and roles are activated in a team's context. The role is beside the team, not named after it.

**Supports here.**

- **Role-in-team-context is TMAC's primitive**, nearly verbatim: a grant row is TMAC's user–role–team triple, with a scope variant added. OH-QM-02 (the same-named team at another site is not reached) is exactly the collaboration problem TMAC was written for.
- **Roster-as-derived is TMAC's fold too**: being on a team *is* holding a team-scoped grant, not a separate membership record — now the application's policy (`heldCarries`), which is where a fold this good belongs.

**Where it disagrees.**

- **TMAC's team is an ad-hoc collaboration** — users gathered for a task; this model's team is a standing, organization-fielded, site-anchored entity. TMAC has no organization boundary and no spatial nesting: `organizationsOf`, the read rule, and the cooperation edges have no TMAC analog. Cite it for the context idea, never for the lifecycle.
- **TMAC activates the team context as a whole** — plural roles within; this model activates exactly one hat. Same direction, different strength.

## Role templates — Giuri & Iglio (2nd ACM RBAC Workshop, 1997)

**What it says.** Roles can be *templates* with formal parameters: the generic role stays generic, and an instantiation binds actual values. Their parameters carry content conditions — predicates over object attributes evaluated at access time (hence *content-based* access control).

**Supports here — more than the previous docs admitted.**

- **The grant *is* a template instantiation.** A role stays generic; the binding carries the context. "One `Supervisor` role serves every team and site" is the templates argument exactly, and `grant_identity` is instantiation-with-identity.
- This is the **closest reference for what a grant is** — a role instantiated over a target. (The earlier phrasing, "a role scoped to a subject," mis-attached this claim to GRBAC and used *subject* in the literature's opposite sense; both are corrected in [rbac.md](rbac.md).)

**Where it disagrees.**

- Their parameters carry **predicates**; this model's binding is **structural identity** — a team id, a scope path, an O(1) prefix test. This is templates *with the condition language deleted*, which is precisely what keeps the efficiency table honest. The deletion is a feature; name it when citing.
- In Giuri–Iglió, permissions live **in** the template; here capabilities are app-owned rows. Even the parameterized half is externalized.

## GRBAC — Covington, Moyer & Ahamad (venue unverified)

**What it says.** Generalizes roles by type — subject roles, object roles, **environment roles** — so that access rules conjoin all three: who, over what, *under what conditions* (time of day, location). Environment roles are evaluated at access time, not assigned to users.

**Supports here.**

- **The environment dimension is GRBAC's precedent** for rule 8: `wearableAt` and `admitted` are environment-conditioned activation, and `can = capability ∧ reach` is GRBAC's conjunctive rule shape with two conjuncts.

**Where it disagrees.**

- **Evaluated versus anchored.** GRBAC's environment roles are *sensed* at access time; a scope here is a **static anchor stamped on the grant**. Wearability is a property of the authority, never of the weather. This is the auditable/deployable choice — and it means "wearable only 9–5" or "only when physically at Big Park" is inexpressible here. That is GRBAC (and TRBAC) territory, deliberately deferred (D6) — and the deferral is free: if validity intervals ever arrive, they land **in the adapter**, as read-side filtering in `hatsOf` (which already means "the grants still held" — and *still* can include *not yet expired*). The core never learns time exists.
- GRBAC also role-izes **objects** (object roles); this model's `Target` is a structural value — closer to Giuri–Iglió parameters than to anything in GRBAC.
- **Citation caution:** the canonical GRBAC papers are the NISSC/NCSC-era conference versions (late 1990s–2000). The "2001" this repository previously carried could not be matched to a venue from this shelf — verify before citing (see [§ Citation precision](#citation-precision)).

## Zanzibar — Pang et al. (USENIX ATC, 2019)

**What it says.** Authorization as a store of **relation tuples** with userset rewrite rules, evaluated per check, with union, intersection, and **exclusion** operators — and, centrally, a *consistency* story: zookies and snapshot reads that bound staleness so a global system can cache.

**Supports here — including one consonance the docs missed.**

- **Grants are relation tuples; peers are tuples without rewrites.** The four properties of the cooperation edge — mutual, read-only, scoped, non-transitive (OH-QM-09) — are exactly what falls out of *refusing* userset rewrites and transitive closure. Zanzibar users must impose that discipline by convention; this model bakes it in. That is a real differentiator.
- **The two-edge rule is Zanzibar's intersection operator.** `reach(worn) ∧ heldCarries(held, ·, action)` — the worn hat reaches the target *and* some held grant over it carries the action — is literally an intersection of two userset computations, Zanzibar's `editor ∩ viewer` pattern. The strongest structural rhyme in the codebase.
- **The trust view is Expand in miniature.** `grant_by_team` and the derived roster are Zanzibar's reverse query, answered from one index instead of a tree walk — because non-transitivity means there is never a tree to walk.
- **OH-QM-05 answers the zookie's concern** — *what was true at decision time* — by storing the resolved, legible hat on the act rather than by point-in-time reads. Same accountability goal, opposite mechanism.

**Where it disagrees.**

- **Staleness posture — the sharpest dissonance in this whole file.** Zanzibar's central trade is bounded staleness to buy global scale; rule 7 + OH-QM-04 mandate **immediate** revocation. Under Zanzibar's default semantics, OH-QM-04 *fails*. These are opposite answers to the same question, both defensible — but this model had **no cost story**: immediacy is bought with a `hatsOf` query on every request, and nowhere stated at what rate that hurts or where a cache could live without violating conformance. Now the cost posture is stated, and the answer is shaped like Zanzibar's own: a **request-scoped snapshot** — memoize `hatsOf` for one request (consistency *within* a request: two decisions cannot disagree about the held hats mid-request), never across requests (immediacy: revocation lands on the *next* request). That is a zookie with a one-request lifetime, and it ships as `perRequest`.
- **Negation.** Zanzibar has exclusion; this model has no negative grant. "Everyone at Big Park *except* Ellis" is inexpressible — restructure, or deny app-side. Deliberate, now named (D8).
- **Layer.** Zanzibar is a schema-free substrate one layer *below* a directory model; this model fixes a five-entity schema on top of that idea. The practical descendant question — "why not OpenFGA or SpiceDB?" — is answered in [rbac.md](rbac.md) § *The generic-graph question*: fixed schema, DSD-by-session, immediate revocation, legible snapshots.

## Kuhn, Coyne & Weil (IEEE Computer 43(6), 2010)

**What it says.** Roles and attributes are complementary; the role-explosion failure comes from encoding context in role identities; the fix is to carry context as attributes, evaluated by policy conditions — the hybrid RBAC/ABAC direction.

**Supports here.**

- **The diagnosis, nearly verbatim.** `stage-manager-bigpark` and `volunteer-gate` are their canonical pattern; "context in columns, never names" and the role-explosion section are this paper's argument restated, and the `grant` columns are the normalization it calls for.

**Where it disagrees — subtly, and the docs did not surface it.**

- **Same diagnosis, different cure.** They generalize the *condition algebra* (ABAC, XACML-style predicates); this model **deletes** it — context is attribute *values joined by identity*, never a predicate. A reader arriving from K–C–W will go looking for an attribute engine and find none; one sentence — *conditions are the application's* — prevents the misreading (now in [rbac.md](rbac.md)).
- Their attribute-**governance** concern (who maintains the attributes) has an unusually strong structural answer here that the docs never connected: roles and capabilities stay **global, seeded platform vocabulary**, not customer rows. That is the K–C–W governance answer, done by schema.

## The excluded: RBAC1, RBAC2, ARBAC97

- **RBAC1 (hierarchy).** Refused, not merely omitted — the traversal and audit arguments stand ([organization_model.md](organization_model.md)). The *counter-position* is now stated too: RBAC96 scales by inheritance; this model scales structurally.
- **RBAC2 (constraints).** The universal-conflict-set DSD is **already built** — it is rule 2. A consonance hiding in the "leaves out" list: the model implements the strongest constraint in the standard and defers only the declarative remainder (D2).
- **ARBAC97 (administration).** Deferred — but understated twice over. First, the model *already has proto-ARBAC geometry*: the organization boundary and scope coverage by prefix are the same shape as ARBAC97's administrative ranges, so the natural landing spot for "who may grant" already exists in the schema. Second, grant **creation is currently unmodeled** — the model constrains what a grant *is*, never who may *write* one. That was the sharpest open security edge in the package — and it dissolves: **administration is an action.** Granting is an act like any other — an action (`grant`) whose worn hat reaches the new grant's target, plus the organization write-check that already exists. Same spine, same audit row, no new concept; the write-side statements in [writes.md](writes.md) demonstrate it.

## Relatives the reading list now carries

The four nearest published relatives of the signature rules, none previously cited:

- **UCON — Park & Sandhu, *The UCON_ABC Usage Control Model* (ACM TISSEC 7(1), 2004).** Rule 7 — re-validate on every request — has a literature name: **ongoing authorization**, the defining property of usage control. Citing UCON turns "we re-check" from an implementation note into a recognized model class.
- **GEO-RBAC — Damiani, Bertino, Catania & Perlasca (SACMAT 2005; ACM TISSEC 2007).** The nearest relative of rule 8: roles enabled and disabled by the user's *position* mapped to spatial features; their "logical position" ≈ the scope path. The twist this model adds and should claim: **GEO-RBAC senses the user; this model anchors the grant.** Wearability is a property of the authority, not of geography.
- **TRBAC — Bertino, Bonatti & Ferrari (ACM TISSEC 4(3), 2001).** Temporal enabling and disabling of roles — the home of time-bounded hats. The organization model's own example promises a "time-limited grant" while the schema stores no validity interval (D6): time lives in the host's grant lifecycle, and TRBAC is the literature to consult when that stops being enough.
- **ReBAC / OpenFGA / SpiceDB.** Zanzibar's public descendants and the practical comparison; answered in [rbac.md](rbac.md) § *The generic-graph question*.
- **XACML 3.0 (OASIS, 2013); NIST SP 800-162 (2014).** Free vocabulary for the permission seam: the capability table is a PAP, `can` is a PDP call, the application is the PEP. Naming the seam in those terms makes the structural-half claim legible to the ABAC crowd.

## Summary

| Reference | Strongest support here | Sharpest disagreement |
| --- | --- | --- |
| RBAC96 / ANSI Core | grant = UA, capability = PA, session = worn hat; immediacy *exceeds* the standard | the session is per organization (C31); universal DSD is a policy choice; flatness by structure, not inheritance |
| TMAC | role-in-team-context; roster-as-derived (the application's rule) | standing, org-fielded teams vs ad-hoc collaborations; one hat, not team-context activation |
| Giuri & Iglio | the grant = a role instantiated over a target | their parameters carry predicates; the condition language is deleted here |
| GRBAC | the environment dimension; the conjunctive rule shape | environment *evaluated* vs scope *anchored*; venue unverified |
| Zanzibar | tuples without rewrites (OH-QM-09); the two-edge rule = intersection; trust view = Expand | bounded staleness vs rule 7 (OH-QM-04 fails under Zanzibar defaults); no negation (D8) |
| Kuhn, Coyne & Weil | the role-explosion diagnosis, verbatim | their cure is an attribute algebra; this model's is its deletion |
| ARBAC97 | proto-administrative ranges already exist (org boundary, scope coverage) | administration *was* unmodeled — dissolved: *who may grant* is an action plus reach plus the org check |
| UCON / GEO-RBAC / TRBAC | names for rules 7, 8, and D6 respectively | none — these are kin, not adversaries |

## Citation precision

What is settled and what to verify before a bibliography cites it:

| Citation | Status |
| --- | --- |
| Ferraiolo & Kuhn 1992 | 15th NCSC — settled |
| Sandhu et al. 1996 | IEEE Computer 29(2), February — settled |
| Ferraiolo et al. 2001 | ACM TISSEC 4(3) — settled |
| ANSI/INCITS 359-2004 | as cited (a 2012 revision exists) — settled |
| Thomas, TMAC | workshop 1997 **and** journal ACM TISSEC 2(1), 1999 — carry both |
| Giuri & Iglio 1997 | 2nd ACM RBAC Workshop — settled |
| Covington, Moyer & Ahamad, GRBAC | **unverified** — canonical form is NISSC/NCSC-era; the "2001" previously carried here matched no venue on this shelf. Verify before citing |
| Kuhn, Coyne & Weil 2010 | IEEE Computer 43(6), June — settled |
| ARBAC97 | ACM TISSEC 2(1), 1999 — settled |
| Zanzibar | USENIX ATC 2019 — settled |
| UCON | ACM TISSEC 7(1), 2004 — settled |
| GEO-RBAC | SACMAT 2005 (short); ACM TISSEC 2007 (journal) — cite the journal |
| TRBAC | ACM TISSEC 4(3), 2001 — settled |

Corrections to citations, venues, or any characterization above are welcome — this file exists so they have one place to land.
