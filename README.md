# org-hats

*Portable organizational authority: who may act, in what capacity, over which
target, in which operation.*

Most access checks begin as "is this user an admin?" That question stops
working when one organization takes part in several operations, each with its
own sites, teams, and policy; when the same person wears different hats in
different places; and when the answer has to travel to another service
without handing over the authority database.

org-hats models the narrower, harder question:

> **may act = the worn role carries the action × the grant reaches the
> target**

The model is portable. The reference runtime is Cloudflare. The same four
portable use cases are exposed by an in-memory engine for tests and examples,
and by the Cloudflare reference runtime for deployment.

```text
organization ── participation ── operation
     │                              ├── sites
   actors                           │     └── teams
     │                              ├── policy bundle
     └──────── grants ──► worn hat ─┘
```

An operation-local grant is an actor, a role, and one target; the hat is the
grant worn now.

## Run it

With Node 24+ and pnpm:

```sh
pnpm install
node examples/pilot.ts
```

The pilot is a complete small story: one organization, one operation, one
actor, one hat, one signed envelope, one local decision, and one expiry. It
uses the synthetic Professional Operation and Harbor Logistics; there are no
real people or customer records in this repository.

For the full gate:

```sh
pnpm verify
```

That runs the portable suites, the compiler fences, the test/example
typecheck, the pilot, and the Cloudflare workerd suite. `pnpm test` runs only
the portable suites;
`pnpm check:cloudflare` runs only the reference runtime's typecheck and tests.
The Cloudflare suite runs locally; it needs no Cloudflare account.

## The idea in five steps

### 1. An organization takes part in an operation

An **organization** is the durable body an actor belongs to. An **operation**
is a bounded or persistent undertaking with its own sites, teams, policy
version, and grants. The relationship is many-to-many.

An operation has **sites** — places where work happens — and **teams** — an
organization's group anchored to exactly one site. The organization–operation
relationship is **participation** (`invited → accepted → active`, revocable by
either side), and no hat is wearable until participation is `active`.

**Admission** is the operation's acceptance of one actor to act there. It is
neither authentication nor participation: an active organization can still
have an actor who is not admitted.

### 2. Evidence becomes an actor

An **actor** is a durable identity scoped to one organization:
`(organizationId, actorId)`. The same real person in two organizations is two
actors; equal email addresses never merge them.

A **principal** is the external subject an identity provider vouches for.
**Evidence** is a typed assertion — provider, subject, optionally a display
name and authentication facts. A **principal link** binds that external
subject to an organization actor. Resolving evidence creates no participation
and no hat; authentication is not authority.

### 3. A grant is held; a hat is worn

The **policy bundle** is versioned data: an action vocabulary, roles that
carry actions, and a read policy. A **role** is a title in that data; an
**action** is an opaque verb such as `review`.

A **grant** assigns a role to an actor over exactly one **target**: a **team**,
or a **site** and every team at that site. A grant is held. The **hat** is the
grant the actor wears when acting: one role, its actions, and its target. An
actor may hold several grants but wears exactly one hat at a time. Authority
chooses it from the wearable grants — primary first, then a deterministic
fallback — and `select-hat` changes which grant is primary.

A grant is **wearable** when it is not revoked, the actor is enabled, and the
organization's participation is active. **Reach** is separate: a team grant
reaches its team; a site grant reaches its site and every team at that site.
Nothing reaches the whole operation, and there is no hierarchy, prefix
coverage, or inheritance.

**Read reach** is the issuer's computation under the bundle: `granted-teams`
follows the teams the actor's wearable grants reach; `all-participating`
follows every active organization. The verifier compares ids; it never
rebuilds the rule.

### 4. Issue and verify

When the actor has a wearable hat, the host asks the authority runtime for
access. The result is `{ envelope, refresh }` or a closed failure. The
**access envelope** is a signed projection of the actor pair, the operation,
the worn hat's role/actions/reach, the sites the grants touch, readable
organization and exceptional team ids, configurable sites, and `iat`/`exp`.
It is not a JWT; it is `org-hats.access` format 1, signed with Ed25519 over
canonical JSON. The **refresh handle** comes with an explicit outcome — kept,
rotated, or revoked.

The host hands the envelope to `org-hats/access` with the verification keys
and its expectations. On success it gets **neutral access** —
`mayAct(action, target)`, `readableOrganizationIds()`, `readableTeamIds()`,
`mayConfigure(siteId)`, and `expiresAt()` — not raw claims. The verifier gates
on the envelope's format and version pair, checks the signature, expiry, and
the caller's expected operation and site binding, then evaluates the worn hat
locally. It does not rebuild reach, participation, or fallback.

A wrong operation or site fails `wrong-binding`; a correct envelope at or
after `exp` fails `expired`; an unsupported format fails
`wrong-interface-version`; a bad signature fails `invalid-signature`. All
failures are values from one closed taxonomy; the deploying host owns the
product response.

### 5. Change and refresh

Reads are local; changes go through the runtime. A **command** is a typed,
idempotent business act: `request-access`, `admit`, `grant-hat`,
`revoke-grant`, `select-hat`, `disable-actor`, and the participation commands.
It carries an authorization (an access envelope or fresh evidence), an
interface version, and an idempotency key. The runtime validates the whole
command before committing; the claim commits with the mutation, so a retry
returns the original result and a denied command cannot poison its key.

