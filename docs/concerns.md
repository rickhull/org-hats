# Concerns

*The review queue. One entry per concern raised, with a stable id so a commit or a code comment can cite `C7` without ambiguity. Ids are permanent addresses and are never renumbered.*

**Statuses:** *resolved* — closed with a change; *deferred* — a deliberate, documented trade-off; *open* — not yet decided.

## Resolved

| Id | Concern | Resolution |
| --- | --- | --- |
| **C1** | Nothing enforced "wearable here": `worn` was not scope-aware and there was no admission predicate. | Added `anchor_scope`/`covers_scope?`, `wearable_at`, `admitted?`, a strict `wear(scope:, grant_id:)` (since removed — see C23), and made `worn` scope-aware. |
| **C2** | The core read rule was organization-wide while the operations layer read site-scoped — two rules that disagreed. | `readable_teams(actor, scope:)` now takes an optional scope; the layer calls it rather than reimplementing. |
| **C3** | The layer's read fanned out: two queries per supervised team, and grants fetched twice. | `peers_of` is one symmetric statement; grants are fetched once and shared with the core read. |
| **C4** | Docs said the permission layer was "not built" while the model builds and exercises it. | README *Status* now says it exists in the executable model (`src/` with `examples/`) and is not yet wired into an application. |
| **C5** | `grant_identity` omitted `organization_id`, so one actor could not hold the same role at one scope for two organizations. | `organization_id` added to the unique index. |
| **C6** | No team-side index on `grant`, so the trust view ("who holds a grant over team T") scanned. | Added `grant_by_team`; added `grants_on_team` and a planner check. |
| **C7** | `peers_of` ignored `kind` while `peers?` filtered it. | Both are parameterized by `kind` and default to `peer`. |
| **C8** | `team_link.scope_id` is a second denormalization, unmentioned. | Documented in the operations layer and in the model's denormalization rule. |
| **C9** | `kind IN ('peer')` was a schema enum, contradicting "policy in data". | The CHECK is gone; `kind` is application vocabulary like an action. |
| **C10** | Operation-scoped teams were invisible to site reads. | Site reads now use scope coverage, so an operation-scoped team is readable at its nested sites. |
| **C11** | `operations_layer.md` said "the four rules of the core"; the core has eight. | Reworded to "the core's rules". |
| **C12** | README claimed the scripts assert "every rule" and "each stated cost bound". | Reworded: each script asserts its own rules and checks its own bounds. |
| **C13** | Efficiency table omitted `grant_one_default`. | Added, with `grant_by_team` and the wearability row. |
| **C14** | "five entities … and nothing else" read as excluding the layer's own entities. | Reworded to name the core and point at the layer. |
| **C15** | Activation re-validation (rule 7) was stated but never tested. | Added a revoke-then-recheck demonstration with an assertion; the check runs through `worn`. |
| **C16** | `add_scope` set the path in two statements; a crash could leave a bad path. | Insert and path update are now one transaction. |
| **C17** | The process-per-statement adapter was unmentioned, so bounds could read as latency. | Noted in the model header and the efficiency section. |
| **C18** | SQL beginning with `--` was parsed by the `sqlite3` CLI as an option. | SQL is now piped over stdin, not argv. |
| **C19** | The core class was named `Toy`, which no longer matched its role. | Renamed to `Model`. |
| **C20** | No way to run both scripts together. | Added `bin/check`. |
| **C21** | Foreign keys were declared but not enforced: each `Db` call is a new connection. | The adapter turns `PRAGMA foreign_keys = ON` on every connection. Found while fixing C18. |
| **C22** | Root scope names were not unique, because SQLite treats NULLs in a unique index as distinct. | `scope_identity` uses `COALESCE(parent_id, -1)`. Found while fixing C16. |
| **C55** | Rename `org-hats` to `acting-hats` (2026-10). | Declined. Four reasons: `org` is the domain word — the package is a *reusable organization model*, and the proposed name drops its only retrieval hook; *acting* carries the temporary-deputy connotation the model's explicit-grant principle exists to reject; it collides with two terms of art already in the repo — the **acting-hat snapshot** (OH-QM-05) and the *worn* hat; and it would orphan the frozen `OH-QM` ids and `OrgHatsRepository` for a pinned consumer. Recorded as D6 in [publishing.md](publishing.md). |

