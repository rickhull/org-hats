# Patch release — access integrity

## Scope

Proposed pair: `v3.7.1`, followed by `cloudflare-v0.13.1`. The bounded source
review and Quartermaster's no-hold source acceptance are recorded in
[`docs/release_review_v3.7.1.md`](../docs/release_review_v3.7.1.md). The
[upgrade notes](../docs/migration-v3.md#370--371) describe the consumer impact.
The tags are not yet cut; publication and deployment remain separate acts.

## Release from clean main

Rick commits the remaining release documentation, leaving the working tree
clean. Package versions remain `3.7.0` and `0.13.0` until the release script
bumps them. The README links to the manifests rather than duplicating their
version numbers.

Rick runs, in order:

```sh
bin/release patch
bin/release --package cloudflare patch
```

The script owns each manifest bump, fresh build and gates, release commit,
annotated tag, version verification, canonical NAS publication, and
best-effort mirror publication. The Cloudflare release also passes the
production artifact gate. Agents do not invoke this committing/pushing wrapper
or pre-bump the manifests; Rick owns those operations.

**Done when:** both annotated tags pass `bin/check-version`, the runtime
artifact passes `bin/check-artifact`, and the tags are published to NAS.
**Closing evidence:** release gate outputs and exact remote tag/commit
read-backs. Report mirror lag separately without moving or recutting tags.
Recheck `pnpm audit` before the cut;
triage any new findings by reachability rather than applying forced upgrades.

Send Quartermaster the published tag and commit identifiers. Remove this plan
and its index entry when both releases are published. Pin adoption and live
deployment remain Quartermaster's responsibility.
