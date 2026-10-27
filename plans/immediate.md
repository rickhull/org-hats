# Immediate — release, limits, and the next gate

**Status:** Active.  Ordered by consequence: the release decision comes first;
the rest waits for a real trigger, a scheduled check, or the next relay note.

## 1. Cut `cloudflare-v0.6.1` (decision needed)

The exchange hardening is on `main`, not in the live tag.  The live runtime is
`cloudflare-v0.6.0`; the JWKS `Cache-Control` clamp, the 30-second forced-refetch
floor, and the `unavailable` mapping for an unreachable key set landed after
that tag.  The consumer has deleted its own JWKS path and now relies on the
runtime exchange, so the hardening is not deployed where it matters.

**Decision.**  Cut a patch now, or hold until the next scheduled release and
mark the documentation as "on `main`, not in `0.6.0`."  Recommendation: cut now.
It is a patch, the artifact gate covers it, and the consumer's exchange path
just changed.

If cut:

1. Run `pnpm verify` on the current `HEAD`.  The release is from the gate, not
   from a local build.
2. `bin/release --package cloudflare patch` — this bumps
   `packages/cloudflare/package.json`, runs the gates, and creates the annotated
   tag.  Rick pushes.
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
acceptance before the consumer records it.

**Tradeoff.**  A tag is immutable; a patch is the honest vehicle for a
behavioral fix.  If it is deferred, the docs must say plainly that the clamp
and floor are not live, so the documentation does not describe a deployment
that does not exist.

## 2. The envelope-size limit (hold, with a trigger)

The host budget is 3,800 URI-encoded JSON bytes, reserved from the 4 KB
browser cookie cap.  The synthetic festival's site-wide read reach is 7,843 URI-encoded JSON
bytes; no
cookie holds it, and the host refuses at issuance.  This is documented and
tested, not a defect in the current consumer, whose envelopes are in the
sub-1,100 range.

**Trigger.**  A real operation whose encoded envelope exceeds 3,800 bytes.

**Options when triggered.**

- Leave it a documented host limit and require the host to narrow the read
  projection or carry the envelope differently.  This is the current default.
- Cap read reach upstream so an envelope cannot be issued over a bound.  That
  needs a rule for reach past the cap, and a failure kind is the honest one.
- Introduce a host-side handle or indirection so the cookie carries a reference
  instead of the full reach.  That is a larger seam change.

**Recommendation.**  Keep the documented host limit and do not add a failure
kind.  Reopen only on a real case; the festival measurement is a boundary
proof, not a product requirement.

**Done when.**  A real case is measured and a decision is recorded in
`docs/consumer-session.md` or a spec.

## 3. Workerd CI coverage (accepted tradeoff)

Codeberg per-push CI runs the portable gate only.  The Cloudflare workerd
suite — including the binding smoke, `devidp`, and the exchange tests — runs
locally in ring 2 and at release on the GitHub mirror.  A workerd regression
can therefore land on `main` and stay unseen until the next release.

**Decision.**  Accept while the Cloudflare package is private and on `0.x`.
The release-time GitHub job is the backstop, and the local gate is required
before a handoff.

**Revisit if** a workerd regression reaches a release tag, or the package gains
a second consumer.  Then add a larger or self-hosted job, or a nightly run; the
5-minute `codeberg-small` runner cannot take workerd.

**Done when.**  This tradeoff is recorded here and no workerd regression has
escaped a release.  A job that changes it is its own plan.

## 4. Relay outbox cap (housekeeping)

`notes/to-quartermaster.md` is at 792 lines against the 850-line cap.  The
next entry that would cross the cap discards the oldest half, to at most 425
lines, snapped to an entry boundary.  Do not split an entry.

**Done when.**  The next prepend that would exceed 850 is pruned as the
protocol requires.  No action before a note is due.

## Standing checks

- The binding smoke and `devidp` are the executable binding contract; they stay
  in `pnpm check:cloudflare`.
- `docs/consumer-session.md` and `tests/envelope-size.test.ts` move together.
  A size change is a documentation change in the same commit.
- The live pointer is the consumer's acceptance, never an upstream assertion.
  Update it only after the consumer records the deploy.
- No portable release for comments, docs, or a rebuilt `dist/` whose only change
  is comments.  `v3.0.0` remains the functional portable release until a source
  change warrants otherwise.

## Not on the agenda

- **GitHub mirror lag.**  The mirror is release-only; `github/main` sitting behind
  Codeberg `main` is the design.  A release push catches it up.
- **Configuration-only tag rule.**  Documented in `docs/deploy_runbook.md`; the
  host's porcelain implements it.  No upstream code.
- **Historical live pointers in migration notes.**  `docs/migration-v2.md` is a
  migration record; it describes the state at its transition and is not
  rewritten.
- **`qm`, routing, ops verbs, the relay.**  Host or consumer property.

## Related

- [`docs/deploy_runbook.md`](../docs/deploy_runbook.md) — deploy, rollback,
  configuration-only versions, and the witness.
- [`docs/binding-conformance.md`](../docs/binding-conformance.md) — the smoke
  contract and the acceptance history.
- [`docs/consumer-session.md`](../docs/consumer-session.md) — the size boundary
  and the carriage rules.
- [`docs/publishing.md`](../docs/publishing.md) — the release ritual and the
  mirror rules.
