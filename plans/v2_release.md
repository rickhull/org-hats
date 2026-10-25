# Quartermaster acceptance — the released 2.0 / 0.3 line

**Status:** root `v2.0.0` and Cloudflare `cloudflare-v0.3.1` are released.
Quartermaster's static review passes; `v0.3.1` is the acceptance target, and
`v0.3.0` remains the routing tag. Deployment and the Phase 1 drill remain.

## Open

- [ ] Rick deploys `cloudflare-v0.3.1` with production configuration and
      operator-held secrets.
- [ ] Quartermaster runs the binding smoke, including the disabled/stale-
      projection refresh refusal documented in
      `docs/binding-conformance.md`.
- [ ] Quartermaster runs the schema-2 export → schema-4 restore →
      routing-facts backfill drill and accepts the policy and fixtures.
- [ ] Quartermaster records acceptance. No pin moves before the drill passes.
- [ ] Close this plan, update `plans/README.md`, and post the result in the
      relay.

## Not in this plan

The source break, migration note, release tags, CI, and publishing docs are
done. No retag, no re-release, and no new authority surface belong here.

No secrets or customer data in this plan.
