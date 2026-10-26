# v0.3.2 deploy and the 2.1 acceptance record

**Status (2026-10-25, after the cuts):** root `v2.1.0` (`dc4355a`) and
Cloudflare `cloudflare-v0.3.2` (`d16df18`) are released as annotated tags on
Codeberg and the GitHub mirror; `bin/check-version` matches both manifests.
`cloudflare-v0.3.1` is still the live deployment
(`reporting-stream-authority`, 100%). Quartermaster's ops documentation
reports the v0.3.1 binding smoke, schema-2 → schema-4 restore, and
routing-facts backfill passed. The acceptance record is not confirmed in the
relay yet, and the consumer login algorithm is still unknown. The outbound
relay note announcing both tags is posted. `cloudflare-v0.3.0` remains the
routing tag.

## Open

- [ ] Quartermaster confirms the `cloudflare-v0.3.1` acceptance record and
      answers whether the consumer login uses ES256 or RS256. The answer no
      longer gates the fix — `v0.3.2` verifies both — but it says whether the
      v0.3.1 exchange was usable.
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
- [ ] Quartermaster records acceptance for `v0.3.2` after the fresh smoke; no
      root pin move is required for `v2.1.0` (additive).
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
  4 is unchanged. It was cut before QM answered the algorithm question; it
  verifies both ES256 and RS256, so that answer is no longer a gate.
- QM's disabled/stale-projection refresh ask is documented in
  `docs/binding-conformance.md`: the smoke's disabled-actor step and the
  "Stale projection" paragraph require `not-admitted` with no replacement
  envelope. It is not workerd-only.

## Not in this plan

No retag and no re-release; `cloudflare-v0.3.1` is never moved. Registry, DNS,
and tenant work stay deferred until `quartermaster-tenant` exists; routing
facts are authority-owned and unchanged in this release.

No secrets or customer data in this plan.
