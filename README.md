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

The shape, in one picture:

```text
organization ── participation ── operation
     │                              ├── sites
   actors                           │     └── teams
     │                              ├── policy bundle
     └──────── grants ──► worn hat ─┘
```

An operation-local grant is an actor, a role, and one target; the hat is
the grant worn now.

**In this README:** [Run the tour](#run-the-tour) ·
[A walkthrough](#a-walkthrough) · [The pieces](#the-pieces) ·
[Versions](#versions-and-compatibility) · [Where to go next](#where-to-go-next)

## Run the tour

With Node 24+ and pnpm:

```sh
pnpm install
node examples/pilot.ts
```

The pilot is a complete, small story: one organization, one operation, one
actor, one hat, one signed envelope, one local decision, and one expiry. It
uses the synthetic Professional Operation and Harbor Logistics; there are no
real people or customer records in this repository. The snippets below show
the shape; `examples/pilot.ts` is the runnable version.

For the full gate:

```sh
pnpm verify
```

That runs the portable model and authority suites, the compiler fences, the
pilot, and the Cloudflare workerd suite. `pnpm test` runs only the portable
suites; `pnpm check:cloudflare` runs only the reference runtime's typecheck
and tests. The Cloudflare suite runs locally in workerd; it needs no
Cloudflare account.

## A walkthrough

### 1. An organization takes part in an operation

An **organization** is the durable body an actor belongs to. An **operation**
is a bounded or persistent undertaking with its own sites, teams, policy
version, and grants. The relationship is many-to-many: an organization can
take part in several operations, and an operation can host several
organizations.

An operation has **sites** — places where work happens — and **teams** — an
organization's group anchored to exactly one site. That anchoring is
structural: a team belongs to exactly one site.

The organization–operation relationship is **participation**:
`invited → accepted → active`, with either side able to revoke terminally.
The operation's record is canonical for whether the organization may receive
authority there; the organization owns its acceptance. No hat is wearable
until participation is `active`.

Participation gets an organization through the door. **Admission** is the
operation's acceptance of one actor to act there. It is neither
authentication nor participation: an active organization can still have an
actor who is not admitted. An access request is an authority command, never
an issuance input.

### 2. Evidence becomes an actor

An **actor** is a durable identity scoped to one organization:
`(organizationId, actorId)`. The same real person in two organizations is two
actors; equal email addresses never merge them. The organization is the unit
of identity, not a platform-wide user directory.

A **principal** is the external subject an identity provider vouches for.
**Evidence** is a typed assertion — provider, subject, optionally a display
name and authentication facts. A **principal link** binds that external
subject to an organization actor. Resolving evidence creates no participation
and no hat; authentication is not authority.

### 3. A grant is held; a hat is worn

The **policy bundle** is versioned data: an action vocabulary, roles that
carry actions, and a read policy. A **role** is a title in that data; an
**action** is an opaque verb such as `review`.

A **grant** assigns a role to an actor over exactly one **target**:

- a **team**, or
- a **site** and every team at that site.

A grant is held. The **hat** is the grant the actor wears when acting: one
role, its actions, and its target. An actor may hold several grants but wears
exactly one hat at a time. Authority chooses it from the wearable grants —
the primary first, then a deterministic fallback — and the `select-hat`
command changes which grant is primary. The host does not invent a hat from
product state.

A grant is **wearable** when it is not revoked, the actor is enabled, and the
organization's participation is active. **Reach** is a separate question: a
team grant reaches its team; a site grant reaches its site and every team at
that site. Nothing reaches the whole operation. There is no hierarchy, prefix
coverage, or inheritance. Those are the two independent clauses in the rule
above.

**Read reach** is the issuer's computation under the bundle: `granted-teams`
follows the teams the actor's wearable grants reach; `all-participating`
follows every active organization. The verifier compares the resulting ids;
it never rebuilds the rule.

### 4. Issue a signed projection

When the actor has a wearable hat, the host asks the authority runtime for
access:

```ts
const issued = await runtime.accessFromEvidence({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  operationId,
  evidence, // verified principal evidence
});
```

The result is `{ envelope, refresh }` or a closed failure. The **access
envelope** is a compact, signed projection of the facts a host needs: the
actor pair, the operation, the worn hat's role/actions/reach, the sites the
wearable grants reach, readable organization and exceptional team ids,
configurable sites, and `iat`/`exp`. It is not a JWT; it is `org-hats.access`
format 1, signed with Ed25519 over canonical JSON. The **refresh handle**
comes with an explicit outcome — `kept`, `rotated`, or `revoked` — so the host
never infers session state.

The envelope is opaque to product code. Nobody but the issuer writes claims;
nobody but the verifier reads them.

### 5. Verify locally

The host hands the envelope to `org-hats/access` with the distributed
verification keys and its own expectations:

```ts
const verified = await verify(envelope, keys, {
  now: Math.floor(Date.now() / 1000),
  expectedOperationId: operationId,
  expectedSiteId: siteId,
});
if ("failure" in verified) throw new Error(verified.failure.kind);
const access = verified.access;
```

On success, `access` is **neutral access**, not raw claims:

- `mayAct("review", { kind: "team", teamId })`
- `readableOrganizationIds()` and `readableTeamIds()`
- `mayConfigure(siteId)`
- `expiresAt()`

The verifier gates on the envelope's own format and version pair, checks the
signature, expiry, and the caller's expected operation and site binding, then
evaluates the worn hat locally. It does not rebuild reach, participation, or
fallback. The claims' `interfaceVersion` is provenance — the interface that
issued them — not a readability gate, so a command-surface change does not
strand live sessions.

A right proof for the wrong operation or site fails `wrong-binding`; a
correct envelope at or after `exp` fails `expired`; an unsupported format
fails `wrong-interface-version`; a bad signature fails `invalid-signature`.
All failures are values from one closed taxonomy. The deploying host owns the
product response to each.

### 6. Change authority through commands

Reads are local; changes go through the runtime. A **command** is a typed,
idempotent business act: `request-access`, `admit`, `grant-hat`,
`revoke-grant`, `select-hat`, `disable-actor`, and the participation
commands. It carries an authorization (an access envelope or fresh
evidence), an interface version, and an idempotency key. The runtime
validates the whole command before committing; the claim commits with the
mutation, so a retry returns the original result (`applied: false`) and a
denied command cannot poison its key.

A refusal is a normal result — `ok: false` with a kind such as `denied` — not
an exception. Commands and sessions share the same closed failure taxonomy.

### 7. Refresh is a liveness check

A session outlives one envelope. `refresh(handle)` issues a replacement and
states what happened to the handle. Revoking a grant revokes affected refresh
records; a disabled actor cannot refresh because the runtime re-resolves the
actor at the organization. That read is read-only and fail-closed: a missing
or disabled actor is `not-admitted`; an organization that cannot answer is
`unavailable`. A lost disable message must not turn a refresh handle into
indefinite authority. The envelope's bounded lifetime covers the rest of the
revocation window.

## The pieces

### `org-hats` — the portable model

The root export is the smallest reusable statement of the organization model:
organizations, operations, actors, sites, teams, grants, participation,
wearability, worn-hat selection, `decide`, `readReach`, and
`invariantProblems`, plus the policy-bundle vocabulary. It is data and pure
functions — no I/O, no storage, no clock, no Cloudflare.

### `org-hats/authority` — use cases, not a repository

This is the normative `AuthorityRuntime`: `accessFromEvidence`, `refresh`,
`context`, and `command`. It owns evidence resolution, participation and
admission workflows, grants, hat selection, issuance, idempotency, audit, and
the explicit partial states of cross-owner work. The in-memory engine ships
beside it and implements the same interface; the synthetic twins are its
public fixtures. Callers ask for complete use cases, not a grant repository.

### `org-hats/access` — verification only

`verify(envelope, keys, expectations)` turns a signed envelope into neutral
access. Verification keys travel as the canonical `VerifyKeySet`; fixed
vectors pin the envelope format byte-exactly. The module never names a
product entity and does not know how a session is transported.

### `org-hats/conformance` — the executable inventory

The `OH-*` cases specify portable behaviour through the public interface
only. `CONFORMANCE_WORLD` carries the synthetic fixtures, principal links,
and org-admin bootstrap; another runtime runs the same inventory by supplying
its own world factory. This is the executable specification, not an adapter
SPI.

### `org-hats-cloudflare` — the reference runtime

The Cloudflare package is a separate `0.x` workspace package. It provides:

- the `OrganizationAuthority` and `OperationAuthority` Durable Objects, with
  SQLite state, transactions, alarms, and a durable outbox;
- the `AuthorityRuntimeEntrypoint` service binding, including the
  provider-callback exchange for OIDC-style login;
- signing-key rotation, authenticated `/ops/*` routes, bootstrap,
  schema-status, export, and restore;
- operation routing facts — the hostname slug and each site's canonical path
  — as authority state, with aliases as routing decoration; and
- a self-contained `pnpm --filter org-hats-cloudflare demo`.

The portable fence is load-bearing: everything under `src/` compiles with
`types: []` and imports nothing Cloudflare; `bin/check` enforces both. The
Cloudflare package depends on the portable modules, never the reverse.

The full `OH-*` inventory runs against the real coordinators in workerd. A
deployed runtime reached through a service binding has a separate, narrower
claim: the documented smoke subset in
[`docs/binding-conformance.md`](docs/binding-conformance.md). It is not the
full inventory, and the document says exactly what it does not claim.

## Versions and compatibility

- **Root package `org-hats`:** 2.0.0.
- **Authority interface:** 2 — the call signatures and command vocabulary.
- **Access envelope:** 1 — the signed claims format.
- **Cloudflare runtime:** a separate `0.x` line on `cloudflare-v*` tags; its
  operation state schema is 4.
- **Distribution:** git tags only; no registry publication. A consumer pins a
  reviewed tag or commit. Codeberg is canonical; GitHub is a release mirror.

The interface version and the envelope version move for different reasons. A
command-surface break moves the interface version. A change to what the
claims mean moves the envelope format. An envelope records the issuing
interface as provenance, but verification reads the envelope's own version
pair — so the line can be at interface 2 while still reading format-1
envelopes. The 2.0 break changed `grant-hat` to one `GrantTarget` (team or
site) and moved the interface to 2; see
[`docs/migration-v2.md`](docs/migration-v2.md).

This is the 2.x line. The v0.4 surface — predicates, persistence port,
request spine, and the Node SQLite adapter — lives at its tags and is not
copied forward; v2 content returns by being re-specified against the
architecture. The earlier 1.x package line is historical. See
[`docs/authority_redesign.md`](docs/authority_redesign.md) for the design and
[`docs/publishing.md`](docs/publishing.md) for the release ritual.

## Where to go next

- [`docs/README.md`](docs/README.md) — the docs index and the
  normative/background split.
- [`docs/lexicon.md`](docs/lexicon.md) — the normative words; start here when
  a term is unfamiliar.
- [`docs/authority_redesign.md`](docs/authority_redesign.md) — architecture,
  modules, state ownership, and the identity boundary.
- [`docs/envelope.md`](docs/envelope.md) — the envelope format, encoding,
  signature, and version/key compatibility.
- [`docs/cloudflare.md`](docs/cloudflare.md) — the reference runtime as
  built: coordinators, Worker surface, keys, ops, and state lifecycle.
- [`docs/binding-conformance.md`](docs/binding-conformance.md) — the deployed
  service-binding smoke claim and its limits.
- [`specs/README.md`](specs/README.md) — the named invariants: what must hold,
  what enforces it, and what follows when it stops holding.
- [`docs/migration-v2.md`](docs/migration-v2.md) — the 1.2 → 2.0 deltas.
- [`docs/publishing.md`](docs/publishing.md) — canonical host, mirror, CI,
  and the release ritual.
- [`SECURITY.md`](SECURITY.md) — reporting and coordinated disclosure.
- [`plans/README.md`](plans/README.md) — work in flight; a plan is removed
  when it is realized.

Background reading: [`docs/organization_model.md`](docs/organization_model.md),
[`docs/rbac.md`](docs/rbac.md), and
[`docs/literature_review.md`](docs/literature_review.md).

## License

MIT.
