# Migrating from org-hats v0.4 to v1

**Status:** `v0.4` and `v1.0.0` are historical. The v0.4 surface remains
available at its tags (`v0.4.4`); the line has since released `1.1.0` — the
coordinated break recorded below — and `1.2.0`, which is additive (the
verification-key set and the `amr`/`auth_time` claims; no migration).
Everything below records the deltas a consumer crosses.

## 1.0 → 1.1

`1.1.0` is a deliberate break; `1.0.0` is frozen and receives no patches.

- `Organization.id` is now `Organization.organizationId`, matching the
  `(organizationId, actorId)` pair and the grant/participant refs. Snapshot
  producers and destructuring consumers change one field.
- `participation-accept` takes `{ operationId }` only. The
  `{ invitationId }` form is gone; the invitation id was not reachable
  through the public runtime.
- `createInMemoryAuthority` defaults to the wall clock; tests inject a fixed
  clock. Its default signer now has a distinct key id per engine, and the
  public signer type no longer exposes `privateKey()`.
- Published declarations import `.js` specifiers, so consumers may set
  `skipLibCheck: false` without reading TypeScript through `dist/`.

## Model

| v0.4 | v1 |
| --- | --- |
| An organization is owned by one operation's root scope | An organization is independent and may participate in many operations |
| `Actor` is a platform-level row; QM kept one actor across orgs (D62) | An actor is organization-scoped: the stable pair `(organizationId, actorId)`; a person in two organizations is two actors, linked by nothing |
| Scope paths (`/riverbend/bigpark/`), prefix coverage | Discrete reach: a grant reaches one team, or a site and its teams. No hierarchy, no coverage walk |
| `Role` entity plus capability rows | Roles and their actions come from the operation's policy bundle (`PolicyBundle`) |
| `Grant` over a team or a scope | `Grant` is operation-local, names the actor pair, targets a team or site, carries `primary` (one per actor per operation) |
| Immediate reread on every request | Bounded signed projections; the core stays pure and instant, the runtime owns lifetimes |
| Denial reasons on `decide` | Same vocabulary (`not-admitted`, `no-capability`, `out-of-reach`) on the same formula: role carries the action × grant reaches the target |

New in v1: `Participation` and its state machine (invite → accept → active,
revoke terminal); `invariantProblems` as the snapshot judge; `readReach`
computed under the active bundle (`granted-teams` or `all-participating`).

## Interface

| v0.4 | v1 |
| --- | --- |
| Root export: predicates + `OrgHatsRepository` port + `decide` spine; `org-hats/node` SQLite adapter | Root export: the generic model + policy vocabulary. `org-hats/authority` is the use-case runtime; `org-hats/access` is the verification-only module |
| Host implements the persistence port and owns writes, ordering, audit, sessions | The authority engine owns all of it behind `AuthorityRuntime`; persistence is an internal seam with no published SPI |
| Host predicates read live rows on every request | The authority issues a short-lived signed envelope; `org-hats/access` verifies it and yields neutral facts. Revocation is bounded by expiry, with explicit refresh outcomes |
| Conformance ids `OH-QM-01…11` | `org-hats/conformance` with `OH-MODEL-*`, `OH-AUTH-*`, `OH-PART-*`, `OH-CMD-*`, and `OH-ACCESS-*` ids; the old ids stay frozen with their tags |

## What is not carried over

- The Node SQLite adapter and its schema (`org-hats/node`); the Cloudflare
  reference runtime arrives as the separate `org-hats-cloudflare` package.
- The request spine (`perRequest` memo, `DecideRequest`); the runtime and the
  access module supersede it.
- Scope-path helpers (`leafScopeId`, `parentPath`, `scopeCovers`).

Each of these may return only by being re-specified against
[authority_redesign.md](authority_redesign.md), never by copying the v0.4
source back.
