# v2.1.0 and cloudflare-v0.3.2 — releases and acceptance

**Status (2026-10-25):** root `v2.0.0` and Cloudflare `cloudflare-v0.3.1`
are released. `cloudflare-v0.3.1` is deployed to
`reporting-stream-authority` and active at 100%; Quartermaster's ops
documentation reports the binding smoke, the schema-2 → schema-4 restore,
and the routing-facts backfill passed. The acceptance record has not been
confirmed in the relay yet; no pin moves before it is.
`cloudflare-v0.3.0` remains the routing tag.

Main is well past the root tag. The portable surface is additive since
`v2.0.0` — interface 2 and envelope 1 do not move — so the next root tag is
`v2.1.0` (minor). The deployed `cloudflare-v0.3.1` lacks the R5
exchange hardening and the cross-coordinator corrections on main; the next
Cloudflare tag is `cloudflare-v0.3.2` (patch).

## Root `v2.1.0`

- [ ] Cut from the pushed, clean `main` with `bin/release minor --push`,
      after this reconciliation is committed and pushed. The release commit
      bumps `package.json` and `dist/`; the README version table and the
      additive migration note are already updated.
- [ ] Tell QM in the relay, without requiring a pin move: the additions are
      `defineWorld`/`WorldFixture`/`WorldDefinition`, `assembleAccessClaims`,
      four `NeutralAccess` accessors (`memberTeamIds`, `authenticatedWith`,
      `authenticatedAt`, `actor`), `isFailed` from `access`, and
      `IssuerInterfaceVersion`; routing facts are already served by
      `cloudflare-v0.3.x`; the key-set parser tolerates unknown fields.
      Envelope format 1 crosses the pin in both directions. Compact the
      outbox's oldest completed sections before appending; it sits near the
      25 KB cap.

## `cloudflare-v0.3.2`

- [ ] QM confirms the acceptance record in the relay and answers whether the
      consumer login uses ES256 or RS256. `v0.3.1` verifies ES256 only.
- [ ] Cut `bin/release --package cloudflare patch --push` from `main` after
      the root release. The tag is new and annotated; `cloudflare-v0.3.1` is
      never retagged.
- [ ] Rick deploys through the host's ops porcelain (`candidate` →
      `release`) and runs the binding smoke with a fresh fixture. The
      dedicated smoke actor is disabled; the old fixture cannot be reused.
- [ ] Move the live-tag references after the deploy: `docs/cloudflare.md`,
      `docs/binding-conformance.md`, the deployment paragraph in
      `docs/publishing.md`, `docs/positioning.md`, `docs/from_ldap.md`, and
      `docs/migration-v2.md` ("the next tag"). The login claim changes from
      "ES256 only" to both algorithms.

## Already answered

- QM asked for the disabled/stale-projection refresh refusal in
  `docs/binding-conformance.md`. It is documented there: the smoke's
  disabled-actor step and the "Stale projection" paragraph both require
  refresh to fail `not-admitted` without issuing a replacement. They may
  have written before seeing the commit; the document needs no change.

## Acceptance record

- [ ] Quartermaster records acceptance and confirms it in the relay. No pin
      moves before it is.
- [ ] Close this plan, update `plans/README.md`, and post the result in the
      relay.

## Not in this plan

The source break, migration note, the 2.0/0.3.1 release tags, CI, and
publishing docs are done. No retag and no re-release belong here. Registry,
DNS, and tenant work stay deferred until `quartermaster-tenant` exists;
routing facts are authority-owned and unchanged in this release.

No secrets or customer data in this plan.
