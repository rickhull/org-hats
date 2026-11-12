# Migrating from org-hats v3 to v4

**Status:** `4.0.0` crosses this break; `3.9.0` is the last 3.x release. The
envelope format does not move. This note records the deltas a consumer
crosses and how to cross them. The architecture itself is unchanged — see
[authority_redesign.md](authority_redesign.md).

## 3.x → 4.0

### The interface version is 4

`AUTHORITY_INTERFACE_VERSION` moves from 3 to 4, so a 3.x caller gets
`wrong-interface-version` before its command body is interpreted. Send 4.

### `displayName` becomes `longName` on the four paired entities

An `Organization`, an `Operation`, a `Site`, and a `Team` rename
`displayName` to `longName`, and a `Team` gains `shortName`. These are the
four entities that carry a pair: once both halves exist, `displayName` beside
`shortName` is lopsided, because a short name is also a display name. The pair
is `longName` and `shortName`, and each names a half.

A team earned the pair because its label is rendered more times per page, and
in denser slots, than any other — the short form is what a tight slot can
fit, and it is not derivable from the long one.

**An `Actor` keeps `displayName`, and this is deliberate.** The organization
owns the actor profile label and can set it through actor commands. Principal
evidence may also carry a provider-supplied display name. The model does not
define a separate short form for a person. `longName` means the long half of a
pair; `displayName` names the whole label.

What moves:

| Surface | 3.x | 4.0 |
| --- | --- | --- |
| `Organization`, `Operation`, `Site`, `Team` | `displayName` | `longName` |
| `Team` | — | `shortName` added |
| Organization bootstrap body | `displayName` | `longName` |
| Operation bootstrap body, and each `sites[]` and `teams[]` entry | `displayName` | `longName` (+ optional `shortName`) |
| `request-team` | `displayName?` | `longName?`, `shortName?` |
| `update-team` | `displayName: string \| null` | `longName` **and** `shortName`, both required |
| Roster read's `RosterTeamEntry` | `displayName?` | `longName?`, `shortName?` |
| Context read | `organizationDisplayName`, `operationDisplayName` | `organizationLongName`, `operationLongName` |
| `Actor`, `PrincipalEvidence` | `displayName` | unchanged |
| Actor commands (`create-actor`, `update-actor`) | `displayName` | unchanged |
| `HatSummary.targetDisplayName` | `targetDisplayName` | unchanged |

`targetDisplayName` keeps its name on purpose. A grant target is a team or a
site, so the field carries either one's `longName`: it names the genus over
both, not the long half of either pair. It never composes the short form — a
host picks the half its slot can fit.

### `update-team` writes both labels, and an omitted field clears one

`update-team` takes `longName` and `shortName`, **both required**, and `null`
clears one. There is no absent-means-unchanged: a body that omits a label
clears it.

This is the consumer's choice, taken knowingly. Its editing surface is a
full-form page that submits every field, so a field-scoped shape would buy
nothing; and the remedy it would actually want if concurrent administration
became real is optimistic concurrency — a roster version, refuse-if-stale —
which no command shape provides. Buying half that fix in the wire was the
worse trade.

**The consequence for any other client:** a form that renders only the long
name silently clears the short one on every submit. Ship the input with the
field.

### One additive column, and no export is stranded

The coordinators' long-name column stays `display_name` in all five tables.
The wire name moved; the column deliberately did not. The organization
coordinator stays at **schema 3**; the operation coordinator moves to
**schema 7** for one additive `short_name` column on `teams`, the same shape
as schema 6 added for the operation and its sites. **Every export taken
before this release restores unchanged** — a pre-7 snapshot has no team short
name and restores with it null, which is what it was.

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
refused — it bootstraps an organization, operation, site, or team with **no
long name at all**, silently. A rename of an optional field fails quiet, not
loud. `packages/cloudflare/test/operation.test.ts` pins that behavior, so
this warning cannot drift from the code.

The order is: the consumer ships the release that sends `longName` and reads
`organizationLongName`/`operationLongName`, pinned to 4.x, and the authority
deploy follows. Nothing in 4.x needs to be live for that release to be built
and tested against the tag.

### Crossing it

One mechanical pass, guarded by the compiler for a typed consumer:

1. Send `4` as the interface version.
2. Rename `displayName` to `longName` where the entity is an organization,
   operation, site, or team — in bootstrap bodies and in anything reading a
   snapshot's `organizations`, `operations`, `sites`, or `teams`, including
   the roster read's team entries.
3. Rename the two context-read fields.
4. Send both labels in `update-team`, and add the short-name input to any
   team form before shipping it: with both-required, a form that omits the
   field clears it on every submit.
5. Leave every actor `displayName` alone — `Actor`, `PrincipalEvidence`,
   `create-actor`, `update-actor`, and the context read's `actor.displayName`.
   A blanket find-and-replace is the one way to get this wrong.
