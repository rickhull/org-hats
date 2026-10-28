# org-hats

*Portable organizational authority: who may act, in what capacity, over which
target, in which operation.*

"Can this person act?" is easy when one application, one role, and one database
answer it. It stops being easy when one organization works in several
operations with different sites, teams, and policy; when the same person
wears a different hat in each; and when the decision has to reach another
service without shipping the authority database with it.

org-hats answers one question, precisely:

> **may act = the active hat's role carries the action × that grant
> reaches the target**

Dana is a coordinator over the Yard crew at West Yard. She may `review` and
`resolve` there, may not `observe`, and has no reach at East Hall. In
Riverbend Fest the same Dana wears the example policy's `admin` role over
Park Gate. One identity, two operation-local hats.

The model is portable. An in-memory engine runs it in tests and examples; the
Cloudflare package is the reference runtime. Both expose the same four
calls: `accessFromEvidence`, `refresh`, `context`, and `command`.

> **Before you adopt it.** It is the organizational half of authorization,
> not an identity provider or a policy engine: no directory sync
> (LDAP/SAML/SCIM), grants to groups, nesting, deny, or inheritance. One hat is
> active per session, while read, configuration, and member reach are
> currently unions over every wearable grant — the
> [current limits](docs/positioning.md#current-limits) say where that is
> going. Admission is documented, but the grant is the operative admission.
> Production is the Cloudflare reference runtime, where a real downstream
> host runs it today; the in-memory engine is for tests and examples. The
> envelope is not a JWT: every downstream service needs `org-hats/access`
> and the distributed key set. There is no support contract — issues and
> security reports go through this repository, see
> [`SECURITY.md`](SECURITY.md). If one application and one role per person
> is the whole problem, a role column is simpler.

## Who this is for

- **Evaluating this against an AD/LDAP-shaped problem?** Keep reading, then
  [`docs/personas/practitioner.md`](docs/personas/practitioner.md).
- **Checking where this sits in the access-control literature?**
  [`docs/personas/academic.md`](docs/personas/academic.md).
- **Deciding whether this is worth a meeting, not an afternoon?**
  [`docs/personas/onlooker.md`](docs/personas/onlooker.md) is the one-pager.
- **Running an organization with no engineering staff?**
  [`docs/personas/nonprofit.md`](docs/personas/nonprofit.md) is written for
  you; nothing below this line is.

## Run the examples

Node 24+ and pnpm:

```sh
pnpm install
node examples/pilot.ts
node examples/own-world.ts
node examples/consumer-access.ts
```

The pilot prints one actor, one operation, one worn hat, two local decisions,
and a closed expiry:

```text
actor: org-4c1f9a2e/actor-8d3b77c1
operation: op-9f2e6ad4
worn hat: coordinator
refresh: rotated
readable organizations: org-4c1f9a2e
may review the reached team: true
may review another team: false
may configure the site: false
expires at: 1792962537
at exp: expired
pilot passed
```

The expiry timestamp depends on when you run it. The pilot is the smallest
complete story: verified evidence becomes one organization actor; issuance
returns a signed envelope and a refresh handle; the verifier answers locally;
the same envelope fails at `exp`. All fixtures are synthetic design data.

`node examples/own-world.ts` starts from a world of your own: your
organization, sites, teams, grants, and policy bundle enter through
`defineWorld`, which validates them before the engine boots. The example then
switches hats for real — `select-hat` to a second grant, refresh, verify the
new capacity — and maps verification failures onto an HTTP handler's status
codes.

`node examples/consumer-access.ts` is the host's side of the seam: it verifies
a real envelope, shows the wrong-operation 404 and the expired and forged
401s, and maps every kind in the closed failure taxonomy to an illustrative
product response. The switch is exhaustive; a new kind stops the example
compiling.

The [`tutorial`](docs/tutorial.md) continues this world through commands,
refresh, a lost disable, and a crossed grant.

`pnpm verify` is the full gate: dist freshness, the compiler fences, the
portable suites, the test and example typecheck, the examples, the release
metadata check, and the Cloudflare workerd suite. It runs locally and needs
no Cloudflare account. `pnpm test` runs only the portable suites;
`pnpm check:cloudflare` runs only the reference runtime.

*The rest of this page through "Versions and compatibility" is integrator and
implementer depth — install commands, the model's vocabulary, call
signatures. Deciding whether this is worth a meeting? See
[`docs/positioning.md`](docs/positioning.md) for the one-paragraph position,
or skip to [Read next](#read-next).*

## Use it in a service

There is no registry publication; pin a release tag. A verifier needs only
the `access` subpath and the key set the issuer distributes:

```sh
pnpm add "git+https://codeberg.org/rickhull/org-hats.git#v3.0.0"
```

```ts
import { isFailed, verify } from "org-hats/access";
```

The issuer imports `org-hats/authority` and calls the runtime; the verifier
imports `org-hats/access` and never reads authority rows. The
[issue-and-verify](#issue-and-verify) walkthrough shows the call, and
[`docs/publishing.md`](docs/publishing.md) lists the Codeberg and GitHub pin
forms. Cloudflare hosts bind the runtime through
`AuthorityRuntimeEntrypoint` and use `org-hats-cloudflare`; see
[`docs/cloudflare.md`](docs/cloudflare.md).

## The model on one screen

```text
organization ── participation ── operation
     │                              ├── sites
   actors                           │     └── teams
     │                              ├── policy bundle
     └──────── grants ──► worn hat ─┘
```

- **Organization** — the durable body an actor belongs to. It joins
  operations through **participation** (`invited → accepted → active`,
  revocable by either side).
- **Operation** — the scope authority is exercised in: its own sites, teams,
  policy version, and grants. A **site** is a place where work happens; a
  **team** is an organization-fielded unit anchored to exactly one site.
- **Actor** — `(organizationId, actorId)`, scoped to one organization. The
  same person in two organizations is two actors; equal email addresses
  never merge them.
- **Grant** — an actor, a role, and exactly one target: a team, or a site.
  The grant worn for one act is the **hat**. An actor may hold several
  grants and wears one at a time.

The **policy bundle** is versioned data: an action vocabulary, roles that
carry actions, and a read policy. A **role** is a title in that data; an
**action** is an opaque verb such as `review`.

Four consequences do most of the work:

- **Identity is organization-scoped.** An IdP subject resolves through a
  **principal link** to one actor. Evidence creates no participation and no
  grant. **Admission** — the operation's acceptance of one actor — is neither
  authentication nor participation.
- **Authority is operation-local.** There is no global role: Dana's
  coordinator hat exists only in the Professional Operation. A grant is
  **wearable** when it is not revoked, the actor is enabled, and
  participation is `active`; primary wins, then a deterministic fallback,
  and `select-hat` changes the primary. **Reach** is target-shaped: a team
  grant reaches its team, a site grant reaches its site and that site's
  teams. Nothing reaches the whole operation, and there is no hierarchy or
  inheritance.
- **Read reach is policy.** The issuer computes it under the bundle —
  `granted-teams` or `all-participating` — and writes the resulting ids into
  the envelope. The verifier compares ids; it never rebuilds the rule.
- **The envelope names its layers.** The worn hat is the action layer. Read
  reach, configuration reach, and member reach are separate issuer-computed
  layers over the actor's wearable grants; the hat does not bound them.

**What it is not:** this is the organizational half of authorization.
Product objects and verbs, role hierarchy, and what the UI shows belong to
the host. If one application and one role per person is the whole problem, a
role column is simpler.

In the literature's terms, this is target-scoped RBAC with a signed bearer
authorization projection — not a new RBAC variant, not ABAC, and not
Zanzibar/ReBAC. See [`docs/personas/academic.md`](docs/personas/academic.md)
for the full mapping.

## The four calls

| Call | Question it answers |
| --- | --- |
| `accessFromEvidence` | Resolve evidence and issue an envelope plus a refresh handle |
| `refresh` | Continue a session; the handle outcome is explicit |
| `context` | Presentation facts for the signed-in actor |
| `command` | Perform a typed, idempotent business act |

`context` is a presentation read: display names, participation, sites,
wearable and selected hats. It makes no authority decision.

## Issue and verify

Issuance returns `{ envelope, refresh }` or a closed failure. The **access
envelope** is a signed projection of the decision: actor pair, operation,
worn role and its actions, reach, the sites the grants touch, readable
organization and exceptional team ids, configurable sites, and `iat`/`exp`.
It is Ed25519 over canonical JSON, access envelope format 1 — not a JWT.
The **refresh handle** arrives with an explicit outcome: kept, rotated, or
revoked.

The verifier is the other half (`org-hats/access`). With the envelope from
issuance, the distributed key set, and the operation and site the caller
meant, it checks the format and version pair, the signature, expiry, and
binding, then answers from the claims:

```ts
const verified = await verify(envelope, keys, {
  now: envelope.claims.iat + 1, // inside the window, deterministically
  expectedOperationId: "op-9f2e6ad4",
  expectedSiteId: "site-b8d620fa",
});
if (isFailed(verified)) throw new Error(verified.failure.kind);
const yardCrew = { kind: "team", teamId: "team-2e8c64b9" } as const;
verified.access.mayAct("review", yardCrew); // true
```

`mayAct` is local. It does not call the authority, rebuild reach, or consult a
grant table. That is what lets another service decide while the authority is
unreachable, and what makes the decision cheap and reproducible.

A wrong operation or site fails `wrong-binding`; a correct envelope at or
after `exp` fails `expired`; an unsupported format fails
`wrong-interface-version`; a bad signature fails `invalid-signature`. One
closed taxonomy of values; the deploying host owns the product response.

## Change and refresh

Reads are local; changes go through `command`. A command is a typed,
idempotent business act: `request-access`, `admit`, `grant-hat`,
`revoke-grant`, `select-hat`, `disable-actor`, and the participation
commands. It carries an authorization (an access envelope or fresh
evidence), an interface version, and an idempotency key. The runtime validates
the whole command before committing; the idempotency claim commits with the
mutation, so a retry returns the original result and a denial cannot poison
the key.

A session outlives an envelope. `refresh(handle)` issues a replacement and
states what happened to the handle. Revoking a grant revokes affected refresh
records. A disabled actor cannot refresh: the runtime re-reads the actor at
the organization, read-only and fail-closed. A disabled actor is
`not-admitted`; an actor that no longer resolves is `unauthenticated`; an
organization that cannot answer is `unavailable`. That liveness read is
deliberate: a lost disable message must not become indefinite authority. The
already-issued envelope is bounded by `exp`; that is the blast radius.

## What's in the box

- **`org-hats`** — the portable model and policy vocabulary: grants,
  wearability, worn-hat selection, `decide`, `readReach`,
  `invariantProblems`. Data and pure functions; no I/O, storage, clock, or
  Cloudflare.
- **`org-hats/authority`** — the four-call `AuthorityRuntime`, the in-memory
  engine, the fixture boundary (`defineWorld`), and the synthetic example
  worlds.
- **`org-hats/access`** — verification only: `verify` turns a signed envelope
  into neutral access; `VerifyKeySet` is the rotation unit.
- **`org-hats/conformance`** — the executable `OH-*` inventory, run through
  the public interface only.
- **`org-hats-cloudflare`** — the reference runtime: two SQLite-backed
  coordinators, the service binding and provider-callback exchange, key
  rotation, ops routes, bootstrap, export and restore.

The portable fence is load-bearing: everything under `src/` compiles with
`types: []` and imports nothing Cloudflare; `bin/check` enforces both. The
Cloudflare package depends on the portable modules, never the reverse.

The full `OH-*` inventory runs against the real coordinators in workerd. A
deployed runtime reached through a service binding has a separate, narrower
claim — the smoke subset in
[`docs/binding-conformance.md`](docs/binding-conformance.md). It is not the
full inventory.

## Versions and compatibility

| What | Version |
| --- | --- |
| `org-hats` | 3.0.0 |
| Authority interface | 3 |
| Access envelope | 1 |
| Cloudflare runtime | separate `0.x` on `cloudflare-v*` tags; operation schema 4 |

The interface version and the envelope version move for different reasons. A
command-surface break moves the interface; a change to what the claims mean
moves the envelope. An envelope records its issuing interface as provenance,
but verification reads the envelope's own version pair — so the line can be
at interface 3 while still reading format-1 envelopes. The 2.0 break changed
`grant-hat` to one `GrantTarget` (team or site); see
[`docs/migration-v2.md`](docs/migration-v2.md). The 3.0 break renames the
denial reason `no-capability` to `action-not-carried` and the neutral
accessor `memberTeamIds()` to `teamReach()`; the claim keeps its historical
name, so envelope format 1 still reads. See
[`docs/migration-v3.md`](docs/migration-v3.md). `2.1.0` is additive — the
fixture boundary, the claims assembler, and neutral-access accessors — and
leaves both versions where they are.

Distribution is git tags only; no registry publication. Codeberg is
canonical; GitHub is a release mirror. The v0.4 surface lives at its tags and
is not copied forward.

## What isn't written yet

Real gaps, not a roadmap:

- **Migrating from AD/LDAP.** [`docs/personas/practitioner.md`](docs/personas/practitioner.md)
  says what transfers; there is no bulk-import or phased-cutover runbook.
- **Operating a live deployment.** Bootstrap, key rotation, and ops routes
  exist in the Cloudflare package; rotation cadence and an incident runbook
  for a compromised key are not written up.
- **Authoring your own policy bundle.** `own-world.ts` is the only worked
  example; there is no schema document, and no worked example of a breaking
  policy change.
- **A threat model.** Not claimed, and not yet even informally sketched.
- **Numbers.** No published envelope size, verification latency, or
  comparison to JWT/JWKS at scale.
- **Cost and adoption time.** Nobody has written down what a real pilot
  takes to run.

## Read next

- **First:** [`docs/tutorial.md`](docs/tutorial.md) — the longer walkthrough:
  commands, refresh, a lost disable, a crossed grant, and the objections each
  shape answers.
- **Audience:** [`docs/personas/README.md`](docs/personas/README.md) — the
  index behind "Who this is for" above, and what not to claim to each.
- **Reference:** [`docs/authority_redesign.md`](docs/authority_redesign.md) ·
  [`docs/envelope.md`](docs/envelope.md) · [`docs/types.md`](docs/types.md) ·
  [`docs/lexicon.md`](docs/lexicon.md) · [`docs/README.md`](docs/README.md)
- **Deployment:** [`docs/cloudflare.md`](docs/cloudflare.md) ·
  [`docs/binding-conformance.md`](docs/binding-conformance.md)
- **Process:** [`specs/README.md`](specs/README.md) ·
  [`docs/migration-v2.md`](docs/migration-v2.md) ·
  [`docs/publishing.md`](docs/publishing.md) ·
  [`SECURITY.md`](SECURITY.md) · [`plans/README.md`](plans/README.md)

Background reading: [`docs/organization_model.md`](docs/organization_model.md),
[`docs/rbac.md`](docs/rbac.md), and
[`docs/literature_review.md`](docs/literature_review.md).

## License

MIT.
