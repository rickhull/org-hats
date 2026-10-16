# Documentation review — what crystallized, what is baggage

*Review of `README.md`, `docs/`, and `plans/` at v0.4.2 (October 2026). **Phase 1** (stale facts, id hygiene, the dead link and the stray file) is applied in this pass. **Phases 2–3** are proposed, not taken: they move durable decisions and touch most docs, so they want a decision first.*

## Verdict

The **core has crystallized**; the documentation *around* it has not. The model — five entities, two relationships, eight rules, the `can` split — the published surface (core, port, `decide`, the OH-QM inventory), and the consumer's pin have all been stable across v0.2–v0.4 and are exercised by a real host. What remains open is *named and scoped*: C31 (the landing rule), C34 (the multi-organization read rule), C39 (write atomicity) — the 1.0-freeze entry criteria, not design churn.

But the docs still carry the shape of the pre-1.0 churn they survived: a resolved-issue queue, a version changelog inside the README, a publication-provenance appendix, and facts left behind by superseded implementations. That is the baggage this review names.

## What crystallized (keep — do not churn)

- **`docs/organization_model.md`** — the full statement; the tiebreaker over the code. Stable, dense, correct.
- **`docs/rbac.md`** — the positioning and the `can` split. Stable.
- **`docs/operations_layer.md`** — the application-side mapping; deliberately an example, not the core.
- **`docs/writes.md`** — the write checklist settled at the C53 conference.
- **`docs/tutorial.md`** — the same model built up one concept at a time; no stale facts found.
- The **published surface** and the **fence** (`docs/package.md`, minus the stale lines fixed below).

## Phase 1 — applied

### Stale facts

| Where | Said | Now |
| --- | --- | --- |
| `organization_model.md` § Efficiency | "checks **eight** of these bounds"; "the toy adapter runs one **`sqlite3` process per statement**" | six bounds; the `node:sqlite` adapter prepares per call |
| `package.md` layout | `core.ts … SCHEMA, **actions**` | core names zero actions (C63); the line lists path helpers instead |
| `package.md` layout | `examples/` | add `_assert.ts` (C73) |
| `package.md` surface | no `selectWorn` / `HatSource` | both added (C71) |
| `package.md` build | `version 0.1.0` | `0.4.2` |
| `publishing.md` | release/pins at `v0.1.0` | current release `v0.4.2` |
| `publishing.md` | "**ten** conformance cases"; `main` and `v0.1.0` "identical on both hosts" | eleven; the current release is tagged on both hosts |
| `publishing.md` | fixtures "**Acme Freight / Atlas / Beacon / Cobalt / Northport / Southport**" | an obviously fictional world, now the Riverbend festival |
| `rbac.md` | `worn(actor, organization, scope)` | `wornHat` (the function that exists) |
| `literature_review.md` | "chief executive whose default is *Janitor*"; "physically at Northport" | the festival illustration (director → *Volunteer*; *Big Park*) |
| `plans/publish.md` | consumer pin `#v0.1.0`; "`OH-QM-01`…`10`" | `#v0.4.2`; `…11` |

### Id hygiene

`D1`–`D6` meant **two different things**: the deferred-by-design list in `concerns.md` (`D1` role hierarchy, `D6` time-bounded grants) *and* the publication-decision table in `publishing.md` (`D1` license, `D6` the rename). Every doc that cites `D1`/`D6` as role hierarchy shares a token with a document that means license/rename. The publication table is now **`P1`–`P6`**; `concerns.md` C55's cross-reference is repointed.

### Dead links and strays

- `concerns.md` linked `../quartermaster.txt`, which is **not in the repo** (only an ignored editor backup, `quartermaster.txt~`, existed). The link is gone and the backup deleted. The remaining `v0.1.0` mentions in `concerns.md` (C42, C51) are historical entries and are left as written.

## Phase 2 — proposed: durable decisions versus churn

**The problem.** `docs/concerns.md` is 74 ids and ~90% resolved narrative. Only four ids are live (`C31`, `C34`, `C39`; `C74` partial) and eight are deferred (`D1`–`D8`). But the file is also the *citation surface*: eight other documents cite ~30 ids, and roughly half are **durable positions**, not churn —

- **C53** — administration is an action (cited by `rbac.md`, `writes.md`, `package.md`, `reference_impl.md`);
- **C54** — the cost posture / request-scoped snapshot (cited by `package.md`, `literature_review.md`, `reference_impl.md`);
- **C63 / C64** — the core names zero actions; the membership retreat;
- **C31 / C34 / C39** — the open positions.

The rest (`C1`–`C28`, `C36`–`C52` mostly) are renames, typos, and schema fixes whose value is the *fact they landed*, which git already holds.

**The proposal.** Split the file by kind rather than by time:

1. **Promote the durable positions** into the documents they belong to — C53 into `writes.md` (already largely there), C54 into `package.md` § *The request spine* (there), C31/C34 into `reference_impl.md` (there). Where a normative doc already states the substance, drop the id and keep the sentence; the id was scaffolding.
2. **Keep `concerns.md` as the live queue**: Open, Deferred, and *how to raise* — `C31`, `C34`, `C39`, `D1`–`D8`. Delete the resolved history; git has it (`git log --grep C53`, tag-per-release).
3. **Sweep the remaining inline `(C-nn)` citations** and either de-cite them (the sentence already carries the meaning) or repoint to a promoted heading. This is the one mechanical-but-judgment-bearing pass; it touches `literature_review.md` (9 ids), `package.md` (4), `reference_impl.md` (5), and `typescript_review.md`.

**Why propose rather than do.** It is information-preserving only if step 1 is done first, and step 3 is editorial — exactly the kind of change that should be one deliberate pass, not a drive-by. It also converts the queue from its pre-1.0 shape (a running log with stable ids) to the shape a 1.0 library conventionally ships: decisions live where they apply, and history lives in git.

## Phase 3 — proposed: the version narrative

Three documents still narrate *how they got here* rather than *what is*:

- **`README.md` § Status** — an embedded changelog ("`v0.2.0`–`v0.2.3` grew…; `v0.3.0` made…; `v0.4.0` is…; `v0.4.2` is…"). Proposal: reduce to the frozen-state sentence plus the open decisions, and let the tags carry the history.
- **`plans/reference_impl.md`** — "what shipped in `v0.2.0`", struck-through items, and a status split. Proposal: keep the **remaining** roadmap (the 1.0 freeze) and retire the shipped-status prose; it is superseded by the code and the tags.
- **`docs/publishing.md` § "How this repo was made publishable" + § Verified** — publication provenance. Proposal: keep it (it answers a real question) but move it below the operational sections, or split to `docs/publication_notes.md`; either way it is an appendix, not the head of the document.
- **`literature_review.md` § "What the review changed"** — a migration changelog. The verdict table is durable; the "what settled it" prose is history.

## Not touched

- **The consumer name is now public, but `publishing.md` still claims it was removed.** `publishing.md` § *How this repo was made publishable* says "the previous consumer's confidential tier was removed: its product name, private repo path, internal doc names, and decision ids" — while `concerns.md` (C56, C62, C64) names **Quartermaster** outright. This is a policy question, not a doc bug: either the consumer consented to being named and `publishing.md` should say so, or the name should go back behind the initialism. Flagged, not changed.
- **The `C`-id system itself.** It is a stable address space and other documents rely on it; Phase 2 proposes narrowing what it holds, not removing it.
