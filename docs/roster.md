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

Bootstrap seeds actors one at a time: it adds an actor the organization does
not know, and leaves a known actor's name and enabled state alone. Standing
is different in one way: the configured `orgAdmins` seeds only the bootstrap
that creates the organization. Every later bootstrap seeds none, even for an
actor it adds, so a re-bootstrap cannot revert a rename, re-enable a disabled
actor, restore a retired administrator, or appoint a new one. Appointing
after creation is `appoint-administrator`'s act.

An unclaimed actor may be appointed. Administrator standing can therefore
exist before its holder has linked a principal. Holding standing and being
able to exercise it are different facts; the usable-successor rule checks
both when an administrator retires.

### The usable successor

Retirement is refused unless another administrator remains **enabled and
principal-linked**. An enabled but unclaimed administrator counts at rest, but
does not satisfy this transition precondition, because nobody can act with
that standing yet. The check runs in the same transaction as the removal, so a
concurrent claim or disable cannot slip between the test and the write.

A sole administrator therefore appoints and claims a successor before retiring.
A retired administrator's fresh evidence no longer authorizes organization
roster or standing changes, including a retry of the retirement. Another
administrator can replay the same idempotency key and receives
`applied: false` without a second application. Retiring administrator
standing does not remove the actor's operation grants.

`disable-actor` is deliberately not guarded. It is the offboarding act: an
organization may disable its last administrator, and a departing administrator
may disable herself, keeping only the bounded access envelope already issued.
Retirement removes standing; disable ends a person. They are different acts.

## The roster read

A valid access envelope lets an organization **administrator** read the
organization's roster — a read, not a mutation, so no fresh evidence; the
step-up contract reserves fresh evidence for the acts that change the
roster. The gate is standing itself, checked live at the organization:
the envelope proves the caller, standing decides who reads, and a member
without standing is `denied` — a different kind from a broken session,
which the closed taxonomy already separates (`invalid-signature`,
`expired`, `unauthenticated` all fail before the gate runs), so a host can
tell a surface offered to the wrong actor from a session problem. The
roster is not member-visible; a member
directory, if one is ever wanted, is a separate narrower read with its own
decision, not this one widening.

Two scopes, deliberately different:

- **actors** are organization-wide and unfiltered by the envelope's
  operation — an actor with no participation in the operation the
  administrator happens to be signed in at is still on the roster, and is
  exactly who the administrator may need to place. Each entry carries the
  actor id, the display name when one is set, and the enabled state.
- **teams** are the teams the organization fields **in the envelope's
  operation**, each with its display name and lifecycle status (pending,
  active, retired). Teams are operation data ([teams.md](teams.md)), so the
  operation the envelope binds to bounds this half.

Both halves are live reads, the same shape `context()` uses. Standing is
also a fact on `AuthorityContext` — presentation, so a host can hide its
administration surface — read live at the organization, never an envelope
claim: a signed bearer standing fact would freeze a live organization fact
into an operation projection and invite offline standing checks. The two
freshnesses are a property, not an accident: standing read through
`context()` — and the roster's gate — is as fresh as the call, while every
hat-derived reach in the envelope is as fresh as the lease. A consumer
that mixes them should hide on the first and authorize on neither. Commands
keep checking standing at the handler; the context field and the gate
agree because both read the same fact, and they authorize nothing. A
retired administrator's still-live envelope therefore reads `administrator:
false` and is refused the roster, and a disabled actor's envelope reads
until expiry — the bounded envelope is the authority `disable` deliberately
leaves in place.

Operation-administrator standing is deliberately absent from the context:
it is hat-derived (the worn hat carries a configure action or its role is
declared in `adminRoles`) and the envelope already projects it as
configuration reach. The one residue — an `adminRoles` role that carries no
configure action is envelope-invisible — is a deployment rule, not a seam
fact: every declared admin role carries a configure action.

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

Team request, admission, update, and retirement are implemented separately;
their placement and revocation rules are in [teams.md](teams.md). Site
placement is approved through operation admission. Re-enabling a disabled
actor remains outside this surface, so offboarding stays terminal.
