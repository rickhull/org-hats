# Lexicon misuse — remaining violations

*The obvious fixes landed in `e451a62`. This plan orders what remains. The
normative vocabulary is [`docs/lexicon.md`](../docs/lexicon.md); the open
register, including judgment calls and considered-not-concerns, is
[`docs/lexicon_use_concerns.md`](../docs/lexicon_use_concerns.md).*

A violation here means a word that names a different model concept in
current behavior. Synonyms, external comparison vocabulary, and deliberate
historical contrasts are not violations; they are recorded in section 3.

## 1. Low-hanging fruit

These are clear violations, local and mechanical, with no public interface
change.

### 1.1 Test and fixture vocabulary

- `src/conformance.ts:71` — `invitee-admin` and `actor-inv-admin` are
  fixture strings for the invitee organization's administrator. Rename to
  `invitee-lead` / `actor-inv-lead`, or to the example role chosen in 2.2.
- `packages/cloudflare/test/roster.test.ts:14-15` — `ADMIN` and `MEMBER`
  actor constants. Rename to the fixture roles (for example `LEAD` and
  `FIELD`) or to neutral actor names.
- `packages/cloudflare/test/exchange.test.ts:22-23` and
  `packages/cloudflare/test/runtime.test.ts:150` — `qm-tenant` and
  `tenant.example`. Rename to `qm-host` and `host.example`.
- Acceptance: test names and fixture strings no longer use model-avoided
  words; assertions are unchanged.
- Dependency: 2.2 may choose the role title. 1.1 can land first with
  neutral names, or wait and align.

## 2. Foundation / fundamental

Clear violations that need an interface break, a wire-format decision, or a
product decision.

### 2.1 `no-capability` denial reason

- Where: `src/model.ts:333,367,371`; `src/conformance.ts:373,376`;
  `tests/model.test.ts:110,113`; `tests/generative.test.ts:179`;
  `docs/inventory.md:18`; `docs/tutorial.md:273`;
  `docs/migration-v1.md:35`.
- Why: the reason means “the worn role does not carry the action”; the
  lexicon says Action avoids *capability*. It names a core model concept
  wrongly and is public.
- Decision: freeze it as a historical value, rename it in an
  interface-breaking release with a migration note, or add a new reason and
  retire the old one over a window. `action-not-carried` is the obvious
  replacement.
- Work: one change updates the `Decision.reason` union, the conformance
  case title, the inventory row, tests, tutorial, and a migration note.
- Acceptance: no current denial reason uses an avoided term; the inventory
  title matches the shipped case; the migration note names the old value.
- Risk: public `Decision.reason`; a consumer may switch exhaustively.

### 2.2 Built-in `admin` role

- Where: `src/authority/twins.ts:70,134,162,237`;
  `src/conformance.ts:412,469`; `README.md:19`;
  `docs/tutorial.md:55,324,347,542,569`.
- Why: the lexicon says Administration avoids *admin* as a built-in role.
  The role is policy data, not an engine constant, but the built-in twins
  make it look canonical.
- Decision: rename the example role, or keep it and state in the docs that
  it is fixture policy data, not a built-in title.
- If renaming: Professional Operation's configure role → `chief`;
  Festival's configure role → `chief` (its `steward` title is already in
  use). The Airlift has no `admin` role; its configure role is `duty
  officer`.
- Work: update the twins' role titles and grants, conformance roles and
  assertions, README/tutorial, tests, and any inventory title that names
  the role. Decide separately whether `adminRoles`/`orgAdmins` config field
  names move with it.
- Acceptance: the built-in example worlds no longer ship an `admin` role,
  or the docs explicitly say the title is fixture data and not built-in.
- Risk: first-contact README/tutorial copy; conformance assertions.

### 2.3 `memberTeamIds`

- Where: `src/access/types.ts:50`; `src/contract.ts:260`;
  `tests/fixtures/envelope-vectors.json`; the access and claims tests;
  `docs/envelope.md`, `docs/positioning.md`, `docs/from_ldap.md`,
  `docs/authority_redesign.md:231`, `docs/tutorial.md`.
- Why: *member* is not the actor or target word; the comment already says
  the name is historical and not a directory membership list. The layer is
  “member reach.”
- Decision: keep the wire field and method for envelope format 1 and
  document the historical name; add a neutral accessor such as
  `teamReach()` in a later release; or rename in an interface break.
- Work: do not rename the envelope field without a format version. A
  method rename is not a wire change but is still a public interface
  change.
- Acceptance: a recorded decision; if a new accessor, tests and docs; no
  silent wire change.
- Risk: public neutral-access method and envelope claims field.

## 3. Everything else

Judgment calls, negative historical references, and considered-not-concerns.

### 3.1 Normative self-use

- `docs/lexicon.md:19` — Operation is “the scope in which authority is
  exercised”; Site and Reach avoid *scope*. Decide whether the generic use
  is an exemption. If not, use “domain” or “extent.”
- `docs/lexicon.md:105-106` — Read policy names a “team-audience axis”;
  Read reach avoids *audience* for the computed result. The axis has not
  landed. Rename to “team-read axis” and update
  `docs/authority_redesign.md:499,731-732`, or record the axis as an
  exemption.
- Acceptance: the lexicon either avoids the word or states why the generic
  or design use is exempt.

### 3.2 Negative historical references

Clear avoided words, but they may be deliberate v0.4 contrasts. Reword or
mark them historical; no behavior change.

- `src/model.ts:15` — “capability tables” → “entities or ad-hoc tables.”
- `src/model.ts:17` — “scope-path” / “coverage walk” → “path hierarchy” /
  “inheritance walk.”
- `README.md:28` — “group grants” → “grants to groups” or “group
  principals,” or leave as an explicit external contrast.
- `docs/migration-v1.md:31-35` — keep the historical vocabulary; the
  migration note is the documented exception.
- Acceptance: current-behavior prose no longer uses the word; historical
  contrasts remain clearly marked.

### 3.3 Considered, not violations

- `tests/consumer-surface.ts:126` — “You do not have permission…” is host
  product copy for a denial, not the model’s Action.
- `src/access/index.ts:11` — “vectors ship here” is the packaging idiom.
- `Site.path` and operation `slug` are routing facts; ids resolve and
  aliases decorate.
- `src/contract.ts` — “session surface” is the authority’s
  issuance/refresh/context API, not the host’s session transport.
- Cloudflare “service binding”, access-request “queue”, database
  “mutation”, and JavaScript “object” are platform or implementation terms.
- `packages/cloudflare/test` uses `qm-tenant` and `tenant.example` as
  fixture strings; covered by 1.1.
- Keep these in `docs/lexicon_use_concerns.md` so they are not
  re-litigated.

### 3.4 Deferred decisions

- `adminRoles`/`orgAdmins` are declared-policy configuration fields, not
  built-in role titles. Keep them unless 2.2 decides the word must leave
  the config surface too. Record the decision with 2.2.
- Any consumer-facing term that Quartermaster needs to review. Do not
  rename a wire value without their sign-off.

## Ordering

1. 1.1 can land independently; 3.1 and 3.2 are docs decisions.
2. 2.1 and 2.3 need an interface or migration decision before code.
3. 2.2 is a product decision; if renaming, do the twins, conformance, docs,
   tests, and inventory in one change.
4. 3.x are decisions, not churn.

## Done criteria

- No current-behavior use of an avoided term remains in source, tests,
  fixtures, or normative docs, or an explicit exemption is recorded.
- Every remaining public name (`no-capability`, `memberTeamIds`, `admin`
  role title) has a recorded decision or migration note.
- `docs/lexicon_use_concerns.md` is updated as items land.
