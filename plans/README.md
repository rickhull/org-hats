# Plans — what's next

Strictly forward-looking. A plan names work to do, a decision to make, or a
gate to clear. It describes intent, not current behavior. When a plan is
realized it is removed or rewritten; the result belongs in `docs/` and in
commit messages. The v1 delivery plan (`v1.md`) is retired: the line it
planned is released, adopted, and documented in `docs/`.

- `code_review.md` — whole-tree code review and crystallization, one
  major subdirectory at a time; slice 1 (`src/`) reviewed, findings ride
  the 2.0.0 release.
- `claude_review.md` — architecture and type-soundness pass on slice 1:
  why the design let the correctness findings happen, and where the
  type system can make the same class of bug unreachable. P0-P3 landed;
  feeds into `code_review.md`'s R1-R4.
- `v2_release.md` — the 2.0.0 release gate: migration note, demo smoke,
  tag, and the consumer relay. The source break is landed.

Completed work is not kept here. What exists is in `docs/`; how it got here
is in the commit history.
