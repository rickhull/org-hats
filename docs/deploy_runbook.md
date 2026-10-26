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
   manifest version matching the tag, a production config naming
   `reporting-stream-authority` with no routes and `workers_dev: false`, a
   present `main`, and — when the checkout is the tag — a successful
   `wrangler deploy --dry-run` bundle.

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

1. **Candidate.** Verify the tag and configuration, snapshot state, upload a
   Worker Version tagged with the full upstream commit, and serve no traffic.

2. **Canary (when traffic exists).** Activate the candidate at a small
   percentage against the one other tagged live version. Inspect version,
   secret names, signing key id, and schema status. Do not run the acceptance
   smoke during a split: binding calls may hit either version.

3. **Activate 100%.** The previous version drains; it is not deleted and
   remains the rollback target.

4. **Post-checks.** Active Worker Version id and tag, traffic percentage, the
   expected secret names, the unchanged signing key id, and the schema status
   for every named operation. A failure after activation does not auto-roll
   back.

A first deploy of a Worker that does not exist collapses candidate and
activation; there is no traffic to split. Every later deploy uses the two-step
form.

## Acceptance (separate from deploy)

- The binding smoke runs against a dedicated, pre-bootstrapped fixture. A
  spent fixture needs fresh ids; `configure` updates the organization
  directory without moving code.
- State restore and routing-facts backfill belong to a schema change or a
  recovery drill, never to a routine deploy.
- Record the acceptance before a host session depends on the new version.
- If the smoke fails, stop and report; roll back rather than amend the
  acceptance.

## Rollback

Release the previous tagged version at 100%:

```sh
# reference host
qm ops authority release cloudflare-v0.3.1 --percentage 100
```

Never delete a Worker Version. If the candidate upload failed, the old version
is still serving. A failed post-activation check is an operator rollback or a
snapshot restore, not an automatic one.

## Deployment witness

Record, without secret values:

```text
upstream tag / tag object / peeled commit / version
snapshot directory
candidate Worker Version tag and id
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
  activate it.
- Do not put a secret in a note, a plan, or this repository.
- Do not call the binding smoke the full `OH-*` inventory.
- Do not treat a successful deploy as acceptance.
