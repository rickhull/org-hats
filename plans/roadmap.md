# Publishing: remaining work

*Open items only. The current state and the operating rules — canonical host, mirror, CI, the release ritual, and the discipline that keeps it publishable — are in [`docs/publishing.md`](../docs/publishing.md).*

## Open

1. **GitHub repository cosmetics.** Set the description to *"Canonical: https://codeberg.org/rickhull/org-hats — a small, reusable organization model"*; disable **Issues**, **Wiki**, **Discussions** on the mirror (PRs can't be disabled); add topics — `rbac`, `authorization`, `access-control`, `permissions`, `typescript`, `sqlite`, `cloudflare-d1`, `organization`.

2. **Registry publication.** `org-hats` is unclaimed on npm and `@rickhull/org-hats` is free on JSR. Decide whether to publish to either:
   - **npm:** add `"main": "./dist/index.js"`, an `"engines"` field, and `"publishConfig": { "access": "public" }`. **Provenance** (`--provenance`) comes free here — CI now runs on GitHub.
   - **JSR:** publish TypeScript directly; consumers use `npx jsr add`. Needs a scope and a small `jsr.json`.
   - **Neither:** keep the git tag, which is already working.

3. **Consumer handoff.** Send the pin — `git+https://codeberg.org/rickhull/org-hats.git#v0.4.4` — and note that the `OH-QM-01`…`11` ids are unchanged.

4. **The 1.0 core freeze** (on the roadmap at the consumer's request — do not cut yet). Freezes: the five entities, `SCHEMA`'s shape, the port, `decide`/`DecideRequest`/`Decision`, `heldCarries`, and the `OH-QM` ids — additions-only after. **Entry criteria** (the consumer's):
   - the write-side conference — **done** ([docs/writes.md](../docs/writes.md));
   - the **landing rule** settled at the session layer: one primary per organization, so a multi-organization actor's landing hat is a host decision — the spine takes a position (`organizationId` as request context) but the interaction is the host's;
   - the **multi-organization read rule** decided: the site half is structural (read reach follows team-bearing grants at the site); whether to union every organization served or follow the worn hat is host policy, settled by a real read policy.
   Until then: deliberate 0.x changes with a consumer conference, which has served both sides.
