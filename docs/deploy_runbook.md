# Deploy runbook — a `cloudflare-v*` tag

*Upstream ends at the annotated tag and its publication. This runbook is the
host-neutral shape of the deploy that follows — the consumer deployment
contract, explicitly not an upstream act (see [lexicon.md](lexicon.md) §
Delivery). The deploying host owns the Cloudflare account, versions, traffic,
secrets, and service binding. No secret value belongs in this repository or in
a relay note.*

## Preflight

1. **Tag and artifact.** From the upstream checkout:

   ```sh
   bin/check-version cloudflare-vX.Y.Z
   bin/check-artifact cloudflare-vX.Y.Z
   ```

   `check-artifact` requires an annotated tag that peels to a full commit, a
   manifest version matching the tag, a production config that names some
   Worker with no routes and `workers_dev: false`, a present `main`, and —
   when the checkout is the tag — a successful `wrangler deploy --dry-run`
   bundle. The config's name is a neutral default; the host supplies its own
   Worker name at upload, so the gate does not certify which Worker a tag
   lands on.

2. **Full gate.** `pnpm verify` in the upstream checkout. The host's own gate
   is separate and is not replaced by it.

3. **Pushed tag.** Confirm the tag is on the canonical forge. The host reads
   the tag from its source clone; a dirty upstream working tree must not
   contribute a file.

4. **Snapshot.** The host exports every live operation and organization
   before upload. Record the snapshot directory; a failed export aborts before
   the upload. The deploy does not restore it.

## Deploy

The reference host's porcelain is `qm ops authority …`; any host implements
the same contract:

1. **Upload.** Verify the tag and configuration, snapshot state, upload a
   Worker Version tagged with the full upstream commit, and serve no traffic.

2. **Canary (when traffic exists).** Activate the uploaded version at a small
   percentage against the one other tagged live version. Inspect version,
   secret names, signing key id, and schema status. Do not run the acceptance
   smoke during a split: binding calls may hit either version.

3. **Activate 100%.** The previous version drains; it is not deleted and
   remains the rollback target.

4. **Post-checks.** Active Worker Version id and tag, traffic percentage, the
   expected secret names, the unchanged signing key id, and the schema status
   for every named operation. A failure after activation does not auto-roll
   back.

A first deploy of a Worker that does not exist collapses upload and
activation; there is no traffic to split. Every later deploy uses the two-step
form, except a tag that carries a Durable Object migration.

## Durable Object migrations

A tag that declares a new Durable Object class, or moves one, carries a
Durable Object migration. `wrangler versions upload` refuses a pending
migration, because a version upload cannot apply one. The host's path for such
a tag is:

1. **Snapshot.** Export every coordinator. The preflight snapshot is not
   optional here: the migration applies with the deploy, before any canary.
2. **Deploy the migration.** Run `wrangler deploy` with the production config
   and the host's own Worker name applied. This is the one case where the
   upload-and-activate split does not apply, because the migration is part of
   the deploy. The reference host wraps this as
   `qm ops authority migrate`.
3. **Tag and activate.** Tag the resulting Worker Version with the full
   upstream commit, activate it at 100%, and run the post-checks.
4. **Record the migration.** Put the migration tag in the deployment witness.

Treat the migration as one-way unless the configuration declares a reversible
one. A version from before the migration cannot be activated across it, so the
rollback target is the next deployment, not the previous tag; record that the
prior version is not a cutback target. A migration is a deploy, not an
acceptance.

## Configuration-only versions

A configuration-only version changes the organization directory or the live
verification key set, not code. It is still a Worker Version and still an
upload; only its identity and its evidence differ.

Tag it from the code commit plus a stable digest of the configuration it
applies — the organization ids and the live key set, in their canonical
serialized form:

- the same code and the same configuration produce the same tag, so a retry
  is idempotent;
- a changed organization directory or key set produces a different tag, so a
  stale upload cannot pass for the current configuration;
- the code commit stays in the tag, so the version still names its source.

The tag is a Worker Version label, not a Git tag, a release identity, or a
record of acceptance. It does not move an upstream tag or the consumer's
pin. The host records it in the deployment witness beside the Worker Version
id.

A configuration-only version takes no state snapshot and runs no routine
schema backfill; it changes no code, so it may be activated at 100%. It still
gets the post-checks: active version, secret names, signing key id, and schema
status for every named operation. It is a deploy, not an acceptance.

## Acceptance (separate from deploy)

- The binding smoke runs against a dedicated, pre-bootstrapped fixture. A
  spent fixture needs fresh ids; `configure` updates the organization
  directory without moving code (see § Configuration-only versions).
- State restore and routing-facts backfill belong to a schema change or a
  recovery drill, never to a routine deploy.
- Record the acceptance before a host session depends on the new version.
- If the smoke fails, stop and report; roll back rather than amend the
  acceptance.

## Rollback

Activate the previous tagged version at 100%:

```sh
# reference host
qm ops authority promote <previous-tag> --percentage 100
```

A version from before a one-way Durable Object migration is not a rollback
target; the next deployment is (see § Durable Object migrations).

Never delete a Worker Version. If the upload failed, the old version is still
serving. A failed post-activation check is an operator rollback or a snapshot
restore, not an automatic one.

## Deployment witness

Record, without secret values:

```text
upstream tag / tag object / peeled commit / version
snapshot directory
uploaded Worker Version tag and id
active Worker Version id / tag / percentage
secret names present; signing key id
schema status per operation
binding-smoke result and timestamp
acceptance record location
rollback tag
```

## What not to do

- Do not deploy from a working tree instead of the tag.
- Do not use `wrangler deploy` for an existing Worker; upload a version and
  activate it — except a tag that carries a Durable Object migration, which
  only `wrangler deploy` applies (see § Durable Object migrations).
- Do not put a secret in a note, a plan, or this repository.
- Do not call the binding smoke the full `OH-*` inventory.
- Do not treat a successful deploy as acceptance.
