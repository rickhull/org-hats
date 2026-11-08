# Preserve administrator retirement across organization re-bootstrap

## Problem and contract

A9 and `docs/roster.md` make organization administrator standing organization
data after its initial seed. Cloudflare's organization bootstrap currently
executes `INSERT OR IGNORE INTO org_admins` on every call. Retirement deletes
the administrator row, so an old bootstrap payload can insert it again.
This is a source-confirmed enforcement gap; no live coordinator was changed
or probed during the documentation reconciliation.

Relevant source is `packages/cloudflare/src/organization.ts`: bootstrap
seeds `org_admins`, while `retireAdministrator` removes it. The existing
`packages/cloudflare/test/organization.test.ts` re-bootstrap case covers
rename and disabled state, but not retired standing. The in-memory engine
seeds standing only when a fresh engine is constructed; it has no public
re-bootstrap operation.

## Next action

Write a test that bootstraps an administrator and linked successor, appoints
the successor, retires the original, reapplies the original bootstrap, and
asserts that the original remains denied while the successor still
administers. Prove it red against the current writer before fixing it.

Make repeated bootstrap respect organization-owned standing without
weakening A9 or treating every bootstrap as a new organization. Initial
standing must still seed successfully; actor additions, names, disabled
state, principal binding, and the successor rule retain their documented
behavior. Review the treatment of new administrator seed entries on an
already-created organization explicitly; do not quietly add an operator
appointment path under this bugfix. Restore remains an explicit replacement
path with its own audit semantics.

## Done when and closing evidence

- The regression is red against the defect and green with the repair.
- Initial bootstrap still seeds standing; rename/disable preservation and
  administrator succession cases remain green.
- `pnpm check` and `pnpm check:cloudflare` pass.
- `docs/roster.md` and A9 name the actual enforcement and remove the known
  gap; the source comment no longer overstates what its writer preserves.
- The consumer relay states the repair and any bootstrap input consequence
  before the next runtime release. Do not claim it is deployed from source
  or tag evidence alone.

Remove this plan when the repair lands. The recommended release order is to
repair this standing gap and reconcile the consumer handoff before the next
runtime release containing the additive operation preview. The preview
remains absent from `cloudflare-v0.13.1`.
