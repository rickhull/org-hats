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

## Amplification review, 2026-11-02

A complexity review of the per-request worst case, not a load test. The
question is which paths grow with something a caller or a tenant controls, and
who owns the growth. Volumetric defence is the platform's and the host's; the
threat model says so, and nothing here changes that.

**Bounded by construction.**

- *Signature verification* — one Ed25519 verify per envelope, constant.
- *Claims depth* — bounded by the format at `ACCESS_CLAIMS_MAX_DEPTH`, checked
  before canonicalization, so unverified claims cannot drive unbounded
  recursion.
- *Provider documents* — discovery and JWKS are TTL-cached per issuer, and a
  forced refetch on an unknown key id is floored at 30 seconds, so an attacker
  presenting unknown kids cannot turn one request into a refetch loop.

**Linear in something the tenant owns, and that is the intended shape.**

- *Claims breadth* — grows with an actor's reach. Deliberately uncapped at the
  verifier: the authority issues claims too large for a cookie and the host
  refuses those at issuance against its own budget.
- *Restore* — linear in the snapshot's rows, operator-authorized, behind the
  ops token.
- *Model snapshot reads* — O(state) per issue and refresh, measured in the
  scaled world above and deferred by consumer advice; see
  [`../plans/snapshot_cache.md`](../plans/snapshot_cache.md).

**Was unbounded per invocation — the one finding of this review, since fixed.**

The drain iterated *every* pending message, and the organization fanned
`roster`, `actor-disabled`, and `actor-unlinked` out to every operation in its
`invitations` with one coordinator `fetch` each. The subrequests a single
drain issued were therefore the sum, over pending messages, of their target
counts: unbounded in both dimensions, against a platform cap on subrequests
per invocation.

The failure mode was worse than slowness. A drain that exceeded the cap failed
partway; the messages it had not delivered stayed pending, the alarm
rescheduled one second out because `pending > 0`, and the next invocation
attempted the same oversized batch. It retried forever at one attempt per
second and never completed — a livelock rather than a degradation, and the
retry was what made it permanent. A cliff rather than a curve: fine until
unrecoverable, with no error an operator would read as "too many at once".

**Fixed 2026-11-02.** Fan-out is expanded at enqueue into one addressed row
per operation, so one row is one subrequest; the drain takes at most
`OUTBOX_DRAIN_LIMIT` (25) rows and leaves the remainder pending for the alarm
that already runs, clearing a backlog at roughly 25 a second. 25 sits under
even the free tier's 50-subrequest limit, so the bound does not depend on the
plan. Delivered rows are pruned after seven days, which keeps the extra rows
one event now retains from trading a bounded cliff for unbounded growth.

Witnessed in `packages/cloudflare/test/organization.test.ts`: a 64-row backlog
drains across three invocations, and removing the cap fails that test. The two
behaviour changes that came with it — a late-joining operation no longer
receives an already-enqueued fan-out, and a partial failure no longer forces
redelivery to the targets that succeeded — are in
[`cloudflare.md`](cloudflare.md) § The outbox.
