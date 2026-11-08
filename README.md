# org-hats

**Portable organizational authority for multi-operation applications.**

*Who may act, in which organizational capacity, on which target, in which operation?*

A person may work for an organization across several operations, sites, and teams, with different responsibilities in each. `org-hats` models that authority separately from login identity and issues signed **access envelopes** — short-lived statements of what the holder may do, verifiable by any service locally — without querying the authority database.

Concretely: Dana coordinates the yard crew at one site and holds no reach at another; at a festival, the same Dana wears an admin role over a different gate. One person, several jobs, different keys for each — and when a job ends, the access that came with it is revoked and dies on a short, known clock. The portable core runs wherever JavaScript does; the reference production runtime is Cloudflare Workers.

The vocabulary, one line each — the [Model](#model) section below is precise:

- **Operation** — one undertaking with its own boundary: a festival, a deployment, a product line. Not a business process.
- **Actor** — one person known to one organization; the same human in two organizations is two actors.
- **Target** — the one place a grant reaches: one team, or one site and its teams.
- **Grant** — one actor, one role, one target. The unit of "who may do what, where."
- **Hat** — the one grant selected for acting. You hold several; you act through one.
- **Evidence** — typed proof from an identity provider that a person authenticated. Login is the host's business; evidence is the input here.
- **Issuer** — the authority that signs envelopes. A **verifier** (or consumer) is any service that checks one locally.
- **Host** — the application integrating `org-hats`; it owns login, product policy, and what happens on a denial.

In the literature's terms, it is best read as **target-scoped RBAC with a signed bearer authorization projection**—not an identity provider, a general policy engine, or a Zanzibar-style relationship database (Google's system for sharing by relationships). The standards mapping — each term against INCITS 359 and its neighbours — is in [the academic guide](docs/personas/academic.md).

> **Core action rule:** To **act**, the **selected hat's role** must carry that **action**, and its grant must reach the target. Seeing, configuring, and member reach follow other rules.
>
> **Important qualification:** The selected hat is the acting role for a decision — it is not the whole of what the holder can do. What they may *see*, what they may *configure*, and which teams they *reach as a member* are separate facts, each computed by the issuer from the actor's grants, never from the selected hat alone. A consumer asks for the fact it needs — act, read, configure, or member reach (the table below) — rather than inferring one from another. Hosts must keep their own attribution where it matters; audit facts name the actor, not the authorizing layer (see [Audit attribution](docs/authority_redesign.md#audit-attribution)).

## When to use it

Consider `org-hats` if you need:

- Multiple organizations participating in overlapping operations, with actors scoped to one organization.
- Operation-local grants scoped to a site or team, with an explicitly selected acting capacity.
- Authorization decisions in downstream services without a live authority lookup on each request.
- A small, typed authority interface and a verifier that does not need organizational database access.

**Do not use it merely to replace a role column.** If your product has one application and one role per user, simpler RBAC is probably better. `org-hats` does not provide directory synchronization, group grants, nested roles, deny rules, role inheritance, or general object-level policy. The host application still owns authentication, product-specific policy, UI behavior, and responses to denials.

