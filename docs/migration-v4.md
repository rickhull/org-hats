# Migrating from org-hats v3 to v4

**Status:** `4.0.0` crosses this break; `3.9.0` is the last 3.x release. The
envelope format does not move. This note records the one delta a consumer
crosses and how to cross it. The architecture itself is unchanged — see
[authority_redesign.md](authority_redesign.md).

## 3.x → 4.0

### The interface version is 4

`AUTHORITY_INTERFACE_VERSION` moves from 3 to 4, so a 3.x caller gets
`wrong-interface-version` before its command body is interpreted. Send 4.

### `displayName` becomes `longName` on the three paired entities

An `Organization`, an `Operation`, and a `Site` rename `displayName` to
`longName`. These are the three entities that carry a `shortName`, added in
3.x: once both halves exist, `displayName` beside `shortName` is lopsided,
because a short name is also a display name. The pair is now `longName` and
`shortName`, and each names a half.

**An `Actor` and a `Team` keep `displayName`, and this is deliberate.** They
carry a single label with no counterpart: an actor's comes from the OIDC
`name` claim, and a team's is already the short form. `longName` means the
long half of a pair, so on either of them it would be a false name. Two
words, two meanings — `longName` is a half, `displayName` is a whole. If
teams later acquire a `shortName`, a team's label becomes `longName` with it.

What moves:

| Surface | 3.x | 4.0 |
| --- | --- | --- |
| `Organization`, `Operation`, `Site` | `displayName` | `longName` |
| Organization bootstrap body | `displayName` | `longName` |
| Operation bootstrap body, and each `sites[]` entry | `displayName` | `longName` |
| Context read | `organizationDisplayName`, `operationDisplayName` | `organizationLongName`, `operationLongName` |
| `Actor`, `Team`, `PrincipalEvidence` | `displayName` | unchanged |
| Team commands (`request-team`, `update-team`) | `displayName` | unchanged |
| Actor commands (`create-actor`, `update-actor`) | `displayName` | unchanged |
| `HatSummary.targetDisplayName` | `targetDisplayName` | unchanged |

`targetDisplayName` keeps its name on purpose. A grant target is a team or a
site, so the field carries a team's `displayName` or a site's `longName`: it
names the genus over both, not the long half of a site's pair.

### No schema version moves, and no export is stranded

The coordinators' SQL column stays `display_name` in all five tables. The
wire name moved; the column deliberately did not, so the operation
coordinator stays at schema 6 and the organization coordinator at schema 3,
and **every export taken before this release restores unchanged.**

This is load-bearing rather than lazy. `restoreTables` inserts by current
column name and fills what a snapshot lacks with null, so renaming the column
would make every earlier export restore with the long name silently NULL — no
error, on the most destructive privileged act in the system. A reader meeting
`longName: row["display_name"]` in the coordinators is seeing that decision,
not an oversight.

### Envelopes keep reading across the break

`ACCESS_ENVELOPE_VERSION` stays 1, and no live session drops. No claim
carries a display label of any kind, so the rename cannot reach an issued
envelope. Verification gates on the envelope version pair — `format`, the
envelope's `v`, and the claims' own `v` — and never on the claims'
`interfaceVersion`, which is issuer provenance. A 3.x-issued envelope keeps
verifying on a 4.x runtime.

### Deploy order: the consumer release goes first

**Do not deploy a 4.x authority in front of a consumer that still sends
`displayName` in its bootstrap bodies.** The field is optional and the
boundary parser reads `longName`, so a body carrying the old name is not
refused — it bootstraps an organization, operation, or site with **no long
name at all**, silently. A rename of an optional field fails quiet, not loud.

The order is: the consumer ships the release that sends `longName` and reads
`organizationLongName`/`operationLongName`, pinned to 4.x, and the authority
deploy follows. Nothing in 4.x needs to be live for that release to be built
and tested against the tag.

### Crossing it

One mechanical pass, guarded by the compiler for a typed consumer:

1. Send `4` as the interface version.
2. Rename `displayName` to `longName` where the entity is an organization,
   operation, or site — in bootstrap bodies and in anything reading a
   snapshot's `organizations`, `operations`, or `sites`.
3. Rename the two context-read fields.
4. Leave every actor and team `displayName` alone. A blanket
   find-and-replace is the one way to get this wrong.
