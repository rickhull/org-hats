# Actor roster and organization administration

Organization authority owns its actors and its administrator standing. Four
organization commands complete that ownership: an administrator can add an
actor, set or clear its display name, and appoint or retire an administrator
without a deployment and without an operator.

A created actor is enabled and unlinked. Creating an actor is not activation:
no principal link, grant, participation, or administrator standing arrives
with it, and only activation acceptance or the explicit bootstrap/ops surface
binds evidence to it.

## Commands

| Command | Effect |
| --- | --- |
| `create-actor` | Adds an enabled, unlinked actor with the caller-supplied `actorId` and an optional `displayName`. |
| `update-actor` | Sets the actor's `displayName`; `null` clears it. The field is required, and an empty or over-long name is refused. |
| `appoint-administrator` | Adds the actor to the organization's administrator standing. The actor must exist and be enabled; it need not be claimed. |
| `retire-administrator` | Removes the actor's standing, subject to the usable-successor rule below. Retiring a non-administrator is an idempotent no-op. |

All four require `fresh-evidence` from an `adminOfOrganization`. An access
envelope belongs to an operation and is refused; a caller from another
organization is a `wrong-binding`. Every mutation commits its idempotency
claim, its fact, and its audit row together.

## Actor ids

The host supplies `actorId`, an opaque string of at most 128 characters. Ids
are organization-scoped: the same string may name actors in two
organizations. A duplicate in one organization is `invalid-command`; an empty
id is refused.

An id is an address, not a secret, and not a place for personal data. A host
must not encode an email address, a display name, or any other roster fact
into it — the same rule that keeps evidence out of the roster applies to the
identifiers a host chooses.

Authority-minted ids were rejected for this surface: the command receipt
carries no generated value and an idempotency claim replays only its payload
hash, so a lost response would strand an actor the host could not address.
Returning a generated fact would need result replay in the claim table, which
is a separate contract change.

## Display names

`displayName` is presentation only. It never enters a link, a grant, a
decision, or an authorization, and two actors may share one. `null` clears it;
an absent `displayName` is a different command payload, which is why
`update-actor` requires the field: a retry cannot change shape between absent
and null and be mistaken for a different payload.

A rename stays in organization authority. The operation roster projection
carries existence and enabled state only — deliberately no names — so a rename
is not a roster push.

## Administrator standing

Administrator standing lives in organization state. The configured `orgAdmins`
record seeds it at bootstrap; after that the record is not a live writer and
the organization appoints and retires its own administrators. Operation
administration is separate: `adminRoles` remains runtime configuration, and no
command here appoints an operation administrator.

An unclaimed actor may be appointed. That is the normal state between
provisioning and claiming, and it keeps the at-rest invariant — an organization
always has at least one administrator — true while a person has not yet signed
in.

### The usable successor

Retirement is refused unless another administrator remains **enabled and
principal-linked**. An enabled but unclaimed administrator counts at rest, but
does not satisfy this transition precondition, because nobody can act with
that standing yet. The check runs in the same transaction as the removal, so a
concurrent claim or disable cannot slip between the test and the write.

A sole administrator therefore appoints and claims a successor before retiring.
A retired actor's fresh evidence no longer authorizes anything, including a
retry of the retirement; another administrator can replay the same idempotency
key and receives `applied: false` without a second application.

`disable-actor` is deliberately not guarded. It is the offboarding act: an
organization may disable its last administrator, and a departing administrator
may disable herself, keeping only the bounded access envelope already issued.
Retirement removes standing; disable ends a person. They are different acts.

## Failures

No new failure kind is added.

| Condition | Failure |
| --- | --- |
| Unknown organization | `wrong-binding` |
| Caller is not an administrator, or used an envelope | `denied` |
| Unknown actor | `invalid-command` |
| Empty or over-long actor id or display name | `invalid-command` |
| Duplicate actor id in the organization | `invalid-command` |
| Appointing a disabled actor | `not-admitted` |
| Retirement with no usable successor | `denied`, detail `no other usable administrator remains` |
| Reused idempotency key with a different payload | `invalid-command` |

## Audit and state

The audit facts are `actor <id> created`, `actor <id> display name updated`,
`actor <id> appointed administrator`, and
`actor <id> retired as administrator`. A no-op does not write a fact, though
it still commits its claim.

Administrator standing and actor display names travel with the organization's
export and restore, next to actors, principal links, and activation requests.
A Cloudflare release that changes this schema keeps the existing upgrade path;
the conformance world seeds standing through the same bootstrap payload it
already uses.

## Not in this slice

Team create, update, and retire wait for retirement's effects on grants and
refresh authority, and for the site-fielding constraint. Site delegation needs
its own model decision. Re-enabling a disabled actor is not asked for, so
offboarding stays terminal.