## Streamlining pass

| Id | Concern | Resolution |
| --- | --- | --- |
| **C23** | `wear` duplicated the re-validation `worn` already performs. | Removed `wear`; the revocation demonstration uses `worn` and asserts the revoked grant is not returned. |
| **C24** | `grant_by_scope` had no query, an unused index. | Removed it. |
| **C25** | `membership_by_team` had no query either. | Added `members_of` — now capability-derived (author-grant holders over the team), so the membership table and its index were removed entirely (C44). |
| **C26** | The operations layer used `resolve` as a proxy for "supervises". | Defined an explicit `read_reports` action; `supervises?` uses it, so a supervisor is whoever may read the team's reports. |
| **C27** | Primary versus default was stated abstractly. | Added the illustration: the chief executive's primary hat is *CEO*, and their default may be *Janitor*. |
| **C28** | C24 removed `grant_by_scope`, leaving no index for a scope-side trust view. | Reinstated it as a documented, no-caller index, retained for the deferred scope-side query (D7). (A consumer runs the same razor the other way — no index without a caller, per C24 — and defers its trust-view index until the queries exist, its phase 8. Both readings are one discipline: an index earns its keep or it goes.) |

## Consumer review

Raised reviewing the model against a consumer's application. The open items are decisions for that host; the ids are addresses, not a to-do list here.

| Id | Status | Concern | Resolution / next |
| --- | --- | --- | --- |
| **C29** | resolved | A scope-bound configuring grant added read reach: `organizations_of` counted every grant as affiliation, so a config-only actor read its organization's teams. | Read reach derives only from team-bearing affiliation (membership or team-bound grant); the walkthrough asserts a config actor reads nothing. |
| **C30** | resolved | Where does the site live — on the team, or on the grant? | Reading **A** chosen (both sides): scope stays on the **team**, `team(scope, name)` unique per scope, `grant` team-xor-scope, `team_scope` deleted. `drive@north` and `drive@south` coexist; a team spanning sites is N rows, which no reader needs. |
| **C31** | open | One primary per organization means a multi-organization actor has no defined landing hat. | **Storage taken by the consumer; the interaction stays open.** The schema is adopted (per-organization primary, `is_default`) and the landing rule is still owed at the session layer. Not resolved by adoption. The request spine (`src/decide.ts`, v0.2.0) takes a position — an optional `organizationId` filters wearability, so the organization is request context, never session-global — but the host's landing interaction is still its own. |
| **C32** | resolved | Revocation deletes grants, so a grant id cannot reconstruct an act's hat. | A consumer records an immutable, legible snapshot on every act and proved it (OH-QM-05): close a report under a supervisor hat, delete the hat, the hat can no longer be worn (409), and the audit row keeps the recorded name — a legible `role:team@site`. |
| **C33** | resolved (consumer) | Adopting roles + capabilities reverses an earlier deletion and the reservation of `role`. | The consumer adopts it: one CONFIGURE verb gates ten routes across four unrelated verb families, so the capacity split C33 awaited is visible in call sites. Its own decision entry; `role` stops being reserved. |
| **C34** | open | The multi-organization read rule: union every organization served, or follow the worn hat's organization? | **Site half fixed structurally by reading A** — the path-prefix `readable_teams` is site-scoped, closing a defect where a bound site parameter was ignored. The **organization half stays open and is the consumer's**: does a multi-organization actor read every organization they serve, or the worn hat's? Noted: the choice is already encoded in the port's signature — `readableTeamsAt(hats, …)` unions `organizationsOf(hats)`, so passing the worn organization's hats is follow-the-worn and passing all held is union. A host policy flag, never a schema change. |
| **C35** | resolved | The mapping was overstated and two stages mis-described. | Corrected: member hats are the one case needing grant + membership; Identity yields session claims; the site object parses the edge's assertions once. |

