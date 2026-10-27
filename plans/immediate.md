# Immediate — cut `cloudflare-v0.6.1`

**Status:** Active.  One decision.  Retire this plan when the live pointer
names `cloudflare-v0.6.1`.

The exchange hardening is on `main`, not in the live tag.  The live runtime is
`cloudflare-v0.6.0`; the JWKS `Cache-Control` clamp, the 30-second
forced-refetch floor, and the `unavailable` mapping for an unreachable key set
landed after that tag.  The consumer has deleted its own JWKS path and now
relies on the runtime exchange, so the hardening is not deployed where it
matters.

**Decision.**  Cut a patch now, or hold until the next scheduled release and
mark the documentation as "on `main`, not in `0.6.0`."  Recommendation: cut
now.  It is a patch, the artifact gate covers it, and the consumer's exchange
path just changed.

If cut:

1. Run `pnpm verify` on the current `HEAD`.  The release is from the gate, not
   from a local build.
2. `bin/release --package cloudflare patch` — this bumps
   `packages/cloudflare/package.json`, runs the gates, and creates the
   annotated tag.  Rick pushes.
3. Verify the tag with `bin/check-version cloudflare-v0.6.1` and
   `bin/check-artifact cloudflare-v0.6.1`.
4. The consumer deploys it and runs the binding smoke on a fresh fixture.
5. Only after acceptance, update the live pointer and acceptance history in
   `docs/binding-conformance.md`, `docs/cloudflare.md`, `docs/positioning.md`,
   `docs/publishing.md`, and `docs/from_ldap.md`.  `cloudflare-v0.6.0`
   becomes the rollback target.
6. Record the new Worker Version id, configuration version, secret names, key
   id, schema status, and smoke result in the deployment witness.

**Done when.**  The tag is on both remotes, CI is green, the consumer has
accepted, and the live pointer names `cloudflare-v0.6.1`.  Do not assert the
acceptance before the consumer records it.  Remove this plan then.

**Tradeoff.**  A tag is immutable; a patch is the honest vehicle for a
behavioral fix.  If it is deferred, the docs must say plainly that the clamp
and floor are not live, so the documentation does not describe a deployment
that does not exist.

## Related

- [`docs/deploy_runbook.md`](../docs/deploy_runbook.md) — deploy, rollback,
  configuration-only versions, and the witness.
- [`docs/binding-conformance.md`](../docs/binding-conformance.md) — the smoke
  contract and the acceptance history.
- [`docs/publishing.md`](../docs/publishing.md) — the release ritual, the
  mirror rules, and the CI rings.
