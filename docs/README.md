# Docs — what is

This directory documents the working system. A doc here that describes a
past state is a bug and is updated in the same commit as the change — the
migration note is the deliberate exception, because its subject is the
transition. The named invariants distilled from these docs live in
[`specs/`](../specs/); forward-looking work is in `plans/`; history is in
commit messages.

The contracts this repository owns are implemented, so they are documented
here as built rather than in a design-stage `specs/` — the specs directory
here holds invariants, not drafts. Quartermaster's `specs/` holds its
design-stage consumer contracts; where one disagrees with these docs, the
public `org-hats` docs are normative for the seam.

## Normative

- [`authority_redesign.md`](authority_redesign.md) — the architecture:
  modules, state ownership, the identity boundary, verification strategy, and
  packaging.
- [`envelope.md`](envelope.md) — the signed access-envelope format: claims,
  canonical encoding, signature transport, version and key compatibility.
- [`cloudflare.md`](cloudflare.md) — the Cloudflare reference runtime as
  built: its coordinators, the Worker surface and the provider-callback
  exchange, signing and key rotation, configuration, ops routes, and the
  state lifecycle.
- [`binding-conformance.md`](binding-conformance.md) — the documented
  service-binding smoke subset and what it does not claim.
- [`lexicon.md`](lexicon.md) — the normative vocabulary; it wins over loose
  usage elsewhere.
- [`migration-v1.md`](migration-v1.md) — the 0.4 → v1 crossing, including
  the 1.1 break.
- [`migration-v2.md`](migration-v2.md) — the 1.2 → 2.0 break: the
  `GrantTarget` command shape, interface version 2, and why envelope format
  1 keeps reading across it.
- [`publishing.md`](publishing.md) — canonical host, mirror, CI, and the
  release ritual.

## Tutorial

- [`tutorial.md`](tutorial.md) — a longer, concrete walkthrough through the
  synthetic twins: one actor in two operations, the decisions each hat
  produces, commands and denial, refresh rotation, a lost disable message,
  and the Airlift's crossed grant.

## Background

Phase-1 toeholds. Each carries only the opening that still holds in v1; the
body returns by re-specification against the architecture and the code, never
by copying the v0.4 tree.

- [`organization_model.md`](organization_model.md) — the structural model in
  one piece.
- [`rbac.md`](rbac.md) — this model's position among RBAC references.
- [`literature_review.md`](literature_review.md) — the reading method and the
  reference inventory.

## Root

- [`../SECURITY.md`](../SECURITY.md) — vulnerability reporting and
  coordinated disclosure.

The v0.4 line lives at its tags; it is not documentation of this line.