A session outlives one envelope. `refresh(handle)` issues a replacement and
states what happened to the handle. Revoking a grant revokes affected refresh
records; a disabled actor cannot refresh because the runtime re-resolves the
actor at the organization. That read is read-only and fail-closed: a missing
or disabled actor is `not-admitted`; an organization that cannot answer is
`unavailable`. A lost disable message must not become indefinite authority;
the envelope's bounded lifetime covers the rest.

> **Going deeper:** [`docs/tutorial.md`](docs/tutorial.md) follows one actor
> through two operations, then through commands, refresh rotation, a lost
> disable message, and the crossed grant in the Berlin Airlift twin.

## The pieces

- **`org-hats`** — the portable model: organizations, operations, actors,
  sites, teams, grants, participation, wearability, worn-hat selection,
  `decide`, `readReach`, `invariantProblems`, and the policy-bundle
  vocabulary. Data and pure functions; no I/O, storage, clock, or Cloudflare.
- **`org-hats/authority`** — the normative `AuthorityRuntime`
  (`accessFromEvidence`, `refresh`, `context`, `command`), plus the in-memory
  engine and the synthetic twins. Callers ask for complete use cases, not a
  grant repository.
- **`org-hats/access`** — verification only: `verify` turns a signed envelope
  into neutral access; `VerifyKeySet` is the rotation unit; fixed vectors pin
  the format.
- **`org-hats/conformance`** — the executable `OH-*` inventory, run through
  the public interface only. `CONFORMANCE_WORLD` supplies the synthetic
  fixtures, links, and org-admin bootstrap; another runtime supplies its own
  world factory.
- **`org-hats-cloudflare`** — the reference runtime as a separate `0.x`
  package: the two SQLite-backed coordinators, the service binding and
  provider-callback exchange, signing-key rotation, authenticated ops routes,
  bootstrap, schema status, export, restore, routing facts, and a demo.

The portable fence is load-bearing: everything under `src/` compiles with
`types: []` and imports nothing Cloudflare; `bin/check` enforces both. The
Cloudflare package depends on the portable modules, never the reverse.

The full `OH-*` inventory runs against the real coordinators in workerd. A
deployed runtime reached through a service binding has a separate, narrower
claim: the smoke subset in
[`docs/binding-conformance.md`](docs/binding-conformance.md). It is not the
full inventory.

## Versions and compatibility

- **Root package `org-hats`:** 2.0.0.
- **Authority interface:** 2 — the call signatures and command vocabulary.
- **Access envelope:** 1 — the signed claims format.
- **Cloudflare runtime:** a separate `0.x` line on `cloudflare-v*` tags; its
  operation state schema is 4.
- **Distribution:** git tags only; no registry publication. A consumer pins a
  reviewed tag or commit. Codeberg is canonical; GitHub is a release mirror.

The interface version and the envelope version move for different reasons. A
command-surface break moves the interface version; a change to what the claims
mean moves the envelope format. An envelope records the issuing interface as
provenance, but verification reads the envelope's own version pair — so the
line can be at interface 2 while still reading format-1 envelopes. The 2.0
break changed `grant-hat` to one `GrantTarget` (team or site) and moved the
interface to 2; see [`docs/migration-v2.md`](docs/migration-v2.md).

This is the 2.x line. The v0.4 surface — predicates, persistence port,
request spine, and the Node SQLite adapter — lives at its tags and is not
copied forward; the earlier 1.x package line is historical. See
[`docs/authority_redesign.md`](docs/authority_redesign.md) for the design and
[`docs/publishing.md`](docs/publishing.md) for the release ritual.

## Read next

- [`docs/tutorial.md`](docs/tutorial.md) — the longer, concrete walkthrough.
- [`docs/README.md`](docs/README.md) — the docs index.
- [`docs/types.md`](docs/types.md) — the type layer: brands, unions, compiler
  fences, and runtime boundaries.
- [`docs/lexicon.md`](docs/lexicon.md) — the normative words.
- [`docs/authority_redesign.md`](docs/authority_redesign.md) — architecture,
  state ownership, and the identity boundary.
- [`docs/envelope.md`](docs/envelope.md) — the envelope format and version
  rules.
- [`docs/cloudflare.md`](docs/cloudflare.md) — the reference runtime as built.
- [`docs/binding-conformance.md`](docs/binding-conformance.md) — the deployed
  smoke claim and its limits.
- [`specs/README.md`](specs/README.md) — the named invariants.
- [`docs/migration-v2.md`](docs/migration-v2.md) — the 1.2 → 2.0 deltas.
- [`docs/publishing.md`](docs/publishing.md) — canonical host, mirror, and
  release ritual.
- [`SECURITY.md`](SECURITY.md) — reporting and coordinated disclosure.
- [`plans/README.md`](plans/README.md) — work in flight.

Background reading: [`docs/organization_model.md`](docs/organization_model.md),
[`docs/rbac.md`](docs/rbac.md), and
[`docs/literature_review.md`](docs/literature_review.md).

## License

MIT.
