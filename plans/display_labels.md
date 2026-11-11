# Display labels: `shortName` now, `shortName`/`longName` at the next break

An entity carries two display labels, because the short form is not computable
from the long one: "Porsche Experience Centers" to `PEC` takes knowledge, and
truncation is not abbreviation.  Both are presentation only — volunteered,
bootstrap-set, no uniqueness, never routing — and neither is read by a
decision.

Step 1 has landed; the durable statement is `docs/lexicon.md` ("Display
label") and `docs/migration-v3.md` ("3.x additive").  Step 2 is what keeps
this plan open.

## The field is `shortName`, not `handle`

`handle` is taken: it is the opaque rotating refresh credential in
`src/contract.ts`.  And a short label like `PEC-ATL` sits beside
`Operation.slug` and `Site.path`, which *are* the routing facts with one
writer each; a human-editable near-twin named like an identifier invites
someone to treat it as the address.  The consumer keeps `handle` as its
operator-facing lexicon word.

## Step 1 — additive `shortName` (interface stays 3) — **landed**

Optional `shortName` beside `displayName` on organization, operation, and
site.  Additive changes do not move the authority interface version, so
interface 3 and envelope 1 stayed put; the release is a minor.

**Closed by:** `Organization`, `Operation`, and `Site` carry the field through
`snapshotOf`; the operation coordinator is at schema 6 and the organization
coordinator at schema 3, each by one additive `short_name` column, parsed at
the HTTP boundary and carried in the export table specs.  The evidence is two
tests proven red first — `tests/engine.test.ts` ("the short name is a second
display label") and `packages/cloudflare/test/operation.test.ts` ("carries the
short display label through bootstrap, export, and restore") — plus `pnpm
check` and `pnpm check:cloudflare` clean.

**No validator, by symmetry.**  `displayNameFailure` runs on the command
paths that write a display name; bootstrap display names are unvalidated
today, and `shortName` has no command path at all.  When edit commands arrive,
they validate both labels at that boundary — that is where the rule belongs.

**Restore range, widened as a consequence.**  The organization coordinator
accepted only its current schema or schema 1 on restore, so bumping it to 3
would have stranded every schema-2 export.  It now accepts the whole shipped
range, the operation side's rule.  A schema bump must not strand an export
taken before it.

## What step 1 deliberately left out

**No edit commands.**  Organization, operation, and site display names are
bootstrap-only — there is no `update-organization`, `update-operation`, or
`update-site` command, and there was none for `displayName` either.
Editability means three new command kinds with authorization and audit rows;
the consumer deferred it until something actually edits the field.  Do not
build them speculatively.

**No team or actor short name.**  Settled with the consumer: a team's
`displayName` is already short, and an actor's comes from the OIDC `name`
claim.  Either is additive again on the same terms.  We do expect a team to
acquire its own short-name case — a team label is the one repeated most times
per page, in the densest slots, and a team is the only one of these objects a
non-administrator requests into existence — and both sides have the
reservation on record, so it is not a reopened decision when a dense view
makes the case.

**Not in `modelSnapshot`.**  The claims path carries only what a decision
needs; it already omits the operation's `displayName`, and a presentation
field has no business there.

## Step 2 — rename `displayName` to `longName` (interface 4)

`displayName` + `shortName` is lopsided once both exist: the short name is
also a display name.  The pair `shortName`/`longName` is self-describing, and
it removes the genus/species confusion between "display label" and "display
name".

This is a breaking interface change — 482 occurrences across 49 files, the
command surface, and the result shapes — so it rides the next deliberate
break with a migration note and a paired consumer rollout.  `AGENTS.md`
permits it as a change re-reviewed with the consumer, not as an additive one.
The envelope does not move: `displayName` appears nowhere in the claims, so no
live session drops.

**The SQL column does not move, and this is the decision, not an omission.**
The rename is two independent changes: the wire field, which the consumer
sees, and the column `display_name`, which it does not — `coordinatorPresent`
reads only `coordinator`, `tables`, and `<coordinator>_id` from `/ops/export`,
so column names never cross the boundary.  Renaming the column buys nothing
and carries the one real hazard here: `restoreTables` inserts by current
column name and fills what is absent with null, so every export at schema 6
or earlier would restore with the long name silently NULL — no error, on the
most destructive privileged act in the system.  The column stays
`display_name`; the row-mapping sites carry the mismatch and a comment saying
the column name is historical.  An earlier revision of this plan prescribed an
add/backfill/drop migration; it is withdrawn.

**An alias is not the cheaper path.**  Accepting both field names on bootstrap
writes is easy, but emitting both on reads makes an alias indistinguishable
from a second fact, which is the long/short confusion this rename exists to
remove.  The break is deferred, not avoided: retiring `displayName` later is
still interface 4.  Writes can be additive here; reads cannot.

**Open with the consumer: three entities or five.**  Only organization,
operation, and site carry a short counterpart.  `longName` means the long half
of a pair, so on an actor it is wrong — that label is the OIDC `name` claim —
and on a team it is worse, because a team's label is already the short form.
The proposal on the table is to rename only where the pair exists and leave
`Actor.displayName` and `Team.displayName` alone, with a team's crossing over
when it acquires its own short name.  Settle this before the sweep; it decides
the scope.

**Done when:** `AUTHORITY_INTERFACE_VERSION` is 4, `docs/migration-v4.md`
records the rename, the three-or-five scope is settled, and the consumer has
crossed it.

**Trigger:** the next break that moves the interface version for another
reason.  The consumer declined taking it early and has recorded the same
target on its side; do not move the version for this alone.
