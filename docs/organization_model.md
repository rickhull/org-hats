# Organization model

*The structural statement: actors, organizations, operations, sites, teams,
grants, hats, and the reach between them. The normative architecture is
[authority_redesign.md](authority_redesign.md).*

The model describes an organization as **actors holding grants over teams
and sites**, bounded by which organization fields a team and where the
operation does work. It is deliberately small and repository-independent: it
names no product, no action, and no object type. A host supplies its own
vocabulary and reads authority from one rule:

```text
may act = role carries the action x grant reaches the target
```

The model has two halves. The **organization model** is the directory and
authority facts: organization-scoped actors, teams fielded by one
organization at one site, operation-local grants, participation, and the one
hat worn for an act. The **policy bundle** is the operation's data: the
action vocabulary, the roles that carry actions, and the read policy under
which reach is computed. Neither half names a product verb.

An operation is not owned by an organization. A host that needs a leading
organization keeps that designation in its own product record;
the authority model carries no leading-organization field.

The executable form is the portable source: `src/model.ts` and
`src/policy.ts` for the pure model, `src/authority/` for the runtime that
owns participation, admission, grants, and issuance, and the synthetic
example fixtures in `src/authority/twins.ts` for the structural cases. Where
this document and
the types disagree, the types and
[authority_redesign.md](authority_redesign.md) win. This is a phase-1
toehold: the detailed entity and rule sections return by re-specification
against the v1 model, not by copying the v0.4 text.
