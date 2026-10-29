# Team lifecycle

**Status:** design confirmed by Rick 2026-10-29; Quartermaster's acceptance
of the write shape is pending. No executable types change until they answer.
This is Tier 2, slice 2: Quartermaster's ask 5.

## Goal

Complete operation authority's ownership of teams. An organization can ask
for a team at a site, an operation administrator admits it, and either side
can retire it — with retirement's effects on grants and refresh authority
defined, not implied. The site-delegation question stays closed: there is no
per-organization site entitlement in this design.

## Settled boundary

- A team is operation data, anchored to exactly one site and one
  organization. Organizations request; the operation admits. This is the
  approval Quartermaster accepted in place of a site-grant relation, and it
  is the real gate for a cooperating organization's teams.
- The operation administrator's admission is the placement approval. There
  is no separate "site the operation has granted this organization" fact.
- An organization administers only its own teams: the owning organization is
  derived from the team, never taken from the caller.
- Retirement removes the team from decisions and revokes what stood on it.
  A team is never moved between sites; retirement plus a new team is the
  path.
- Operator bootstrap keeps provisioning teams directly, as it does today.
  Bootstrap-created teams are `active`.

## State machine

Teams gain a status:

```
pending   requested by the owning organization, waiting for operation admission
active    admitted (or bootstrapped); the only status decisions see
retired   tombstone: excluded from snapshots, grants revoked, id never reused
```

`Snapshot.teams` carries active teams only. `OpState.teams` keeps all three
statuses for audit, idempotency, and refusal of id reuse. The `Team` model
type does not gain a status: a snapshot with a pending or retired team in it
is a bug, not a model state.

## Commands

| Command | Authorized by | Effect |
| --- | --- | --- |
| `request-team` | fresh evidence from `adminOfOrganization` of `organizationId` | Creates a `pending` team. The organization must actively participate in the operation; the site must exist; the `teamId` must be new in the operation. |
| `admit-team` | `adminOfOperation` (envelope or fresh evidence) | `pending` → `active`. Idempotent: an active team replays as success. |
| `update-team` | fresh evidence from `adminOfOrganization` of the team's organization | Sets or clears `displayName` (required field, `null` clears, empty refused). Presentation only; no decision or reach changes. |
| `retire-team` | fresh evidence from `adminOfOrganization` of the team's organization, **or** `adminOfOperation` | `pending`/`active` → `retired`; revokes team-targeted grants and their refresh records. Idempotent. |

Bodies:

```ts
| { readonly kind: "request-team";
    readonly operationId: Unbranded<OperationId>;
    readonly organizationId: Unbranded<OrganizationId>;
    readonly teamId: Unbranded<TeamId>;
    readonly siteId: Unbranded<SiteId>;
    readonly displayName?: string }
| { readonly kind: "admit-team";
    readonly operationId: Unbranded<OperationId>;
    readonly teamId: Unbranded<TeamId> }
| { readonly kind: "update-team";
    readonly operationId: Unbranded<OperationId>;
    readonly teamId: Unbranded<TeamId>;
    readonly displayName: string | null }
| { readonly kind: "retire-team";
    readonly operationId: Unbranded<OperationId>;
    readonly teamId: Unbranded<TeamId> }
```

An access envelope authorizes operation-administrator acts, as it does for
`grant-hat`. Organization-administrator acts require fresh evidence, as every
roster and standing write does. The operation coordinator checks the team's
owning organization against the caller's organization; the Cloudflare route
carries the caller's organization id and the operation-administrator flag from
the resolved principal, so an organization act can only touch its own team.

## Retirement effects

One operation transaction:

1. Mark the team `retired`.
2. Revoke every grant whose target is that team (`revoked: true`, retained
   for audit).
3. Revoke the refresh records of every actor who held one of those grants,
   matching `revoke-grant`'s posture.
4. Audit `team <id> retired; N grants revoked`.

Consequences, stated so no host infers more:

- New issuance and refresh exclude the team immediately; a refresh chain that
  stood only on a team grant fails.
- Already-issued envelopes remain valid until their signed expiry. Their
  claims already carry reach computed at issuance, so they can still reach
  the site for that bounded window. This is the same revocation window as
  every other grant revocation.
- Site grants are unaffected: they name the site, not the team.
- The team id is never reusable, so a retired team cannot be resurrected by
  re-requesting the same id.

## Decisions proposed

1. **Names and flow.** `request-team` + `admit-team`, mirroring
   `participation-invite` and `admit`, rather than `create-team` +
   `approve-team`. The pending state is the request; no team exists in a
   snapshot until admitted.
