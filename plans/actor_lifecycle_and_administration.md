# Actor lifecycle and organization-owned administration

**Status:** design pending — five contract decisions below need Rick's answer
before executable types change. This is Tier 2, slice 1: Quartermaster's asks
4 and 6. Team lifecycle and site delegation are explicitly out of scope.

## Goal

Complete organization authority's ownership of its own roster and
administration:

- an organization administrator can create an actor in their organization and
  update its display name, so a roster can be maintained without a release or
  an operator;
- `orgAdmins` moves from engine configuration into organization state, so an
  organization can appoint and retire its own administrators through the
  portable commands, under the last-administrator rule Quartermaster recorded.

The boundary is unchanged: no provider address, no evidence, no unverified
principal link, and no grant enters through any of these commands. Activation
still owns the link; a created actor is enabled and unlinked until a claim is
accepted.

## Settled boundaries

- Every new command is an organization command authorized by
  `fresh-evidence` from an `adminOfOrganization`. An access envelope is
  refused, as for `unlink-principal`: a roster write is organization-scoped,
  not operation-scoped.
- `disable-actor` remains the offboarding act and needs no change.
  `unlink-principal` remains recovery. Neither collapses into create, rename,
  or retirement.
- The first administrator is still an operator/bootstrap act. Mutability does
  not have to create its own origin.
- At rest an organization has at least one administrator; an enabled but
  unclaimed administrator is a normal resting state. The **transition**
  precondition is stricter: retirement is refused unless another
  administrator remains **enabled and principal-linked** — the “usable”
  successor. Appointing an unclaimed actor is allowed and does not satisfy
  that precondition.
- Idempotency uses the existing claim table: the roster fact, the claim, and
  the audit row commit together; a denied command never poisons its key.

## Decisions needed

Recommended defaults are given; each is a contract decision.

1. **Actor id ownership.** `create-actor` mints an opaque
   `actor-<hex>` id and returns it, rather than accepting a caller-chosen id.
   Authority owns identity; a caller-chosen id invites collisions and
   guessing at another organization's roster. Caller supplies only an
   optional display name.
2. **Rename surface.** `update-actor` carries the optional `displayName`,
   authorized by `adminOfOrganization`. Display names already flow into
   `AuthorityContext`, so authority owns the field. Setting and clearing are
   both explicit; an absent field means “no change”.
3. **A9 migration.** `orgAdmins` becomes organization state. Bootstrap seeds
   it from the configured record; after that, `/config` no longer writes
   administrator standing for a bootstrapped organization. The portable
   commands are `appoint-administrator` and `retire-administrator`, and
   `adminOfOrganization` resolves from organization state, not engine
   configuration. `adminRoles` (operation administration) stays configuration:
   A9's ask is organization self-administration, not operation titles.
4. **Appointment preconditions.** The target actor must exist in the same
   organization and be enabled. An unclaimed actor may be appointed.
   Appointment is idempotent. Retiring a non-administrator is idempotent and
   changes nothing.
5. **Retirement precondition.** Refuse if no other administrator remains
   enabled **and** principal-linked. Name the failure `denied` with a detail
   in the core's vocabulary, and never key the refusal on `detail` at the
   host. A sole administrator must appoint and claim a successor before
   retiring.

If any answer differs, amend it here before task 1 lands.

## Work plan

### 1. Amend the contract and record the rules

Amend A9 and A10 in `specs/authority.md`: administration is declared, but
declared in organization data; evidence remains no roster; link entry is
still bootstrap, activation acceptance, or the typed ops surface. Record
create/rename/appoint/retire authorizations, idempotency, audit facts, and
the usable-successor rule in the durable docs (`docs/activation.md` grows a
roster section, or a new `docs/roster.md` carries it).

**Done when:** the five decisions above are written as invariants, not as
plan text, and no rule lives only in the relay.

**Evidence:** inspection of changed Markdown; no application check applies.

### 2. Land the portable commands and state

Add `create-actor`, `update-actor`, `appoint-administrator`, and
`retire-administrator` to `AuthorityCommand`; move administrator standing
into `OrganizationState`; seed it from configuration in the reference engine.
Keep every mutation atomic with its claim and audit row.

**Likely paths:** `src/authority/types.ts`, `src/authority/state.ts`,
`src/authority/organization.ts`, `src/authority/engine.ts`,
`tests/activation.test.ts` or a new roster suite.

**Done when:**

- Portable tests cover create, duplicate/minted ids, rename set and clear,
  appoint enabled/disabled/unknown actors, idempotent retries, and every
  retirement refusal including the sole-administrator and
  enabled-but-unclaimed-successor cases.
- Disabling an administrator does not confer or remove standing by itself;
  it only makes them unusable for the retirement precondition.
- Export/restore carries administrator standing with the organization.

**Evidence:** focused roster tests, `pnpm check`, `pnpm build`; tracked
`dist/` matches `src/`.

### 3. Persist and expose in the Cloudflare adapter

Add schema migration for organization administrator standing, seed it from
bootstrap, and route the four commands through fresh-evidence authorization.
Retire administrator writes from the operator `/config` path for bootstrapped
organizations without losing the first-administrator bootstrap.

**Likely paths:** `packages/cloudflare/src/organization.ts`,
`packages/cloudflare/src/state.ts`, `packages/cloudflare/src/runtime.ts`,
`packages/cloudflare/src/index.ts`, `packages/cloudflare/test/`.

**Done when:** upgrade from the current schema preserves standing; bootstrap
seeds it; export/restore round-trips it; the commands refuse envelopes and
non-administrators; no operator path can silently change an organization's
administrators after bootstrap.

**Evidence:** focused Cloudflare organization, state, and runtime suites.

### 4. Add conformance cases and close documentation

Add `OH-ROSTER-01..` (or `OH-ADMIN-*`) cases to the shared inventory, with
the invitee fixture carrying a second administrator and an unclaimed actor.
Update `docs/inventory.md`, the tutorial/walkthrough where they tell roster
stories, and the A9 text that names `/config`.

**Done when:** the new commands run through the same inventory against both
runtimes; every case has an inventory row; the sole-administrator lockout is
shown refused by a shipped case.

**Evidence:** `pnpm check`, `pnpm check:cloudflare`, `bin/check-dist`, and
`pnpm verify` with tracked `dist/`.

## Not in this plan

- **Team lifecycle.** QM's ask 5. It waits for two settled facts: retirement's
  effects on grants and refresh authority, and the site-fielding constraint
  (which entitlement lets an organization field a team at a site). The
  operation-administrator approval of a new team is QM's accepted first
  answer, but the portable write shape is not specified.
- **Site delegation.** QM withdrew that ask; it needs a model decision of its
  own.
- **Re-enabling a disabled actor.** Not asked for; offboarding stays terminal
  until a requirement says otherwise.

## Risks

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Administrator moves from config into state without a migration | A bootstrapped organization loses its administrator and locks out | Seed from the configured record in the same migration; export/restore test |
| Retirement precondition checks “enabled” only | Enabled-but-unclaimed successor leaves an unadministrable organization | Require enabled and principal-linked; case in the inventory |
| `create-actor` accepts a caller id | Roster probing or collisions across organizations | Mint the id; caller supplies only display name |
| `/config` keeps writing administrators | A9 is only nominal; operator path bypasses the command | Retire administrator writes for bootstrapped organizations |
| Display name becomes identity | Hosts compare names as identity | Document display name as presentation only; links stay by id |
