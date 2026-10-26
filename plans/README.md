# Plans — what's next

Strictly forward-looking. A plan names work to do, a decision to make, or a
gate to clear. It describes intent, not current behavior. When a plan is
realized it is removed or rewritten; the result belongs in `docs/` and in
commit messages. The v1 delivery plan (`v1.md`) is retired: the line it
planned is released, adopted, and documented in `docs/`.

- `personas.md` — adoption and positioning: the journeyman AD/LDAP
  practitioner, the access-control academic, the hooks that fit each, the
  content plan, channels, and the claims to refuse.
- `model_coherence.md` — the semantic decisions from the academic review:
  the unit of authority, admission, read reach, vocabulary, determinism, and
  the formal/threat model work that must precede a "foundational" claim.
- `test_suite_review.md` — the test-suite fanout: fragility and dependency
  findings, the rings, and the remaining coverage gaps in priority order.
  The typecheck gate is landed; the coverage slice follows.
- `v2_release.md` — Quartermaster acceptance of the released 2.0 / 0.3 line:
  the deploy, binding smoke, and schema/routing drill have passed; the
  acceptance record and the registry/DNS/tenant follow-on remain. The
  post-v0.3.1 R5 fixes need a new `cloudflare-v0.3.2` release decision.

Retired plans are removed; their results live in `docs/` and the commit
history. Completed work is not kept here.
