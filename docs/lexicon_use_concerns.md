# Lexicon use concerns

*Open lexicon-use concerns that are not cheap fixes. The normative vocabulary
is [lexicon.md](lexicon.md); this page is a register, not a second lexicon.*

## Resolved in the last pass

These were fixed in the same change that added this page:

- Team was defined as a “group” in `lexicon.md` and `README.md`.
- Binding was defined as “scoped to” in `lexicon.md`.
- `src/model.ts` opened with “capacity” and “group”.
- The Festival twin’s comments said “multi-venue”.
- `packages/cloudflare/src/exchange.ts` comments said “tenant”.
- Test prose said “membership” and “act capability”.

## Public names

### `no-capability`

- Where: `src/model.ts:333,367,371`; `src/conformance.ts:373,376`;
  `tests/model.test.ts:110,113`; `tests/generative.test.ts:179`;
  `docs/inventory.md:18`; `docs/tutorial.md:273`;
  `docs/migration-v1.md:35`.
- Why: the reason means “the worn role does not carry the action”; the
  lexicon says Action avoids *capability*.
- Cost: public `Decision.reason`, a conformance case title bound verbatim in
  the inventory, and the migration note.
- Options: keep it as a frozen historical value and document it; rename it in
  an interface-breaking release with a migration note; or add a new reason
  and retire the old one over a window.
- Recommendation: treat it as a migration, not a quiet rename.

### `memberTeamIds`

- Where: `src/access/types.ts:50`; `src/contract.ts:260`;
  `tests/fixtures/envelope-vectors.json`; the access and claims tests;
  `README.md` and the docs use “member reach”.
- Why: *member* is not the actor or target word; the comment already says
  this is historical and not a directory membership list.
- Cost: public neutral-access method and envelope field.
- Recommendation: keep until an interface break; document the historical
  name.

### Test and fixture names

- `src/conformance.ts:71` (`invitee-admin`, `actor-inv-admin`);
  `packages/cloudflare/test/roster.test.ts:14-15` (`ADMIN`, `MEMBER`);
  `packages/cloudflare/test/exchange.test.ts:22-23` and
  `packages/cloudflare/test/runtime.test.ts:150` (`qm-tenant`,
  `tenant.example`).
- Why: they keep avoided words in the fixture vocabulary.
- Recommendation: rename only when touching those tests; they are not
  public.

## Built-in example data

### `admin` role

- Where: `src/authority/twins.ts:70,134,162,237`;
  `src/conformance.ts:412,469`; `README.md:19`;
  `docs/tutorial.md:55,324,347,542,569`.
- Why: the lexicon says Administration avoids *admin* as a built-in role.
  The role is policy data, not an engine constant, but the built-in twins
  make it look canonical.
- Options: rename the example role (for example `chief`, `lead`, or
  `steward`); or keep it and state in the docs that it is fixture policy
  data, not a built-in title.
- Recommendation: decide once and update twins, conformance, inventory,
  README, tutorial, and tests together.

## Normative self-use

### Operation “scope”

- Where: `docs/lexicon.md:19`; `README.md:121`.
- Why: Operation is “the scope in which authority is exercised”; Site and
  Reach avoid *scope*. This may be a generic use, not the same concept.
- Recommendation: leave unless it causes confusion; if changed, use
  “extent” or “boundary”.

### “team-audience axis”

- Where: `docs/lexicon.md` Read policy; `docs/authority_redesign.md:499,731-732`.
- Why: Read reach avoids *audience* when it means the computed result; the
  axis is a policy structure, not the result.
- Recommendation: keep as a design term, or rename to “team-read axis”
  before the axis lands.

## Negative historical references

These may be deliberate contrasts with the v0.4 vocabulary. Decide whether to
keep them:

- `src/model.ts:15` “capability tables”.
- `src/model.ts:17` “scope-path” and “coverage walk”.
- `README.md:28` “group grants”.
- `docs/migration-v1.md` scope-path and capability vocabulary.

Recommendation: keep them in migration or negative contexts; do not use them
for current behavior.

## Considered, not concerns

- `tests/consumer-surface.ts:126` “You do not have permission…” is host
  product copy for a denial, not the model’s Action.
- `src/access/index.ts:11` “vectors ship here” is the packaging idiom, not
  the deploy mechanic.
- `Site.path` and operation `slug` are routing facts; ids resolve and
  aliases decorate.
- `src/contract.ts` “session surface” is the authority’s
  issuance/refresh/context API, not the host’s session transport.
- Cloudflare “service binding”, access-request “queue”, database “mutation”,
  and JavaScript “object” are platform or implementation terms.
- `packages/cloudflare/test` uses `qm-tenant` and `tenant.example` as fixture
  strings; covered under test names above.

## Rule

Fix a concern when the file is already being touched, or when an interface
break is planned. Do not rename a public value, conformance title, or fixture
id opportunistically; the cost is a migration, not a typo.
