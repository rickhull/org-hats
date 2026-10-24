# Literature review

*What each reference supports here, where it disagrees, and what a well-read
practitioner should verify before citing. [rbac.md](rbac.md) states the
positioning; this file carries the evidence.*

## How to read this

One section per reference, three questions each: **what it says**, **what it
supports here**, and **where it disagrees**. The model is not a synthesis of
these papers; it is a position taken among them. Consonances mark proven
ground; dissonances are the model's own claims, stated as claims. Venue
details that cannot be verified are flagged rather than asserted.

This is a phase-1 toehold. The method and the reference inventory carry
forward; the per-reference analysis returns only by re-specification against
the v1 model and the interfaces under `src/`. Nothing here is copied from
the v0.4 line.

## References in scope

- **Core RBAC** — Sandhu, Coyne, Feinstein & Youman, *Role-Based Access
  Control Models* (IEEE Computer 29(2), 1996); ANSI/INCITS 359-2004.
- **Team-Based Access Control** — Thomas (2nd ACM RBAC Workshop, 1997; ACM
  TISSEC 2(1), 1999).
- **Role templates** — Giuri & Iglio, *Role Templates for Content-Based
  Access Control* (1997).
- **GRBAC** — Covington, Moyer & Ahamad, *Generalized Role-Based Access
  Control* (venue unverified).
- **Zanzibar** — Pang et al. (USENIX ATC, 2019).
- **Kuhn, Coyne & Weil**, *Adding Attributes to Role-Based Access Control*
  (IEEE Computer 43(6), 2010).
- **ARBAC97** — Sandhu, Bhamidipati & Munawer (ACM TISSEC 2(1), 1999).

RBAC1 (hierarchy) is refused rather than deferred; RBAC2 (declarative
constraints) is outside the model. Both return in the analysis as
counter-positions, not roadmap items.

## v1 positions already fixed

- Authority is operation-scoped: an organization participates in many
  operations, and a grant is operation-local.
- An actor is organization-scoped; there is no platform-global person.
- Reach is discrete over a team or a site and its teams; there is no scope
  path, hierarchy, or inheritance.
- Exactly one hat is worn for an act; a host never chooses one implicitly.
- Read reach is an issuer fact computed under the policy bundle, not a
  verifier reconstruction.

The per-reference sections return when they can be stated against these
positions rather than against the v0.4 schema.
