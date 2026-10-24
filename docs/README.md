# Docs — what is

This directory documents the working system. A doc here that describes a
past state is a bug and is updated in the same commit as the change — the
migration note is the deliberate exception, because its subject is the
transition. Forward-looking work is in `plans/`; history is in commit
messages.

The contracts this repository owns are implemented, so they live here rather
than in a separate `specs/` stage. Quartermaster's `specs/` holds its
design-stage consumer contracts; where one disagrees with these docs, the
public `org-hats` docs are normative for the seam.

## Normative

- [`authority_redesign.md`](authority_redesign.md) — the architecture:
  modules, state ownership, the identity boundary, verification strategy, and
  packaging.
- [`envelope.md`](envelope.md) — the signed access-envelope format: claims,
  canonical encoding, signature transport, version and key compatibility.
- [`lexicon.md`](lexicon.md) — the normative vocabulary; it wins over loose
  usage elsewhere.
- [`migration-v1.md`](migration-v1.md) — the 0.4 → v1 crossing, including
  the 1.1 break.
- [`publishing.md`](publishing.md) — canonical host, mirror, CI, and the
  release ritual.

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
