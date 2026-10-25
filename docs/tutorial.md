# Tutorial: one actor, several hats

*The longer companion to the README walkthrough. It uses the synthetic twins
and the in-memory engine, with the actual fixture ids and the decisions they
produce. The README is the map; this is the walk. All fixtures are synthetic
design data.*

The in-memory engine implements the same `AuthorityRuntime` as the Cloudflare
reference runtime. The first snippet shows the imports; later snippets omit
them, and some error handling is elided. `examples/pilot.ts` is the complete
runnable setup, and the `OH-*` inventory is the exhaustive one. The point
here is to connect the concepts to concrete facts.

**Cases:** [one operation](#case-1-one-operation-one-hat) ·
[same actor, another operation](#case-2-the-same-actor-another-operation) ·
[crossed grant](#case-3-a-site-grant-and-a-crossed-team-grant) ·
[commands](#case-4-commands-denial-and-idempotency) ·
[refresh](#case-5-refresh-rotation) ·
[disable](#case-6-disable-a-lost-message-and-the-liveness-gate) ·
[Cloudflare](#the-same-rules-in-cloudflare)

Every section closes with two short readings. The **counterpoint** is the
objection a new reader has — this is more machinery than the question seems
to need. The **rationale** is the property that makes the machinery
necessary. The rationale is not a claim that the shape is finished; a
counterpoint with no answer is a bug worth filing. When a word looks heavier
than it needs to be — hat, worn, grant, reach — [`lexicon.md`](lexicon.md) is
normative: each term names a distinction the code may not blur.

## The world we will use

The tutorial uses three twins:

- **Professional Operation** (`op-9f2e6ad4`), a persistent, multi-site
  operation. Harbor Logistics (`org-4c1f9a2e`) participates. Dana
  (`actor-8d3b77c1`) holds grant `g-mer-3`: `coordinator` over the Yard crew
  team (`team-2e8c64b9`) at West Yard (`site-b8d620fa`). Sam
  (`actor-3a91c4d8`) is another Harbor Logistics actor; the setup below makes
  him an organization administrator for the disable case. The policy is
  `policy-meridian`; its read policy is `granted-teams`.
- **Riverbend Fest** (`op-61a8e3f2`), a bounded, multi-venue operation. The
  same Harbor Logistics actor Dana holds grant `g-fest-4`: `admin` over the
  Park Gate site (`site-a9e05c41`). The policy is `policy-riverbend`; its read
  policy is `all-participating`.
- **Berlin Airlift** (`op-4b8d2e67`), a bounded, multi-airfield public-history
  twin. Charles (`actor-4f7c2a19`) is a Vittles Airlift Wing duty officer over
  the Tempelhof site (`site-c5d2a8f7`); Duncan (`actor-91f3c7e8`) is a Plane
  Fare Air Group duty officer over the Ground Handling shift one team
  (`team-5a2b8e37`) — a crossed grant.

The same actor does not carry a global role. Dana has one identity, one
organization, and two operation-local hats. Charles's site grant and
Duncan's team grant show the two shapes of reach, including the crossed
secondment.

### Counterpoint

Three operations, a dozen fixed ids, and four people, before a single
authority question is asked. Why not one operation, one site, and one admin,
and let the reader generalize?

### Rationale

The shapes this model exists to separate only show up in contrast. Dana in
two operations separates a person's identity from the hat they wear; a site
grant beside a crossed team grant separates `mayAct` reach from configuration
reach; the Airlift's other Berlin airfields make a grant's reach visibly
bounded by place. With one fixture each claim would be true by accident. The
ids are fixed because the snippets, the tests, and the pilot must name the
same world — a generated world has nothing to check against.

## Set up one world

```ts
import {
  AUTHORITY_INTERFACE_VERSION,
  AIRLIFT,
  DANA_OKAFOR,
  FESTIVAL,
  HARBOR_LOGISTICS,
  PROFESSIONAL_OPERATION,
  actorId,
  createInMemoryAuthority,
  organizationId,
  type SignedAccessEnvelope,
} from "org-hats/authority";
import { ed25519VerifyKey, verify } from "org-hats/access";

const SAM = actorId("actor-3a91c4d8");
const CHARLES = actorId("actor-4f7c2a19");
const DUNCAN = actorId("actor-91f3c7e8");
const VITTLES = organizationId("org-6f1a93c4");
const PLANE_FARE = organizationId("org-2d7eb58a");

const engine = await createInMemoryAuthority({
  fixtures: [PROFESSIONAL_OPERATION, FESTIVAL, AIRLIFT],
  principalLinks: [
    {
      provider: "tutorial-idp", subject: "dana",
      organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR,
    },
    {
      provider: "tutorial-idp", subject: "sam",
      organizationId: HARBOR_LOGISTICS, actorId: SAM,
    },
    {
      provider: "tutorial-idp", subject: "charles",
      organizationId: VITTLES, actorId: CHARLES,
    },
    {
      provider: "tutorial-idp", subject: "duncan",
      organizationId: PLANE_FARE, actorId: DUNCAN,
    },
  ],
  // Sam administers the organization; this matters for disable-actor later.
  orgAdmins: { [HARBOR_LOGISTICS]: [SAM] },
});
```

The fixtures provide the structure. The principal links are the only
identity mapping: evidence resolves to one organization actor, and no
provider claim creates a second one.

Distribute the verification key before issuing:

```ts
const material = await engine.verificationKey();
const key = await ed25519VerifyKey(material.keyId, material.publicKey);
const keys = new Map([[key.keyId, key]]);
```

Two small helpers keep the cases readable:

```ts
const issueFor = async (subject: string, operationId: string) => {
  const result = await engine.runtime.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId,
    evidence: { provider: "tutorial-idp", subject },
  });
  if ("failure" in result) {
    throw new Error(`${result.failure.kind}: ${result.failure.detail ?? ""}`);
  }
  return result;
};

const accessFor = async (
  envelope: SignedAccessEnvelope,
  operationId: string,
  siteId: string,
) => {
  const result = await verify(envelope, keys, {
    now: envelope.claims.iat + 1,
    expectedOperationId: operationId,
    expectedSiteId: siteId,
  });
  if ("failure" in result) {
    throw new Error(`${result.failure.kind}: ${result.failure.detail ?? ""}`);
  }
  return result.access;
};
```

### Counterpoint

An engine, four principal links, a signing key, an admin map, and two
helpers — all before asking whether Dana may review a shift. Where is the
simple lookup this was supposed to be?

### Rationale

The four links are the whole identity boundary: evidence resolves to exactly
one organization actor, and no provider claim mints a second one. The engine
is there because the tutorial needs changes, sessions, and an outbox, not a
table read, and it implements the same `AuthorityRuntime` as the Cloudflare
package, so one story covers both. The key is distributed before issuance
because verification is offline; a verifier that called the authority to
check a signature would not be portable. The `orgAdmins` mapping is there
because the disable case needs an administrator who is not a coordinator.
Every piece here is used by a later case; scenery would not earn a line.

## Case 1: one operation, one hat

Issue for Dana at the Professional Operation:

```ts
const danaPro = await issueFor("dana", "op-9f2e6ad4");
const pro = await accessFor(danaPro.envelope, "op-9f2e6ad4", "site-b8d620fa");
```

The envelope carries the projection. Product code does not read this; the
verifier does. It is shown here to connect the model to the output:

```jsonc
{
  "actor": { "organizationId": "org-4c1f9a2e", "actorId": "actor-8d3b77c1" },
  "hat": {
    "role": "coordinator",
    "actions": ["review", "resolve"],
    "teamIds": ["team-2e8c64b9"],
    "siteIds": []
  },
  "sites": [{ "siteId": "site-b8d620fa", "aliases": ["west"] }],
  "readableOrganizationIds": ["org-4c1f9a2e"],
  "readableTeamIds": [],
  "configurableSiteIds": []
}
```

The `hat` names the grant's own target. A team grant has a team id and no
site id in `hat`, but the site it sits at appears in `sites`; the site grant
case below adds the site to `hat` and expands its teams. `memberTeamIds` (not
shown) is the union of teams the wearable grants touch.

What the verifier returns:

| Check | Result |
| --- | --- |
| `mayAct("review", Yard crew)` | `true` — the coordinator role carries `review`, and the grant reaches the team |
| `mayAct("resolve", Yard crew)` | `true` |
| `mayAct("observe", Yard crew)` | `false` — the role does not carry `observe` |
| `mayAct("review", East Hall team)` | `false` — out of reach |
| `mayAct("review", whole operation)` | `false` — nothing reaches the operation |
| `mayConfigure(West Yard)` | `false` — a coordinator does not configure |
| `readableOrganizationIds()` | `["org-4c1f9a2e"]` — the reached team's organization |
| `readableTeamIds()` | `[]` — the team's organization is already readable |

`readableTeamIds` is not the expanded team list; it carries only exceptional
team grants whose organization is outside the readable organization set. The
shipped twins produce an empty list.

`NeutralAccess` exposes the booleans; the model's `decide` also carries a
reason (`no-capability`, `out-of-reach`, `not-admitted`, `policy-inconsistent`)
for hosts and diagnostics, but the verifier's product surface stays neutral.

Presentation context comes from the runtime, not the verifier:

```ts
const context = await engine.runtime.context({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  envelope: danaPro.envelope,
});
// context.selectedHat.role === "coordinator"
// context.wearableHats.length === 1
// context.participation === "active"
```

`context` is where display names, the operation's sites, and the wearable
hats belong. It is a presentation read, not an authority decision.

### Counterpoint

Four calls — an issue, a verify, a context read, and an artifact you are told
not to read — to answer one yes-or-no question. And a coordinator who may
resolve a review but not observe her own team. Why so many parts?

### Rationale

The calls answer four different questions: issuance is an authority act,
verification is "may this holder act", `context` supplies presentation, and
the envelope is what travels. Splitting them is what lets a service decide
from a signed artifact without the authority database, and lets a display
name change without touching the decision. `observe` is absent because a role
enumerates the actions it carries; that closed answer is the point. Adding a
capability is a policy edit at the authority, never an assumption in a host.

## Case 2: the same actor, another operation

Issue for Dana at Riverbend Fest:

```ts
const danaFest = await issueFor("dana", "op-61a8e3f2");
const fest = await accessFor(danaFest.envelope, "op-61a8e3f2", "site-a9e05c41");
```

The envelope's hat changes with the operation:

```jsonc
{
  "hat": {
    "role": "admin",
    "actions": ["observe", "flag", "resolve", "configure"],
    "teamIds": ["team-3f8b52d6", "team-7c2e91a4"],
    "siteIds": ["site-a9e05c41"]
  },
  "sites": [{ "siteId": "site-a9e05c41", "aliases": ["gate"] }],
  "readableOrganizationIds": ["org-d94b1c6e", "org-08f7a2b5", "org-4c1f9a2e"],
  "readableTeamIds": [],
  "configurableSiteIds": ["site-a9e05c41"]
}
```

The site grant reaches both Park Gate teams — Gate crew and Safety — even
though neither belongs to Harbor Logistics. The same actor pair is unchanged;
the operation-local grant and the policy are different.

| Check | Result |
| --- | --- |
| `mayAct("flag", Gate crew)` | `true` — site grant reaches the team |
| `mayAct("flag", Safety)` | `true` |
| `mayAct("flag", Tasting booth 001)` | `false` — another site |
| `mayAct("flag", Park Gate site)` | `true` — a site grant reaches its site |
| `mayConfigure(Park Gate)` | `true` — the admin role carries `configure` |
| `mayConfigure(Tasting Row)` | `false` |
| `readableOrganizationIds()` | all three actively participating organizations |
| `readableTeamIds()` | `[]` — every team's organization is readable under `all-participating` |

The read policy changed: Professional's `granted-teams` gave Dana one
readable organization; the Festival's `all-participating` gives her the
whole operation's read board. The verifier compares the ids; it does not recompute
either policy.

### Counterpoint

Same actor, same organization — and a different hat, a different read board,
and a different policy. Is this not just a second admin flag on one person?

### Rationale

There is no global role to inherit from, by construction: the hat is
operation-local, and the operation's policy owns what the read board is.
Professional's `granted-teams` gives Dana one readable organization;
Riverbend's `all-participating` gives her all participants. Same person,
same organization, different policy. The verifier compares the ids it was
handed and does not recompute either. A role that followed the person
between operations would restore exactly the question the model replaced.

## Case 3: a site grant and a crossed team grant

The Berlin Airlift twin adds the coalition shape. Issue for Charles
(Vittles, duty officer over the Tempelhof site) and Duncan (Plane Fare, duty
officer over a Ground Handling team):

```ts
const charles = await issueFor("charles", "op-4b8d2e67");
const duncan = await issueFor("duncan", "op-4b8d2e67");
const ca = await accessFor(charles.envelope, "op-4b8d2e67", "site-c5d2a8f7");
const du = await accessFor(duncan.envelope, "op-4b8d2e67", "site-c5d2a8f7");
```

| Check | Charles (site Tempelhof) | Duncan (team Ground shift one) |
| --- | --- | --- |
| `mayAct("dispatch", Ground shift one)` | `true` | `true` |
| `mayAct("dispatch", Ground shift two)` | `true` | `false` |
| `mayAct("dispatch", Gatow handling shift)` | `false` | `false` |
| `mayAct("dispatch", Tempelhof site)` | `true` | `false` — a team grant does not reach its site |
| `mayConfigure(Tempelhof)` | `true` | `true` — the team sits at Tempelhof and the role carries `configure` |
| `readableOrganizationIds()` | all four active organizations | all four active organizations |

Charles's site grant reaches every team at Tempelhof, including Ground
Handling teams from another organization: that is why a Vittles officer can
dispatch a Ground Handling shift. Duncan's team grant is a crossed grant — a
Plane Fare officer seconded onto a Ground Handling shift. It reaches only
that team, not the site, though configuration reach follows the team's site.

`mayAct` reach and configuration reach are separate. A team grant reaches
only its team for `mayAct`; if its role carries `configure`, configuration
reach follows the team's site. That is why Duncan can configure Tempelhof
without being able to dispatch over the whole site.

The three Berlin airfields are separate sites because admission and reach are
per airfield. The coalition read board is `all-participating`; the verifier
receives the four organization ids and does not reconstruct the coalition.

### Counterpoint

Charles may dispatch another organization's team; Duncan may configure a site
where he may dispatch only one of its teams; and two grants at one site reach
different targets. Are these special cases?

### Rationale

Two reaches, applied separately. `mayAct` follows the grant's target: a site
grant reaches every team at that site, a team grant reaches only its team.
Configuration follows the site a grant sits at — the site itself, or the
site its team is anchored to — when the role carries `configure`, because
setup is site-shaped: a seconded officer can configure the place their shift
works without dispatch reach over the other teams there. The airfields are
separate sites for the same reason: admission and reach are per site, and one
site with three aliases would let a Tempelhof grant reach Gatow.

## Case 4: commands, denial, and idempotency

Reads are local; changes go through the runtime. Use Dana's Professional
envelope to try a change she does not administer:

```ts
const refused = await engine.runtime.command({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  idempotencyKey: "tutorial-denied-grant",
  authorization: { kind: "access-envelope", envelope: danaPro.envelope },
  kind: "grant-hat",
  operationId: "op-9f2e6ad4",
  organizationId: HARBOR_LOGISTICS,
  actorId: SAM,
  role: "field",
  target: { kind: "team", teamId: "team-2e8c64b9" },
});
```

```jsonc
{ "ok": false, "failure": { "kind": "denied", "detail": "the caller does not administer this operation" } }
```

The coordinator's hat does not carry `configure`, and Dana is not an
operation admin. The command is a normal value, not an exception; it commits
nothing, and its idempotency key is not claimed.

A valid command can select Dana's own primary hat:

```ts
const command = {
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  idempotencyKey: "tutorial-select-hat",
  authorization: { kind: "access-envelope" as const, envelope: danaPro.envelope },
  kind: "select-hat" as const,
  operationId: "op-9f2e6ad4",
  grantId: "g-mer-3",
};
const first = await engine.runtime.command(command);
const again = await engine.runtime.command(command);
if (!first.ok || !again.ok) throw new Error("selection failed");
```

`first.receipt.applied` is `true`; `again.receipt.applied` is `false`. The
retry returned the original result instead of applying the act twice. A
denied command does not poison its key; a successful command claims it with
the payload hash.

### Counterpoint

A command object with an idempotency key, a payload hash, and a receipt, to
select a hat the actor already wears. Why does one mutation need a protocol?

### Rationale

Commands cross a runtime boundary and can be retried — a restarted caller, a
resent message, a resumed request. The key stands for the caller's intent; it
is claimed only on success and commits with the mutation, so a retry returns
the original receipt rather than acting twice, while a denial leaves the key
free for a corrected attempt. The failure is a value because "denied" is an
ordinary authority answer, not an exception, and a receipt is what makes
at-least-once delivery safe.

## Case 5: refresh rotation

A session outlives one envelope. Refresh the Festival issue:

```ts
if (danaFest.refresh.kind !== "rotated") throw new Error("expected a handle");
const refreshed = await engine.runtime.refresh({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  operationId: "op-61a8e3f2",
  handle: danaFest.refresh.handle,
});
if ("failure" in refreshed) throw new Error(refreshed.failure.kind);
const afterRefresh = await accessFor(
  refreshed.envelope,
  "op-61a8e3f2",
  "site-a9e05c41",
);
```

`refreshed.refresh.kind` is `rotated`; `afterRefresh` answers from the
replacement envelope, with the same keys and binding. The old envelope
remains valid until its `exp` — refresh rotates the handle, not the
already-issued envelope — but the old handle is dead:

```ts
const replay = await engine.runtime.refresh({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  operationId: "op-61a8e3f2",
  handle: danaFest.refresh.handle,
});
// { failure: { kind: "unauthenticated", detail: "refresh handle superseded" } }
```

The new envelope moves `iat`; authentication facts, when the evidence carries
them, are preserved through the chain. The refresh outcome is explicit, so the
host never has to infer whether the session kept, rotated, or lost its handle.

### Counterpoint

Refresh rotates the handle, the old handle dies after one use, and yet the
old envelope keeps verifying until it expires. Which of these is the session?

### Rationale

All three, with different jobs. The handle is the live session, so one use
bounds replay. The envelope is an offline-verifiable artifact already in
someone's hands; the authority cannot take it back, so `exp` is what limits
it, and calling it revoked would promise something the verifier cannot keep.
The outcome is explicit — kept, rotated, revoked — so the host never has to
infer which happened.

## Case 6: disable, a lost message, and the liveness gate

The operation's local decision uses a projection of organization facts. In
Cloudflare that projection can be stale; the refresh gate exists so a lost
disable message cannot extend a session. The in-memory engine keeps the
organization state in the same world rather than a separate projection, but
it can show the same ordering with one failed outbox delivery:

```ts
const staleEngine = await createInMemoryAuthority({
  fixtures: [PROFESSIONAL_OPERATION],
  principalLinks: [
    {
      provider: "tutorial-idp", subject: "dana",
      organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR,
    },
    {
      provider: "tutorial-idp", subject: "sam",
      organizationId: HARBOR_LOGISTICS, actorId: SAM,
    },
  ],
  orgAdmins: { [HARBOR_LOGISTICS]: [SAM] },
  // The first outbox delivery fails and stays pending.
  transportFailures: 1,
});

const staleDana = await staleEngine.runtime.accessFromEvidence({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  operationId: "op-9f2e6ad4",
  evidence: { provider: "tutorial-idp", subject: "dana" },
});
const staleSam = await staleEngine.runtime.accessFromEvidence({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  operationId: "op-9f2e6ad4",
  evidence: { provider: "tutorial-idp", subject: "sam" },
});
if ("failure" in staleDana) throw new Error(staleDana.failure.kind);
if ("failure" in staleSam) throw new Error(staleSam.failure.kind);
```

Sam administers the organization, so he can disable Dana:

```ts
const disabled = await staleEngine.runtime.command({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  idempotencyKey: "tutorial-disable-dana",
  authorization: { kind: "access-envelope", envelope: staleSam.envelope },
  kind: "disable-actor",
  organizationId: HARBOR_LOGISTICS,
  actorId: DANA_OKAFOR,
});
if (!disabled.ok) throw new Error(disabled.failure.kind);
// { ok: true, receipt: { applied: true, ... } }
```

The disable commits at the organization and queues the message to the
operation. With `transportFailures: 1`, the first refresh's delivery attempt
fails and the message stays pending. The refresh still refuses:

```ts
if (staleDana.refresh.kind !== "rotated") throw new Error("expected a handle");
const firstRefresh = await staleEngine.runtime.refresh({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  operationId: "op-9f2e6ad4",
  handle: staleDana.refresh.handle,
});
// { failure: { kind: "not-admitted", detail: "actor disabled" } }
```

The live organization read is the gate; the operation's stale projection is
not the revocation promise. On the next attempt, the pending message lands,
the refresh record is revoked, and the handle itself is dead:

```ts
const secondRefresh = await staleEngine.runtime.refresh({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  operationId: "op-9f2e6ad4",
  handle: staleDana.refresh.handle,
});
// { failure: { kind: "unauthenticated", detail: "refresh handle revoked" } }
```

The already-issued envelope still has a bounded life. Verify it at its expiry
with the stale world's key set:

```ts
const staleMaterial = await staleEngine.verificationKey();
const staleKey = await ed25519VerifyKey(staleMaterial.keyId, staleMaterial.publicKey);
const staleKeys = new Map([[staleKey.keyId, staleKey]]);
const expired = await verify(staleDana.envelope, staleKeys, {
  now: staleDana.envelope.claims.exp,
  expectedOperationId: "op-9f2e6ad4",
});
// { failure: { kind: "expired" } }
```

In the Cloudflare runtime the projection is a real `org_actors` table;
`packages/cloudflare/test/roster.test.ts` leaves it stale and asserts
`not-admitted`. The binding smoke includes the same case. See
[`cloudflare.md`](cloudflare.md) and
[`binding-conformance.md`](binding-conformance.md).

### Counterpoint

One disable produces an outbox entry, a failed delivery, a stale projection,
a live-organization read, and a second refresh that fails differently. And
Dana's envelope still verifies after she is disabled. Why is disable not one
write?

### Rationale

The organization owns the actor fact; the operation owns its local copy, and
a copy can be stale. "One writer for each fact" means a lost message must not
become indefinite authority, so refresh reads the owner — read-only and
fail-closed, the named exception to no cross-coordinator reads on the write
path — while the projection still validates local commands. An
already-issued envelope cannot be recalled, so its `exp` is the blast radius;
the gate makes sure no session outlives it. The stale projection is not a
wart to paper over. It is why the gate exists.

## The same rules in Cloudflare

The in-memory engine is a reference implementation of the portable
`AuthorityRuntime`; the Cloudflare package is the reference deployment. It
does not grow a second set of authority rules. It provides:

- `OrganizationAuthority`, which owns the organization, actors, principal
  links, organization administration, and the roster image;
- `OperationAuthority`, which owns sites, teams, grants, participation,
  policy, refresh records, and the derived actor/disabled projection;
- the `AuthorityRuntimeEntrypoint` service binding, plus the provider-callback
  exchange for login;
- signing-key rotation, authenticated ops routes, bootstrap, schema status,
  export, and restore; and
- routing facts: the operation slug and each site's canonical path are
  authority state, not registry input. The registry projects them; aliases
  decorate, ids resolve.

The standing rule is no synchronous cross-coordinator read on a write path.
Refresh's liveness gate is the deliberate exception: read-only, fail-closed,
and it decides no grant or participation mutation. The operation's projection
still serves local command validation; the gate keeps a lost disable message
from becoming indefinite authority.

The full `OH-*` inventory runs against the real coordinators in workerd. A
deployed runtime reached through a service binding has a separate, narrower
claim — the smoke subset in
[`binding-conformance.md`](binding-conformance.md). Do not call the smoke
subset the full inventory.

### Counterpoint

A second runtime, two coordinators, a service binding, and a test subset
declared separately from the main inventory. Is this one system or two?

### Rationale

One contract, two implementations: the in-memory engine and the Cloudflare
package both implement `AuthorityRuntime`, so the deployed runtime cannot
grow its own rules without failing the portable tests. The coordinators split
state where the single writer is: the organization owns actors and their
lifecycle, the operation owns sites, teams, grants, participation, policy,
and refresh. The smoke subset is named separately because a deployed binding
proves that subset, not the full `OH-*` inventory; conflating the two claims
is how a test claim becomes fiction.

## Where to run it

- `node examples/pilot.ts` — the complete Case 1 setup, plus the expiry
  denial. It is the shortest runnable version.
- `pnpm test` — the portable model, authority, access, conformance, and
  scenario suites.
- `pnpm check:cloudflare` — the Cloudflare typecheck and workerd suites,
  including the full inventory and the lost-disable roster case.

### Counterpoint

After all that, the snippets still do not run as written — setup is elided,
some errors are narrowed by hand. Why is the tutorial not executable?

### Rationale

Because the executable authority is the pilot and the suite, and a document
that duplicated them would drift from them. A tutorial that imported them
would show internals instead of the seam. The snippets keep the fixture ids
and the outcomes, so what you read can be checked against what runs; only the
repeated setup and the error handling are left out. When the text and a test
disagree, the test is right, and the text is a bug.
