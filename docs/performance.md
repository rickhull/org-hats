# Performance baseline

The benchmark harness is opt-in. It is not a gate, and no latency number here
is a threshold: compare a change before and after, and keep only a change that
moves the measured cost.

## Commands

- `pnpm bench` — the in-memory `AuthorityRuntime`. `BENCH_ITERATIONS`
  overrides the sample count (default 100).
- `pnpm bench:binding` — the same operations through the Cloudflare runtime
  and its real Durable Objects in workerd, plus SQL statement counts and a
  representative `grant-hat`. It uses a separate vitest config, so the normal
  workerd suite never runs benchmarks.

Both print JSON: median and p95 latency, operations per second, and for the
binding run, statements per representative call. The in-memory run uses a
fixed clock and the conformance world; the binding run bootstraps that same
world through `createCloudflareConformanceWorld`.

## Baseline, 2026-10-31

Local development machine, Node 24.21, workerd through vitest. The synthetic
conformance world; median of 50–100 samples over three runs.

| Operation | In memory | Through the binding |
| --- | ---: | ---: |
| issue (`accessFromEvidence`) | 0.34–0.46 ms | 41–49 ms |
| refresh | 0.44–0.64 ms | 17–19 ms |
| context | 0.58–0.79 ms | 13–14 ms |
| verify (local access module) | 0.60–0.78 ms | 0.17–0.20 ms |
| grant-hat | — | 30–57 ms |

Treat the latency figures as indicative: host load moved individual medians
by up to roughly 2× across repeated runs. Compare a change before and after
on the same machine and load. The SQL counts were exact and stable.

SQL statements per representative binding call (operation / organization):

| Call | statements |
| --- | ---: |
| issue | 16 / 1 |
| refresh | 19 / 2 |
| context | 4 / 4 |
| grant-hat | 19 / 0 |
| disable-actor | 0 / 27 |

The counts include the runtime's around-call outbox drain and roster
reconciliation, not only the handler's own statement. They are stable across
repeated runs.

## Scaled world, 2026-11-01

`bench/scale.bench.ts` boots the same coordinators with 10,000 grants,
3,000 projected actors, 60 teams, and 10 sites — the order of a mid-size
operation — and runs the same four calls. It exists to price the O(state-size)
candidates the toy world cannot see. Both columns are the same day's runs
on the same machine, minutes apart.

| Operation | Toy world | Scaled world | Statements (toy = scaled) |
| --- | ---: | ---: | --- |
| issue | 22 ms | **85 ms** | 16 = 16 |
| refresh | 11 ms | **81 ms** | 19 = 19 |
| context | 7 ms | 10 ms | 4 = 4 |
| grant-hat | 17 ms | 19 ms | 19 = 19 |

The verdict the table writes: statement counts are identical at both
scales — the cost moved into the statements, not into more of them — and
**issue and refresh are O(state)**: they re-read the whole model snapshot
(all grants, teams, sites, participations, and the actor projection) per
call, so at ~600× the state they cost ~4–7× more and converge on each
other. Context and grant-hat stay flat; their statements are keyed reads,
not world reads. A write-through snapshot cache in the operation
coordinator — the single writer, so the cache is sound — is the one change
this measurement justifies: it would return issue and refresh to the
transport floor at any state size. The indexless scans (the undelivered
outbox scan rides every drain) remain unpriced until a bench accumulates
outbox history; nothing measured here justifies an index yet.

## Review

- In memory, signing and canonicalization dominate issuance, refresh, and
  verification. Context is the same order without signing: it assembles the
  model snapshot and the presentation facts.
- Through the binding, the service-boundary and Durable Object round trips
  dominate the tens of milliseconds; the SQL counts are small and stable.
  Repeated operation-config and snapshot reads during issuance are visible in
  the statement count, but the measured call is transport-bound. No change is
  justified without a measured before/after that moves it.
- The hot reads use primary keys: refresh handles by `handle_hash`, grants by
  `grant_id`, and the actor projection by `(organization_id, actor_id)`.
  Revocation scans `refresh_records` by organization and actor; at the
  baseline sizes that scan is cheap. Add an index only when a benchmark shows
  the scan is the cost.
- The envelope-size gate remains the hard budget. `bin/check-artifact` now
  also prints the built Worker's `index.js` size (`293,236` bytes at this
  checkout, 2026-11-01; identical across repeated dry runs); it is a reading, not a gate.
