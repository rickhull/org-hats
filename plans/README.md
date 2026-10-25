# Plans — what's next

Strictly forward-looking. A plan names work to do, a decision to make, or a
gate to clear. It describes intent, not current behavior. When a plan is
realized it is removed or rewritten; the result belongs in `docs/` and in
commit messages. The v1 delivery plan (`v1.md`) is retired: the line it
planned is released, adopted, and documented in `docs/`.

- `gh_mirror.md` — restore the GitHub push mirror: catch-up push, PAT
  rotation, and the sync-on-commit verification.
- `code_review.md` — whole-tree code review and crystallization, one
  major subdirectory at a time; slice 1 (`src/`) done, findings ride
  v1.3.0.
- `claude_review.md` — architecture and type-soundness pass on slice 1:
  why the design let the correctness findings happen, and where the
  type system can make the same class of bug unreachable. Feeds into
  `code_review.md`'s R0/R3.

Completed work is not kept here. What exists is in `docs/`; how it got here
is in the commit history.
