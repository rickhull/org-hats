# The reference implementation

*What an opinionated, host-facing layer adds to the frozen core — what shipped in `v0.2.0`, and the decisions still open. The model is settled ([organization_model.md](../docs/organization_model.md)).*

## Status

Shipped in **v0.2.0**, all additive, all inside the fence (no `node:*`, zero runtime deps):

- **The request spine** — `src/decide.ts`: `decide` / `decideSpeak` over the port, composing the predicates in the order the rules require. Decisions are **data, never exceptions**, with reason codes and a `fallback` field (rule 5's signal).
- **The conformance harness** — `runConformance(bodies)` in `src/conformance.ts`: every body runs, a throw is a failure, and the ids ran are diffed against the published inventory so drift fails the report. A host proves the ten against *its own* store in one call.
- **The fake port** — `src/testing.ts`: `fakeRepository(hats, read?)`; route wiring and decision mapping testable without a driver.

Still open, deliberately:

- **The write side as statements** — reference SQL for grant / revoke / primary / default, transaction-wrapped, carrying the invariant checks (first-grant-primary, employer-not-crossing, peer shape — C39). A host copies them into its migrations. An admin *API* is C53's decision, not this layer's.
- **A D1 adapter** — the port's two questions map directly; `src/node.ts` is the template. This is the artifact Quartermaster would actually install.

## The thesis

The core states the rules as small predicates; the port answers two async questions. What a host must still assemble — and get right *in order* — is the **request spine**:

```
authenticate → resolve operation + scope → hatsOf → wearableAt → wornHat(claim) → can / maySpeak → decide → audit
```

That ordering *is* the model: rule 7 lives in "the claim is re-validated against the **wearable** set, not the held set"; rule 5 in "the switch is recorded"; rule 8 in "wearable filters before worn resolves." Getting the order wrong is how a revoked claim authorizes an act. The spine composes it once, so the wrong order is inexpressible.

## The decisions it takes (and how to override them)

- **C31 — the landing rule.** The spine's position: **organization is request context, never session-global.** An optional `organizationId` filters wearability; absent it, `wornHat`'s own order applies (claimed → default → primary → first). A host serving team routes should pass the target team's organization. No schema change; the position lives in the spine and can be ignored.
- **C34 — the multi-organization read rule.** Not the spine's call: reads belong to `readableTeamsAt`. Follow-the-worn remains the consumer's choice to make (and to union peers on top).
- **C39 — write atomicity.** Owed by the write-side statements when they land; a D1 adapter states it again in its own terms.
- **A revoked claim falls back, it does not fail** (OH-QM-04). `decide` reports the drift as `fallback: "default" | "primary" | "first"` rather than denying — the audit row shows the claimed id and what was actually worn. Overridable by ignoring the field; not by changing the core.

## What it must not add

A policy engine, conditions, negation, a cache, hierarchy, a service. The razor: **compose what exists; force the open decisions; add no model concept.** (Why: [rbac.md](../docs/rbac.md) § *The generic-graph question*; [concerns.md](../docs/concerns.md) D-list.)

## Cost posture (C54)

One `hatsOf` per request; no cache, by rule 7 — immediacy is conformance (OH-QM-03, OH-QM-04), and Zanzibar's bounded staleness is the opposite trade. If a host ever accepts a staleness contract, the cache belongs behind the port, never around the spine. Stated in [package.md](../docs/package.md) § *The request spine*.

## Housekeeping resolved in v0.2.0

`src/node.ts`'s grant error — *"a grant needs a subject"* — now says **target**, aligned with the docs (rbac.md § *Three things to keep straight*).