## Implementations

Raised reviewing the TypeScript implementation. C36–C42 track it.

| Id | Status | Concern | Resolution / next |
| --- | --- | --- | --- |
| **C36** | partial | "Lockstep" was claimed but not enforced: `bin/check` ran four walkthroughs, not one contract. | The examples now assert the same rules and planner bounds case-for-case — including the fold (C44) and the A-shape uniqueness (C43) — and `bin/check` requires `node` instead of silently skipping. The shared case inventory now exists as data (C45). |
| **C37** | resolved | No runtime-neutral conformance inventory; a case missing from one file goes undetected. | `src/conformance.ts` carries the ten `OH-QM` cases as data with `conformanceGaps`; a host runs a body per id and fails on a missing or unknown id. `examples/conformance.ts` proves all ten against the reference adapter, in `bin/check`. |
| **C38** | resolved | `Model` is coupled to the concrete `Db`/`node:sqlite`, and the library files also carry Node-only walkthroughs. | Split done: `src/core.ts` (pure), `src/conformance.ts`, `src/port.ts` (the async `OrgHatsRepository`), `src/node.ts` (the only `node:*`, behind `org-hats/node`), and `examples/` (the walkthroughs). The `Model` class is gone. |
| **C39** | open | Write invariants (first-grant-primary, cross-org, peer shape) are read-then-write, not atomic. | State the atomicity contract; a D1 adapter must enforce it in a transaction or by a constraint. |
| **C40** | resolved | `can`/`reach` accepted an object that could hold both `team` and `scope`. | `can`/`reach`/`addGrant` now take a `Target` union, so team-xor-scope is a compile-time error. |
| **C41** | resolved | Every id was a plain `number`, so actor/role/team/scope ids were interchangeable to TypeScript. | Ids are now caller-supplied `TEXT`/`string` throughout: the model never mints one, `Target.id` is a string, and `lastInsertRowid` is gone. Scope ids must not contain `/` (documented). Branded ids remain a caller's own boundary choice. |
| **C42** | resolved | `SCHEMA`/`OPS_SCHEMA` are a reference, not a migration path; the package was `private` with no exports or lockfile. | Done: `exports` (`.` and `./node`), `files: ["dist"]`, `version 0.1.0`, `private` gone, zero runtime deps, committed `dist/` (`.js` + `.d.ts`) and `pnpm-lock.yaml`. The schemas stay a reference; a host owns its migrations. |

The five consumer decisions (C30–C34) remain the gate; a language port does not resolve them.

## Model convergence

Raised agreeing the shared shape with the consumer.

| Id | Status | Concern | Resolution / next |
| --- | --- | --- | --- |
| **C43** | resolved | Site on the team, or on the grant? | **A**: scope on the team; `UNIQUE(scope_id, name)`; `grant` team-xor-scope; `team_scope` deleted. `drive@north` and `drive@south` coexist; distinct supervisors, distinct teams. |
| **C44** | resolved | Membership as a separate edge allowed two independently writable rows per member (OH-QM case 5). | Folded: affiliation is a team-bound grant whose role may author; the `membership` table is gone. `maySpeak(worn, team, held)` = the worn hat reaches the team **and** some held grant over it carries AUTHOR — so a lead files without switching hats, and a supervisor is no member. |
| **C45** | resolved | No shared, named conformance inventory between the two repos. | Adopted as data. `src/conformance.ts` carries `OH-QM-01`…`OH-QM-10` with `conformanceGaps` (fails on a missing or unknown id); `examples/conformance.ts` runs all ten against the reference adapter. The consumer runs the same ids against its own. |
| **C46** | resolved | A unique key on client vocabulary would collide when two operations share one database (a host may run many operations in one database). | Audited every UNIQUE: `organization` is now keyed on `(root scope, name)` and carries a `scope_id`; `actor.name` dropped its unique (a label); `team` was already `(scope, name)`; `scope_identity` is per-parent. `role`/`capability` stay global by decision (C33). |
| **C47** | resolved | `organization.scope_id` references `scope(id)` generally, but the rule is "an organization belongs to a *root* scope"; nothing held it there. | A `CHECK` cannot say "this id is a root", so it is a probe — `organizations_not_at_a_root`, the same pattern used for the other invariants SQL cannot state. The walkthrough adds a site-scoped organization, shows the probe find it, and removes it. |
| **C48** | resolved (decision) | Does the operations layer ship in the package? | No. It stays a reference example here: it names an application concept, and under C42 a package installs no schema. A consumer keeps its own peer table — canonical CHECK, site-local, one hop, supervisors-only — and owns its own topology; no `kind` column until something needs it. |

