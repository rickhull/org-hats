# v0.3.2 deploy and the 2.1 acceptance record

**Status (2026-10-26, deployed):** `cloudflare-v0.3.2` is live at 100% on
`reporting-stream-authority`: active Worker Version
`f8a0e2df-6f03-4bb6-95b7-21cac7b8c558`, tag `d16df18`, signing key
`authority-2026-10` unchanged. The preflight snapshot is
`~/.local/state/qm/authority/cloudflare-v0.3.2-2026-10-26T01-41-09-257Z-02e4a43c/`;
both operations report schema 4 and `routingFactsComplete: true`. The live
verification key set is the same single Ed25519 key. `cloudflare-v0.3.1`
remains the accepted previous tag and the rollback target.

QM's fresh-fixture binding smoke and the `v0.3.2` acceptance record are the
only remaining gates. The old smoke fixture is spent: `org-authority-smoke`'s
actor is disabled. The relay note and the one gate wake are sent; QM owns
preparing fresh ids, configuring the directory, bootstrapping, and running
the smoke.

## Open

- [ ] QM prepares fresh smoke fixture ids, updates the directory with
      `configure` if needed, bootstraps the organization and operation, runs
      `qm ops authority smoke`, and records `v0.3.2` acceptance before any
      tenant session depends on it. If the smoke fails, stop and report; the
      rollback is `release cloudflare-v0.3.1 --percentage 100`.
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
