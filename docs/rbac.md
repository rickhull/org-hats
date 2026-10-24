# This model and RBAC

*Not RBAC — the structural authority core an RBAC application is built on.*

## Thesis

This repository defines no permissions over product objects. It defines
**who** acts (an organization-scoped actor), the **role** they are granted
over a team or site, the **operation and place** that bound the grant, and
the **hat** worn for one act. That is the organizational half of RBAC. The
half that names objects and product verbs belongs to the host. This is not a
rival to RBAC; it is a compatible core for building it.

The closest references are Core RBAC, TMAC, role templates, GRBAC, Zanzibar,
Kuhn–Coyne–Weil, and ARBAC97; [literature_review.md](literature_review.md)
carries the method and the reference inventory, with the per-reference
analysis returning by re-specification. Two v1 positions are already fixed:
authority is operation-scoped, and exactly one hat is worn for an act. Role
hierarchy and declarative separation-of-duty constraints are deliberately
outside the model, not half-built.

The permission layer is not a port surface. A host maps its product facts
onto the neutral targets an access envelope names; it does not add objects to
this model. See [authority_redesign.md](authority_redesign.md) § Access and
[lexicon.md](lexicon.md) for the words. This is a phase-1 toehold; the
RBAC-term mapping and the comparison table return by re-specification.
