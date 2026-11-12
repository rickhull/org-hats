# Operation wipe and scoped org cleanup

## Work

The consumer's greater-delete contract (their `specs/operation_lifecycle.md`,
decision in their `docs/decisions.md`) needs two additive operator verbs on
the Cloudflare package:

1. `POST /ops/operation/delete` — true wipe of the operation coordinator:
   every operation-owned table (audit, replay claims, outbox included), the
   `org_actors` projection, and the roster stamps. No audit row is written —
   its absence is the contract; the wipe's trace lives on the consumer side.
   Retry-safe: `deleted: true` whether or not anything existed. The body
   names the `operationId`; a mismatched target refuses before any mutation,
   including on retries. Schema-version meta survives (migration state, not
   operation facts).
2. `POST /ops/organization/forget-operation` — scoped organization-side
   cleanup for one operation: that operation's `invitations` rows, outbox
   rows targeting it, idempotency claims whose payload names it, and audit
   facts referencing it. Actors, principal links, administrator standing,
   unrelated history, and other operations survive. No audit row written;
   idempotent.

Export after a wipe reports explicit absence — `{ absent: true, coordinator,
requested id }` — so a wiped tree cannot masquerade as an empty-but-live
export. A late roster/acceptance push must not recreate operation facts
after the wipe: `/intake` refuses on an unbootstrapped coordinator instead
of repopulating `org_actors` and audit.

## Decisions recorded

- The audit exception is deliberate: the authority's audit contract is
  "within a live operation." A wiped operation keeps no trace that it
  existed; the consumer verifies and reports the destructive act but
  promises no permanent tombstone either. Recorded in
  `docs/authority_redesign.md` (audit section) and `docs/cloudflare.md`.
- No new destructive power: `/ops/restore` already replaces the audit table
  wholesale; delete is the same authority stated honestly.

## Done when

- The DO-level and ops-level tests cover: mismatched-target refusal (no
  mutation), wipe → absence in export, idempotent retry with no audit row,
  re-bootstrap on the wiped tree, `schema_version` preserved, late
  roster/acceptance intake refused without repopulation, org-side scoped
  cleanup preserving everything not naming the operation, and org-side
  idempotent retry.
- The tests were proven red against the pre-change tree (unknown route /
  snapshot export) before the implementation landed.
- `pnpm check` and `pnpm check:cloudflare` pass; `docs/authority_redesign.md`
  and `docs/cloudflare.md` carry the boundary.

## Evidence

- Test file: `packages/cloudflare/test/wipe.test.ts` (red-first).
- The relay thread with Quartermaster: `notes/to-quartermaster.md` ("Wipe
  verb…" and the follow-up after their answers).