For comparisons and intended limits, see [positioning](docs/positioning.md), [academic perspective](docs/personas/academic.md), and [current limits](docs/positioning.md#current-limits).

## Model

```text
organization ── participation ── operation
     │                              ├── sites
   actors                           │     └── teams
     │                              ├── policy bundle
     └──────── grants ──► worn hat ─┘
```

- **Organization:** A durable organizational identity; it participates in operations through an explicit lifecycle.
- **Actor:** An organization-scoped actor identified by `(organizationId, actorId)`. A person in two organizations is represented by two actors; equal email addresses do not merge them.
- **Operation:** The local boundary for sites, teams, policy, and grants.
- **Grant:** An actor, an operation-local role, and exactly one target (site or team). A site grant reaches the site and its teams; a team grant reaches that team.
- **Hat:** The grant selected for action authorization. An actor may have multiple wearable grants but selects one for `mayAct`.
- **Policy bundle:** Versioned action vocabulary, role/action assignments, and read policy.

A grant is wearable only when it is not revoked, the actor is enabled, and the organization's participation is active. A primary grant is preferred; otherwise selection is deterministic. `select-hat` changes the primary selection.

### Distinguish the authority layers

| Accessor | Source of authority |
| --- | --- |
| `mayAct(action, target)` | Selected hat's role and target reach |
| `readableOrganizationIds()` | Issuer-computed organization read reach under the active policy |
| `readableTeamIds()` | Exceptional team ids only — a reached team whose organization is not already readable |
| `mayConfigure(siteId)` | Issuer-computed configuration reach over wearable grants |
| `teamReach()` | Issuer-computed member reach over wearable grants |

**Do not infer from the selected hat that all other authority is limited to that hat.** An actor may wear one hat while another wearable grant contributes configuration reach. Hosts must use the accessor appropriate to the decision and keep their own attribution where it matters; audit facts name the actor, not the authorizing layer.

## Try the examples

Requires Node 24+ and pnpm:

```sh
pnpm install
node examples/pilot.ts
node examples/own-world.ts
node examples/consumer-access.ts
```

- `pilot.ts`: Evidence → actor → signed envelope → local decision → expiry.
- `own-world.ts`: Define an organization, sites, teams, grants, and policy; select a different hat and verify the changed capacity.
- `consumer-access.ts`: Verify the envelope in a consuming service and handle closed failure kinds.

All example worlds use synthetic data. The [tutorial](docs/tutorial.md) follows commands, refresh, disable, and crossed grants.

For a visual experiment, run `pnpm playground` and open
<http://127.0.0.1:4173>. The [authority playground](examples/playground/README.md)
lets you switch operations and hats, compare the authority layers, revoke a grant, and
advance to expiry using the real engine and verifier in browser memory.

```sh
pnpm verify
```

The full verification gate checks the portable suites, type and import boundaries, examples, release metadata, and the Cloudflare workerd suite (workerd is Cloudflare's server-side JavaScript runtime). `pnpm test` runs the portable tests; `pnpm check:cloudflare` runs the reference-runtime tests.

## Integrate

There is no package-registry publication. Pin a release tag (or, for stronger reproducibility, an exact commit). For example:

```sh
pnpm add "git+https://codeberg.org/rickhull/org-hats.git#v3.5.0"
```

The authority side exposes four session and command calls, plus the three activation lifecycle calls:

| Call | Purpose |
| --- | --- |
| `accessFromEvidence` | Resolve externally verified evidence and issue an envelope and refresh handle |
| `refresh` | Continue a session and report whether the handle was kept, rotated, or revoked |
| `context` | Read presentation facts, not an authorization decision |
| `command` | Execute typed, idempotent authority mutations |
| `activationRequest` | Mint a one-time activation code (return-once) for an existing actor who has no login bound yet |
| `activationInspect` | Disclose only whether an activation secret is usable |
| `activationAccept` | Bind verified evidence to the named actor and consume the activation |

The consumer uses only the verifier. A verifier needs the `org-hats/access` package and the issuer's distributed `VerifyKeySet` (the public verification keys); standard JWT/JWKS middleware will not verify these envelopes:

```ts
import { isFailed, verify } from "org-hats/access";

const result = await verify(envelope, keys, {
  now: envelope.claims.iat + 1,
  expectedOperationId: "op-9f2e6ad4",
  expectedSiteId: "site-b8d620fa",
});

if (isFailed(result)) throw new Error(result.failure.kind);

const team = { kind: "team", teamId: "team-2e8c64b9" } as const;
const allowed = result.access.mayAct("review", team);
```

This is an illustrative local verification with an intentionally fixed time inside the token's lifetime, before `exp`. In production, supply a trusted current time and validate the expected operation/site against the request context.

See [publishing](docs/publishing.md), [Cloudflare deployment](docs/cloudflare.md), and [the tutorial](docs/tutorial.md).

## Security and trust boundaries

An access envelope is **Ed25519-signed canonical JSON**, not a JWT. It contains the actor and operation binding, selected action authority, separately computed reach, issuance and expiry times, and version information. The verifier checks the signature, version pair, expiry, and any caller-supplied operation or site binding, then answers locally from signed claims. `expectedOperationId` and `expectedSiteId` are optional; omitting them accepts any binding. There is no not-before check: `iat` is issuance time, not a validity start.

**What this guarantees:** The envelope's claims were signed by a key in the verifier's trusted set, have not expired, and match any operation or site binding the caller supplied.

**What this does not guarantee:** That the issuer's policy or underlying data were correct; that the actor remains enabled after issuance; that the bearer is the original human; or that authentication is recent enough for a sensitive action. The host must protect bearer credentials and enforce its own authentication-assurance requirements.

Revocation is **bounded, not instantaneous**. Existing envelopes may remain usable until `exp` (default lifetime: 900 seconds). Refresh rechecks authoritative actor state and fails closed when it cannot obtain the required state. A refresh racing with a disable may have read the pre-disable state and issue one further bounded envelope; the next refresh observes the disable. The specification does not promise a globally linearized disable/refresh boundary. See [authority invariants](specs/authority.md) and [envelope invariants](specs/envelope.md).

Authentication method and authentication time (`amr`, `auth_time`) are carried through refresh; issuing a fresh envelope **does not** constitute fresh authentication. Sensitive operations may require a fresh runtime authorization decision or step-up authentication.

**Envelope evolution:** A new optional claim may skip a version bump only when ignoring it cannot widen effective authority or weaken a required check. Security-significant changes require an explicitly compatible versioned rollout. See [envelope invariants](specs/envelope.md).

The design-level [threat model](docs/threat_model.md) and the [key-compromise runbook](docs/key_compromise.md) are published; there is no independent security audit yet. See [security reporting](SECURITY.md).

## Implementation and verification boundaries

| Package | Responsibility |
| --- | --- |
| `org-hats` | Pure organizational model, policy vocabulary, reach and invariants |
| `org-hats/authority` | Portable authority runtime, in-memory engine, fixtures |
| `org-hats/access` | Local verification and neutral access API |
| `org-hats/conformance` | Executable `OH-*` conformance inventory — one named, runnable check per public claim |
| `org-hats-cloudflare` | Reference runtime with SQLite-backed coordinators (the authority's state holders) and service bindings |

The portable `src/` modules avoid Cloudflare imports and ambient runtime types. The Cloudflare runtime is the deployed reference implementation; the in-memory runtime is for examples and tests. The full conformance inventory runs against the workerd coordinators; the deployed service-binding smoke test is a narrower claim, not equivalent to full conformance.

## Versions and distribution

| Surface | Version source in this archive |
| --- | --- |
| `org-hats` | [`package.json`](package.json), `version` |
| Authority interface | 3 |
| Access envelope format | 1 |
| Cloudflare runtime | [`packages/cloudflare/package.json`](packages/cloudflare/package.json), `version` (`cloudflare-v*` tags); operation schema 5 |

Interface and envelope versions advance independently. See [v2 migration](docs/migration-v2.md), [v3 migration](docs/migration-v3.md), and [publishing](docs/publishing.md). The private NAS forge is canonical; Codeberg and GitHub are best-effort public release mirrors. Git tag immutability depends on repository governance; verify an exact commit (and its `dist/`) where supply-chain reproducibility matters.

The [next patch's upgrade notes](docs/migration-v3.md#370--371) describe the
access-verification hardening and ES2024 baseline. The Cloudflare package is
versioned separately.

## Known gaps

There is no AD/LDAP bulk-import or phased-cutover runbook (the mapping guide is [From Active Directory and LDAP](docs/personas/practitioner.md)), formal policy-bundle authoring guide, independent security audit, or documented deployment-cost estimate. These are **current limitations**, not promises of future features. The opt-in benchmark harness and its baseline are in [Performance](docs/performance.md); the security posture is in the [threat model](docs/threat_model.md) and [key-compromise runbook](docs/key_compromise.md).

## Documentation

Start with the [tutorial](docs/tutorial.md), [model reference](docs/authority_redesign.md), [envelope reference](docs/envelope.md), [specification index](specs/README.md), and [persona guides](docs/personas/README.md). For background and comparisons, see [literature review](docs/literature_review.md).

## License

MIT.