2. **Caller-supplied team ids.** The owning organization supplies the opaque
   `teamId`, as it does for actors. Same validation: non-empty, at most 128
   characters, unique within the operation including retired ids, no personal
   data encoded. Authority-minted ids would need result replay in the claim
   table.
3. **Authorization split.** Organization acts (`request`, `update`, owner
   `retire`) require fresh evidence; operation acts (`admit`, operation-admin
   `retire`) may use an envelope. This matches the roster rule and the
   operation command rule.
4. **Retirement revokes grants and refresh.** Leaving grants in place and
   relying on the team's absence would keep dead grants in the snapshot and
   defer an audit fact; revocation states the act once.
5. **Both sides may retire.** The owning organization can end its own team;
   the operation administrator can end any team in the operation. A pending
   request is owned the same way.
6. **No move, no reuse.** A site move is retire-and-request. A retired id is
   refused under any new key.
7. **Bootstrap stays direct.** Operator-provisioned teams are active and do
   not need a pending step; bootstrap is the operator path, not an
   organization request.

If an answer differs, amend it here before task 1 lands.

## Work plan

### 1. Settle the contract with Quartermaster

Send the write shape, authorization split, id rules, and retirement effects
to Quartermaster and ask for acceptance. The contract stays in this plan
until code lands: `docs/` describes the working system, so `docs/teams.md`
and the spec amendments move with the implementation, not ahead of it.

**Done when:** Quartermaster has accepted the shape or named a change, and
the accepted contract is this plan's decisions section.

**Evidence:** the relay entry and their reply.

### 2. Land the portable commands

Add the four command variants and the status field to operation state; filter
snapshots to active teams; implement request/admit/update/retire with claims,
audit, and the same-transaction revocation. Keep `grant-hat` refusing a
non-active team.

**Likely paths:** `src/authority/types.ts`, `src/authority/state.ts`,
`src/authority/operation.ts`, `src/authority/engine.ts`,
`tests/teams.test.ts`, `docs/teams.md`, `docs/authority_redesign.md`,
`specs/authority.md`.

**Done when:** portable tests cover request/admit, refusals (non-admin, no
active participation, unknown site, duplicate or retired id), update and
clear, both retirement paths, grant revocation, refresh death, live-envelope
window, and idempotent retries; and `docs/teams.md` plus the spec amendments
describe the built portable behavior.

**Evidence:** focused team tests, `pnpm check`, `pnpm build`; tracked `dist/`
matches `src/`.

### 3. Persist and expose in the Cloudflare adapter

Add the team status column and migration, route the four commands, keep
bootstrap teams active, and make export/restore carry the status. The
operation schema moves from 4 to 5.

**Likely paths:** `packages/cloudflare/src/operation.ts`,
`packages/cloudflare/src/state.ts`, `packages/cloudflare/src/runtime.ts`,
`packages/cloudflare/src/index.ts`, `packages/cloudflare/test/`.

**Done when:** upgrade from schema 4 preserves existing teams as active;
export/restore round-trips pending/active/retired; the commands refuse
envelopes for organization acts and non-administrators; retirement revokes
grants and refresh in one transaction.

**Evidence:** focused operation, state, runtime, and ops suites.

### 4. Conformance and close the documentation

Add `OH-TEAM-*` cases to the shared inventory with inventory rows: request and
admit, placement refusal, owner vs operation authorization, retirement
effects, live-envelope window, no id reuse. Update `docs/teams.md`,
`docs/inventory.md`, and any tutorial story that creates a team.

**Done when:** both runtimes pass the same team cases; every case has a row;
the plan can be removed.

**Evidence:** `pnpm check`, `pnpm check:cloudflare`, `bin/check-dist`, and
`pnpm verify` with tracked `dist/`.

## Risks

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Pending teams leak into decisions | A grant or read reach names an unadmitted team | Snapshot filters to active; `grant-hat` refuses non-active; conformance case |
| Retirement leaves grants behind | Dead targets stay in the operation snapshot | Revoke team-targeted grants and their refresh records in the same transaction |
| Hosts read retirement as immediate envelope death | A host believes access ended at retirement | Document the bounded expiry window; it matches every grant revocation |
| A retired id is re-requested | Old audit, grant, and target references collide | Refuse id reuse even under a new key |
| Organization acts ride an operation envelope | A roster-like write escapes fresh evidence | Per-kind authorization check; envelope refused for request/update/owner retire |

## Not in this plan

- **Site delegation.** Withdrawn; approved placement is the gate.
- **Moving a team to another site.** Retire and request a new team.
- **Team-scoped read policy.** The consumer's team-read axis is a separate
  model decision.
