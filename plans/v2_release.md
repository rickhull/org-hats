# Quartermaster acceptance — the released 2.0 / 0.3 line

**Status (2026-10-25, later):** root `v2.0.0` and Cloudflare
`cloudflare-v0.3.1` are released. Quartermaster's static review passes.
`cloudflare-v0.3.1` is deployed to `reporting-stream-authority` and active at
100%, and Quartermaster's ops documentation reports the binding smoke, the
schema-2 → schema-4 restore, and the routing-facts backfill passed. The acceptance
record has not been confirmed in the relay yet; no pin moves before it is.
`cloudflare-v0.3.0` remains the routing tag.

## Open

- [x] Rick deploys `cloudflare-v0.3.1` with production configuration and
      operator-held secrets.
      Landed 2026-10-25: the Worker is active at 100% from the
      `cloudflare-v0.3.1` commit, with the additive organization directory
      and verification-key set installed.
- [x] Quartermaster runs the binding smoke, including the disabled/stale-
      projection refresh refusal documented in
      `docs/binding-conformance.md`.
      Quartermaster reports all six groups passed. The dedicated smoke actor
      is now disabled; a rerun needs fresh fixture ids.
- [x] Quartermaster runs the schema-2 export → schema-4 restore →
      routing-facts backfill drill and accepts the policy and fixtures.
      Quartermaster reports the restore and backfill passed, with
      `routingFactsComplete` true for the synthetic operation.
- [ ] Quartermaster records acceptance and confirms it in the relay. No pin
      moves before it is.
- [ ] Close this plan, update `plans/README.md`, and post the result in the
      relay.

## Follow-on, not this acceptance

`cloudflare-v0.3.2` is the vehicle for the post-v0.3.1 R5 fixes: the RFC
8414/7515/7519/7636 exchange hardening and the runtime cross-coordinator
corrections. It is a new annotated tag and a new host deploy, never a retag
of `v0.3.1`. Decide after Quartermaster confirms acceptance and says whether
the consumer login uses ES256 or RS256; `v0.3.1` cannot verify RS256.

## Not in this plan

The source break, migration note, release tags, CI, and publishing docs are
done. No retag and no re-release belong here; the v0.3.2 follow-on is a new
release, not part of this acceptance.

No secrets or customer data in this plan.
