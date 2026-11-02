# Operation snapshot cache — deferred, design recorded

The scaled-world bench (`packages/cloudflare/bench/scale.bench.ts`,
`docs/performance.md` § Scaled world) measured issue and refresh as
O(state): both re-read the whole model snapshot per call — 22→85 ms and
11→81 ms at ~600× the toy fixture — with statement counts identical at
both scales. A write-through snapshot cache in the operation coordinator
would return both to the transport floor at any state size.

**Deferred** at the consumer's advice (Quartermaster, "cache:
single-writer holds, but the epoch must be model-scoped"): the live
operation holds 4 grants, 3 actors, 2 teams — 0.04% of bench scale — and
its refresh cost is the cross-coordinator liveness read, not the
snapshot scan. No consumer needs this yet.

**The recorded design**, if it is ever built:

- The invalidation epoch is **model-scoped**: it covers exactly the
  tables `modelSnapshot()` reads — `operation` (slug), `sites`, `teams`,
  `grants`, `participations`, `org_actors`. It must not cover
  `refresh_records`, `audit`, `claims`, `outbox`, `invitations`, or
  `access_requests`: issue and refresh write `refresh_records` on every
  call, so a global epoch or `total_changes()` never hits — the cache
  invalidates itself on every call and the optimization disappears.
- Prefer the **DB-backed shape**: SQLite triggers on the six model
  tables maintaining a `model_epoch` row, read once per cache lookup. It
  covers raw-SQL restore and reset and every future write site by
  construction. The alternative — one private `writeModel` helper every
  model write must use — is cheaper but only as good as the ban on
  direct writes, and a missed site is silently stale authority.
- Writes that must invalidate: `select-hat`, grant revoke, team
  create/update/retire, participation moves, `replaceRoster`,
  routing-facts backfill, bootstrap, reset, restore. The rotation
  transaction must not.
- Cache the `Snapshot` only, never assembled claims — claims depend on
  policy, `issuedAt`, and authentication facts. Instance-scoped, fill
  synchronous: never populated from uncommitted state, and never between
  restore's table clear and the roster pull that rebuilds the
  projection.
- Watch the hit rate: a cold isolate is today's path; for sparse traffic
  the cache never survives to the next call and is pure memory. Measure
  the built snapshot's size against the 128 MB isolate ceiling; add a
  size guard if growth is plausible.

**Done when:** a consumer's operation approaches the bench's state
(≈10k grants), or issue/refresh latency is observed growing with state
in a deployment — then build the trigger-backed, model-scoped version
and prove it with `bench/scale.bench.ts` as the before/after.
