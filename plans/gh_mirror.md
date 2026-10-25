# Restore the GitHub mirror

**Status:** Discovered 2026-10-25, after cutting `cloudflare-v0.1.0`: the
Forgejo push mirror has effectively never run. GitHub holds `main` at the
repository's root commit (`ffb5d29`, "org-hats: a small, reusable
organization model") and a single tag, `v0.1.0`; everything since — all
v0.4 tags, `v1.0.0`, `v1.1.0`, `v1.2.0`, `cloudflare-v0.1.0`, and the
whole v1 line — exists only on Codeberg. Canonical hosting and consumer
pins (Codeberg-first) were never affected; what has been dark is mirror
reach and mirror CI.

The likely cause is the one `publishing.md` predicts: a revoked or expired
GitHub fine-grained PAT, which stops the mirror *silently*. Nothing in the
ref graph says GitHub diverged — the root commit is an ancestor of
everything — so the catch-up is a fast-forward, not a rewrite.

## M1 — Catch up and repair

- [ ] **Mirror catch-up push (manual).** Once, from the local clone:
  `git remote add github git@github.com:rickhull/org-hats.git`, then
  `git push github main --tags`. No force: GitHub fast-forwards from the
  root commit, and every tag is an immutable descendant. The `v0.4.x` tags
  predate `check.yml`, so they trigger no CI; `v1.x` tags run the version
  gate against their own manifests and pass.
- [ ] **Rotate the mirror credential.** On GitHub: a new fine-grained PAT,
  `Contents: Read and write`, scoped to `rickhull/org-hats` only. On
  Codeberg: *Settings → Repository → Push mirrors* — replace the token in
  the mirror entry and press *Synchronize Now*.
- [ ] **Verify sync-on-commit.** The next real push to Codeberg must
  appear on GitHub within minutes (the mirror's sync-on-commit setting).
  Check the mirror entry's last-update timestamp rather than trusting
  silence — silence is this failure's signature.
- [ ] **Confirm mirror CI wakes.** `check.yml` runs green on the pushed
  `main`; the `v1.2.0` tag push additionally passes `bin/check-version`.

*Acceptance:* GitHub `main` equals Codeberg `main`; all tags present; one
post-repair push mirrors within minutes; CI green on the mirror. When this
plan is realized it is removed, and the standing rules in
`docs/publishing.md` — already correct — carry the ongoing duty.

## Notes

- **`v0.4.3` is a historical mis-tag.** It points at `8d2551d` ("docs update
  / cleanup"), whose `package.json` is `0.4.2`; `v0.4.4` is the commit that
  fixes release metadata. The tag is immutable and already published on
  Codeberg. The pre-push hook skips it explicitly so a mirror catch-up can
  validate every other tag; `bin/check-version v0.4.3` still fails it by
  design.
- If a fresh token still stalls the mirror, next suspect is the
  "A rewrite needs both hosts" rule: the Codeberg-side force-push of
  `main` (2026-10-24, `c78822a → 6e7c5f0`) predates the mirror working at
  all, so it is not the cause here, but a future rewrite requires the
  mirror to force-sync or the catch-up to be manual again.
- The manual catch-up does not desync anything: it produces exactly what a
  working mirror would have, and "GitHub is push-only" holds throughout.
