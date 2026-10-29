# Teams

A team is operation data: one site, one owning organization, written only by
operation authority. The organization requests the team; an operation
administrator admits it. That admission is the placement approval — there is
no separate per-organization site entitlement.

## Lifecycle

```
pending   requested by the owning organization, waiting for operation admission
active    admitted (or bootstrapped); the only status a snapshot contains
retired   tombstone; grants revoked, id never reused
```

Operation state holds all three statuses for audit, idempotency, and id-reuse
refusal. `Snapshot.teams` projects active teams only, and the model `Team`
type carries no status: a pending or retired team in a snapshot is a bug.

Operator bootstrap provisions teams directly and they are `active`. Bootstrap
seeds; it does not overwrite an existing team, so a later rename or retirement
survives a re-bootstrap.

## Commands

| Command | Authority | Effect |
| --- | --- | --- |
| `request-team` | fresh evidence from an `adminOfOrganization` of the named organization | Creates a `pending` team at an existing site. Requires active participation and a new `teamId`. |
| `admit-team` | `adminOfOperation` (access envelope or fresh evidence) | `pending` → `active`. An active team replays as success; a retired one is refused. |
| `update-team` | fresh evidence from an administrator of the team's organization | Sets or clears `displayName`. Presentation only: no decision, reach, or grant changes. |
| `retire-team` | the team organization's administrator with fresh evidence, or an `adminOfOperation` | `pending`/`active` → `retired`; revokes the grants and refresh records that stood on the team. |

An organization administrator acts only on its own team: the operation
coordinator compares the team's owning organization with the caller's, and
the Cloudflare route carries both the caller's organization id and the
operation-administrator flag resolved from the principal. Organization acts
require fresh evidence; an access envelope carries only operation standing.

`admit-team` is the placement decision. The operation administrator sees the
requested site in the command and either admits or retires the pending team.

## Ids and names

The organization supplies the opaque `teamId`, as it does for actors:
non-empty, at most 128 characters, unique within the operation including
retired ids, and no personal data encoded. A retired id is never reused, so
a team cannot be resurrected by re-requesting it.

`displayName` is optional at request, required in `update-team`
(`string | null`; `null` clears, an empty string is refused), and never
identity or authorization. A team is never moved between sites: retire it and
request a new one.

## Retirement

One operation transaction:

1. mark the team `retired`;
2. revoke every non-revoked grant whose target is that team, retaining the
   grant rows for audit;
3. revoke those actors' refresh records, matching `revoke-grant`;
4. audit `team <id> retired; N grants revoked for M actors`.

New issuance and refresh exclude the team immediately. Envelopes already
issued remain valid until their signed expiry, with the reach they carry —
the same bounded window as any grant revocation. Site grants are unaffected;
they name the site, not the team.

## Failures

No new failure kind is added.

| Condition | Failure |
| --- | --- |
| Unknown operation or team | `wrong-binding` / `invalid-command` |
| Caller is not the required administrator | `denied` |
| Organization does not actively participate | `denied` |
| Unknown site | `invalid-command` |
| Empty, over-long, or reused team id | `invalid-command` |
| Empty or over-long display name | `invalid-command` |
| Admitting or renaming a retired team | `invalid-command` |
| Owner retirement on an access envelope | `denied` ("owner retirement requires fresh evidence") |
| Reused idempotency key with a different payload | `invalid-command` |

## Cloudflare

The operation schema is 5. `teams.status` is `pending`, `active`, or
`retired`, `modelSnapshot` reads active teams only, and grants refuse a team
that is not active. Export carries the status; restore accepts older exports
(schema 2–4) and restores teams that predate the column as `active`.

The commands are coordinator routes on the operation Durable Object; the
runtime performs the authorization split above before routing them.

## Not in this slice

- **Site delegation.** Closed; approved placement is the gate.
- **Moving a team to another site.** Retire and request a new one.
- **A team-read policy axis.** Separate model decision.