## Consumer review, round two

Raised by Quartermaster's review of v0.2.0 (October 2026), delivered over the consumer channel. Their standing policy — rely on upstream, ask rather than shim — is why these are requests and not divergences. All six are resolved in v0.2.1; none is breaking.

| Id | Status | Concern | Resolution |
| --- | --- | --- | --- |
| **C56** | resolved | `HeldHat` carried ids only, so the legible snapshot (`supervisor:drive@north`) was underivable — and the port returned `HeldHat`, stripping a host's name extension at the boundary, forcing a re-declared port. | `roleName`, `teamName`, `scopeName` are optional fields on `HeldHat` — adapter-filled from joins the adapter already makes (the reference fills them), read by the predicates never. The port needs no re-declaration; the interface stays open for hosts that extend further. |
| **C57** | resolved | `wearableAt` and `wornHat` were typed over `HeldHat`, so a host passing its extended hat got `HeldHat` back at every call site and wrapped both with casts. | Both are now generic in the hat type (`<H extends HeldHat>`); they only select from the array they are given, so the change is sound and free. The wrappers delete. |
| **C58** | resolved | `wornHat`'s claim was id-only, and `DecideRequest.claimedHatId` likewise — a name-keyed session claim (a UUID does not survive a re-seed, a name does) carried a `grantIdForName` translation shim. | `HatClaim = Id | ((hat: HeldHat) => boolean)`. A matcher claim resolves against the wearable set like an id; `Decision.claimed` records the id when the claim was an id, and the grant it resolved to when a matcher resolved. |
| **C59** | resolved | `childPath` built a path but nothing read one — a host carried its own `leafScopeId` to parse paths back into ids, and would get it wrong the day the format changed. | `leafScopeId` and `parentPath` are exported beside `childPath`: the format is the model's, so its parser ships with its builder. |
| **C60** | resolved | The documented site filter — `? LIKE s.path || '%'` — is not portable: a consumer measured Cloudflare D1 rejecting LIKE patterns of fifty characters and up, and UUID-built paths exceed that one level below the root. The reference's `node:sqlite` limit is far higher, so the failure was invisible upstream. | The reference adapter now compares with `substr(?, 1, length(s.path)) = s.path` — same answer, no pattern — and the model doc states `substr` as the portable form with the D1 measurement ([organization_model.md](organization_model.md) § *Efficiency*). |
| **C61** | resolved | The port's docs read as a cheap pure function — the naive wiring re-queries `hatsOf` several times per request — and said nothing about foreign keys. | Both stated in `src/port.ts` and [package.md](package.md) § *The port*: memoize `hatsOf` per request in the adapter; an adapter may run under enforced foreign keys (D1 enforces them), which orders inserts — the scope row precedes what references it. |

## Consumer review, round three

Raised by Quartermaster's v0.2.2 adoption report (October 2026). One entry; no requests, one observation made contractual.

| Id | Status | Concern | Resolution |
| --- | --- | --- | --- |
| **C62** | resolved | `perRequest`'s one-request lifetime was documented prose, proved only in the consumer's own suite — the reference's OH-QM-05 body reads the store directly, so a host wiring the memo across requests would pass every upstream case. | **OH-QM-11** (v0.2.3): two requests, two memos, a revocation between them — the hat is worn by the first and not by the second, and the claim's fallback shows the drift. The inventory grows by design; a host reports the id missing until it adds a body. The consumer's measurement (three concurrent asks → one read; the promise is memoized, not the result) is now stated in [package.md](package.md) § *The port*. |

