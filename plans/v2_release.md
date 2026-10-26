# v0.3.2 deploy and the 2.1 acceptance record

**Status (2026-10-25, after QM's reply):** root `v2.1.0` (`dc4355a`) and
Cloudflare `cloudflare-v0.3.2` (`d16df18`) are released as annotated tags on
Codeberg and the GitHub mirror; `bin/check-version` matches both manifests.
`cloudflare-v0.3.1` is still the live deployment
(`reporting-stream-authority`, 100%) and is **accepted**: QM records the
acceptance at `abfac31` in its `specs/login.md`, `plans/phase1.md` steps 1-3,
and `docs/deploy.md`. The six-group binding smoke (including the disabled/
stale-projection refresh), the schema-2 → schema-4 restore, and the
routing-facts backfill passed. The consumer login is **ES256** on the only
path QM exercises; the production provider is unchosen. QM keeps its pin at
`v2.0.0` — `v2.1.0` is additive and nothing in its current slice needs the new
surface. The outbound relay note announcing both tags, and the reply to QM,
are posted. `cloudflare-v0.3.0` remains the routing tag.

## Open

- [ ] Rick deploys `cloudflare-v0.3.2` through the host's ops porcelain
      (`candidate` → `release`) and runs the binding smoke with a fresh
      fixture. The dedicated smoke actor is disabled; the old fixture cannot
      be reused.
- [ ] Move the live-deployment references after the deploy:
      `docs/cloudflare.md`, `docs/binding-conformance.md`, the deployment
      paragraph in `docs/publishing.md`, and the "live `cloudflare-v0.3.1`"
      limits in `docs/positioning.md` and `docs/from_ldap.md`. The login
      claim changes from "ES256 only, pending the deploy" to the deployed
      `v0.3.2` verifying both.
- [ ] QM runs the binding smoke with a fresh fixture after the deploy and
      records `v0.3.2` acceptance, before any tenant session depends on it.
      Use the gate handoff in [`docs/agent_mesh.md`](../docs/agent_mesh.md):
      leave the relay note once the tag is live, send one gate wake, QM runs
      the fresh-fixture smoke in one gate turn and records acceptance, then
      returns the conch. No wake before the deploy. If the smoke fails, QM
      stops and reports rather than amending the acceptance.
- [ ] Close this plan, update `plans/README.md`, and post the result in the
      relay.

## What shipped

- `v2.1.0` is additive: `defineWorld`/`WorldFixture`/`WorldDefinition`,
  `assembleAccessClaims`, four `NeutralAccess` accessors, `isFailed` from
  `access`, `IssuerInterfaceVersion`, operation routing facts in the model,
  and unknown key-set fields tolerated. Interface 2 and envelope 1 are
  unchanged.
- `cloudflare-v0.3.2` carries the R5 RFC 8414/7515/7519/7636 exchange
  hardening and the runtime cross-coordinator corrections; operation schema
  4 is unchanged. It verifies both ES256 and RS256; QM's ES256 path needs no
  algorithm change, and a future RS256 production provider does.
- QM's disabled/stale-projection refresh ask is documented in
  `docs/binding-conformance.md`: the smoke's disabled-actor step and the
  "Stale projection" paragraph require `not-admitted` with no replacement
  envelope. It is not workerd-only.

## Not in this plan

No retag and no re-release; `cloudflare-v0.3.1` is never moved. Registry, DNS,
and tenant work stay deferred until `quartermaster-tenant` exists; routing
facts are authority-owned and unchanged in this release.

No secrets or customer data in this plan.
