# Lexicon use concerns

*The register of lexicon-use decisions: what has been fixed, what is
accepted, and what remains deferred. The normative vocabulary is
[lexicon.md](lexicon.md); this page is a register, not a second lexicon.*

## Resolved

- Team defined as a “group”; Binding as “scoped to”; model opening
  “capacity”/“group”; twins “multi-venue”; exchange “tenant”; test prose
  “membership”/“act capability”.
- Test and fixture names: `invitee-admin` / `actor-inv-admin` →
  `invitee-lead` / `actor-inv-lead`; `qm-tenant` / `tenant.example` →
  `qm-host` / `host.example`. The Cloudflare roster `ADMIN` / `MEMBER`
  constants are deferred because `helpers.ts` shares the same actor ids
  across many suites.
- Read policy “team-audience axis” → “team-read axis”.
- Current-behavior comments: “capability tables” → “ad-hoc tables”;
  “scope-path” / “coverage walk” → “path hierarchy” / “inheritance walk”;
  “group grants” → “grants to groups”.
- Interface 3: `no-capability` → `action-not-carried`; the
  `NeutralAccess.memberTeamIds()` method → `teamReach()`. The envelope claim
  keeps the historical name `memberTeamIds`; envelope format 1 still reads.
  See [migration-v3.md](migration-v3.md).

## Decided

### Built-in `admin` role

- Where: `src/authority/twins.ts:72,136,164,239`;
  `src/conformance.ts:412,469`; `README.md:19`;
  `docs/tutorial.md:55,328,351,546,573`.
- Decision: keep the fixture role title. The twins comment, README,
  tutorial, and walkthrough state that it is example policy data, not a
  built-in administrator title. A rename would change public conformance
  data and needs consumer review.

### Test-local role titles

- `tests/engine.test.ts:527` uses a role titled `admin` deliberately to
  prove there is no hardcoded fallback; `tests/generative.test.ts` and the
  Cloudflare package tests use local fixtures. They are not built-in
  examples; leave them unless those tests are being touched.
- `packages/cloudflare/test/helpers.ts` shares `actor-admin` / `actor-member`
  across the Cloudflare suites; the roster constants are deferred until that
  fixture is renamed as one change.
- `adminRoles` / `orgAdmins` remain declared configuration fields, not
  built-in role titles.

## Accepted exemptions

### Operation “scope”

- `docs/lexicon.md:19`; `README.md:121`. Operation’s “scope” is the generic
  extent of the undertaking, not Reach’s scope. Accepted.

### Considered, not violations

- `tests/consumer-surface.ts:126` product-copy “permission”.
- `src/access/index.ts:11` “vectors ship here” packaging idiom.
- `Site.path` and operation `slug` routing facts.
- `src/contract.ts` “session surface”.
- Cloudflare “service binding”, access-request “queue”, database
  “mutation”, JavaScript “object”.
- Migration vocabulary in `docs/migration-v1.md` and the historical
  `admin` fallback comments.

## Rule

Fix a concern when the file is already being touched, or when an interface
break is planned. Do not rename a public value, conformance title, or fixture
id opportunistically; the cost is a migration, not a typo.
