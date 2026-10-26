# Lexicon misuse — remaining violations

*The plan that drove the remaining lexicon fixes. The normative vocabulary
is [`docs/lexicon.md`](../docs/lexicon.md); the open register is
[`docs/lexicon_use_concerns.md`](../docs/lexicon_use_concerns.md).*

## Status

- **Done:** test and fixture names (except the shared Cloudflare roster
  constants, deferred); built-in `admin` role kept and documented as
  fixture data; team-read rename; current-behavior comments.
- **Decided / deferred:** `no-capability` freezes for interface 2;
  `memberTeamIds` stays for envelope format 1.
- **Open:** none until an interface break or consumer review.

## 1. Low-hanging fruit

### 1.1 Test and fixture vocabulary — Done

- `invitee-admin` / `actor-inv-admin` → `invitee-lead` /
  `actor-inv-lead` in `src/conformance.ts`, `tests/generative.test.ts`,
  `tests/engine.test.ts`, and the Cloudflare runtime test.
- `qm-tenant` / `tenant.example` → `qm-host` / `host.example`.
- Roster `ADMIN` / `MEMBER` — **deferred**: `helpers.ts` shares
  `actor-admin` / `actor-member` across the Cloudflare suites; rename the
  helper and all users together, or leave.
- Acceptance met except the deferred roster constants: no old fixture
  names remain in code or tests outside that shared fixture.

## 2. Foundation / fundamental

### 2.1 `no-capability` — Decided: freeze

- Where: `src/model.ts:333,367,371`; `src/conformance.ts:373,376`;
  `tests/model.test.ts:110,113`; `tests/generative.test.ts:179`;
  `docs/inventory.md:18`; `docs/tutorial.md:276`;
  `docs/migration-v1.md:35`.
- Decision: freeze for interface 2. It is a historical denial reason;
  rename only in a major with consumer review and a migration note.
  `action-not-carried` is the replacement if that break is taken.
- No code change now. Reopen with an interface break.

### 2.2 Built-in `admin` role — Done: kept and documented

- Where: `src/authority/twins.ts:72,136,164,239`;
  `src/conformance.ts:412,469`; `README.md:19`;
  `docs/tutorial.md:55,327,350,545,572`.
- Decision: keep the fixture role title. The twins comment, README,
  tutorial, and walkthrough now state that it is example policy data, not a
  built-in administrator title. A rename would change public conformance
  data and needs consumer review.
- Test-local role titles in `tests/engine.test.ts`, `tests/generative.test.ts`,
  and the Cloudflare package remain; they are not built-in examples.

### 2.3 `memberTeamIds` — Decided: keep for format 1

- Where: `src/access/types.ts:50`; `src/contract.ts:260`;
  `tests/fixtures/envelope-vectors.json`; the access and claims tests;
  `docs/envelope.md`, `docs/positioning.md`, `docs/from_ldap.md`,
  `docs/authority_redesign.md:231`, `docs/tutorial.md`.
- Decision: keep the wire field and method for envelope format 1 and
  document the historical name. A neutral `teamReach()` accessor can be
  added in a later additive release.
- Do not rename the wire field without a format version. A method rename
  would still be a public interface change.

## 3. Everything else

### 3.1 Normative self-use — Done

- Read policy “team-audience axis” → “team-read axis” in
  `docs/lexicon.md:105-106` and `docs/authority_redesign.md:499,731-732`.
- Operation’s “scope” is accepted as the generic extent of the undertaking,
  not Reach’s scope. Recorded as an exemption in the register.

### 3.2 Negative historical references — Done

- `src/model.ts:15` “capability tables” → “ad-hoc tables”.
- `src/model.ts:17` “scope-path” / “coverage walk” → “path hierarchy” /
  “inheritance walk”.
- `README.md:28` “group grants” → “grants to groups”.
- `docs/migration-v1.md:31-35` keeps the historical vocabulary; the
  migration note is the documented exception.

### 3.3 Considered, not violations — Recorded

- Product-copy “permission”, packaging “ship”, routing `Site.path` and
  operation `slug`, the authority “session surface”, and Cloudflare /
  implementation terms. The rationale is in the register.

### 3.4 Deferred decisions

- `adminRoles` / `orgAdmins` remain declared configuration fields, not
  built-in role titles.
- The shared Cloudflare roster constants (`actor-admin` / `actor-member`)
  move only when `helpers.ts` and all its users are renamed together.
- Any consumer-facing wire value. Do not rename one without consumer review.

## Reopen when

- An interface version break is planned (2.1, 2.3).
- The consumer asks to align a public fixture or wire name (2.2, 2.3).
- A new document or test uses an avoided term in current behavior.

## Done criteria

- No current-behavior use of an avoided term remains in source, tests,
  fixtures, or normative docs, or an explicit decision/exemption is
  recorded.
- Every remaining public name (`no-capability`, `memberTeamIds`, `admin`
  role title) has a recorded decision.
- `docs/lexicon_use_concerns.md` is updated when an item lands or reopens.