## Literature review

Raised by the [literature review](literature_review.md), October 2026. Both are named positions, not defects found.

| Id | Status | Concern | Resolution / next |
| --- | --- | --- | --- |
| **C53** | resolved (decision) | Grant *administration* was unmodeled: the model constrained what a grant is, never who may write one — anyone a host's routes allow could grant anything. | **Dissolved: administration is an action.** Granting is an act like any other — an action (`grant`) whose worn hat reaches the new grant's target, plus the organization write-check that already exists. Same spine, same audit row, no new concept; the write-side statements will demonstrate it. ARBAC97 lands as data. |
| **C54** | resolved | Rule 7's immediacy has no stated cost: revocation takes effect at once *because* every request re-reads the grants, while Zanzibar buys global scale by trading exactly that away (bounded staleness). | The posture is stated ([package.md](package.md) § *The request spine*): one `hatsOf` per request, no cache. The scale answer is a **request-scoped snapshot** — `perRequest(repo)`, v0.2.2: memoize within a request (two decisions cannot disagree mid-request), never across requests (revocation lands on the next one). A zookie with a one-request lifetime. |

## TypeScript module

Turning the monolith into a package (see [`package.md`](package.md)).

| Id | Status | Concern | Resolution / next |
| --- | --- | --- | --- |
| **C49** | resolved | The TypeScript was a monolith, synchronous over `node:sqlite`, not a library. | Split into `src/core.ts` (pure records + predicates), `src/port.ts` (the async `OrgHatsRepository`), `src/db.ts` + `src/node.ts` (the only `node:*`), and `examples/`. The `Model` class is gone; predicates are functions over `HeldHat`. |
| **C50** | resolved | Runtime neutrality was review-enforced, not compiler-enforced. | `tsconfig.core.json` compiles `src/core.ts` + `src/conformance.ts` + `src/port.ts` with `types: []`, so a `node:*` import fails to compile (proved: a file importing `node:sqlite` fails the fence). `bin/check` runs the fence first. |
| **C51** | resolved | The package was not yet installable: no `dist/`, no tag. | `dist/` is built and committed (`.js` + `.d.ts`); `exports`/`files`/version set; zero runtime deps; fence and examples green; verified in workerd by a consumer. The `v0.1.0` tag remains Rick's. |
| **C52** | resolved | Nothing said plainly what a grant's `organization_id` meant, so a host could read it as derived from the team and leave a configuring grant employless. | The model doc now states that a grant's organization is **who employs the holder**, independent of whether the grant aims at a team or a scope; a configuring grant still has one. A consumer arrived with exactly such grants, and the `NOT NULL` column is what caught it. |

## Deferred by design

These are not defects; they are the trade-offs the model names and deliberately declines until a use case needs them.

| Id | Deferred | Where |
| --- | --- | --- |
| **D1** | Role hierarchy — inheritance. | *In the literature*, *Outside the model* |
| **D2** | Declarative separation of duty (beyond one active hat). | *Permissions*, *In the literature* |
| **D3** | Dropping `is_default` to collapse the three-level worn resolution. | Open simplification, not yet taken |
| **D4** | A closure table for scopes, if scopes move often. | *Implementation notes* |
| **D5** | Projections and read auditing (what a supervisor actually read). | Not modeled; the audit log is the application's |
| **D6** | Time-bounded grants and activation windows. | *Rules* 1, *Example*. Landing spot named: the adapter, never the core — validity is read-side filtering in `hatsOf`, which already means “the grants still held.” See [literature_review.md](literature_review.md) § GRBAC |
| **D7** | A scope-side trust view — which grants reach a scope. | `grant_by_scope` is retained for it; no query asks yet |
| **D8** | Negative grants — an exclusion edge (“everyone at this scope except…”). | *Outside the model*; see [literature_review.md](literature_review.md) |

## Raising a concern

Add the next `C` number at the end of *Resolved* when it closes, or under a new heading while it is open. Never reuse or renumber an id. Cite it from the change that closes it.
