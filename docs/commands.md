# The authority command table

One row per `AuthorityCommand` kind. `src/authority/commands.ts` is the
machine-readable source of owner, scope, authorization mode, and required
standing; `tests/docs.test.ts` checks this table against it. The effect
column is the behavior the coordinators and suites implement.

- **Owner** — the coordinator that receives the command:
  `operation`, `organization`, or `by-participation`.
- **Scope** — `operation` means the command binds to an operation id;
  `organization` means it is organization-scoped and does not bind.
- **Authorization** — `either` accepts an access envelope or fresh evidence;
  `fresh` accepts only fresh evidence; `ignored` means the shell
  authorization is not read (the request's own evidence is the request).
- **Standing** — the administrator or ownership check the handler applies.
  `by-participation` means the side named by the command's `by` field.

**The selected hat is never an authority command's authorization.** A hat
carries actions for decisions and presentation; it does not make its wearer
an administrator or authorize a command. `select-hat` is authorized by
owning the grant or administering the operation, not by the hat's action
list.

| Kind | Owner | Scope | Authorization | Required standing | Effect |
| --- | --- | --- | --- | --- | --- |
| `request-access` | operation | operation | ignored | none | Records an access request for the evidence's actor. Asking is not admission. |
| `participation-invite` | operation | operation | either | operation-admin | Invites an organization; creates the pending participation and the invitation message. |
| `participation-accept` | organization | operation | either | organization-admin | Accepts the organization's pending invitation; queues the operation-side activation. |
| `participation-revoke` | by-participation | operation | either | by-participation | Revokes the named side's participation; stops new issuance and revokes its refresh records. |
| `admit` | operation | operation | either | operation-admin | Admits an actor named by an access request. |
| `grant-hat` | operation | operation | either | operation-admin | Grants a role on a team or site target; an optional primary flag clears the actor's other primaries. |
| `revoke-grant` | operation | operation | either | operation-admin | Revokes a grant and the refresh records that stood on it. |
| `select-hat` | operation | operation | either | operation-admin-or-owner | Sets a wearable grant as the actor's primary hat; the actor may select their own grant. |
| `request-team` | operation | operation | fresh | organization-admin | Requests a team at a site; the team starts pending. |
| `admit-team` | operation | operation | either | operation-admin | Activates a pending team; a retired team is refused. |
| `update-team` | operation | operation | fresh | organization-admin | Updates the owning organization's team display name; names are presentation only. |
| `retire-team` | operation | operation | either | operation-admin-or-org-owner | Retires a team; revokes its grants and the affected refresh records. The owning organization needs fresh evidence. |
| `disable-actor` | organization | organization | either | organization-admin | Disables an actor, revokes refresh records, and pushes the disable and roster image. |
| `unlink-principal` | organization | organization | fresh | organization-admin | Removes the actor's principal links; later refresh fails closed. |
| `revoke-activation` | organization | organization | fresh | organization-admin | Revokes a pending activation request. |
| `create-actor` | organization | organization | fresh | organization-admin | Creates an enabled, unlinked actor. |
| `update-actor` | organization | organization | fresh | organization-admin | Sets or clears an actor's display name. |
| `appoint-administrator` | organization | organization | fresh | organization-admin | Appoints an enabled actor as an organization administrator. |
| `retire-administrator` | organization | organization | fresh | organization-admin | Retires an administrator only while another usable, linked administrator remains. |
