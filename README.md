# org-hats

**Portable organizational authority for multi-operation applications.**

*Who may act, in which organizational capacity, on which target, in which operation?*

A person may work for an organization across several operations, sites, and teams, with different responsibilities in each. `org-hats` models that authority separately from login identity and issues signed **access envelopes** that other services can verify locally, without querying the authority database.

It is **target-scoped RBAC with a signed bearer authorization projection**—not an identity provider, a general policy engine, or a Zanzibar-style relationship database.

> **Core action rule:** An action is permitted when the **selected hat's role** carries that action **and** its grant reaches the target.
>
> **Important qualification:** The selected hat bounds `mayAct`, **not every form of authority**. Read, configuration, and member reach are separately computed from the union of wearable grants. Consumers must choose the appropriate accessor and should attribute consequential changes to the authority that permitted them.

## When to use it

Consider `org-hats` if you need:

- Actors belonging to distinct organizations, participating in distinct operations.
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

| Question | Source of authority |
| --- | --- |
| `mayAct(action, target)` | Selected hat's role and target reach |
| Readable organizations and teams | Issuer-computed read policy across wearable grants |
| `mayConfigure(siteId)` | Issuer-computed configuration reach across wearable grants |
| `teamReach()` | Issuer-computed member reach across wearable grants |

**Do not infer from the selected hat that all other authority is limited to that hat.** An actor may be selected as an operator while also holding a separate administrative grant that contributes configuration reach. Hosts must use the accessor appropriate to the operation and maintain suitable audit attribution.

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

```sh
pnpm verify
```

The full verification gate checks the portable suites, type and import boundaries, examples, release metadata, and the Cloudflare workerd suite. `pnpm test` runs the portable tests; `pnpm check:cloudflare` runs the reference-runtime tests.

## Integrate

There is no package-registry publication. Pin a release tag (or, for stronger reproducibility, an exact commit). For example:

```sh
pnpm add "git+https://codeberg.org/rickhull/org-hats.git#v3.0.0"
```

The authority side exposes four calls:

| Call | Purpose |
| --- | --- |
| `accessFromEvidence` | Resolve externally verified evidence and issue an envelope and refresh handle |
| `refresh` | Continue a session and report whether the handle was kept, rotated, or revoked |
| `context` | Read presentation facts, not an authorization decision |
| `command` | Execute typed, idempotent authority mutations |

The consumer imports only the verifier:

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

This is an illustrative local verification with an intentionally fixed time inside the token's validity window. In production, supply a trusted current time and validate the expected operation/site against the request context.

See [publishing](docs/publishing.md), [Cloudflare deployment](docs/cloudflare.md), and [the tutorial](docs/tutorial.md).

## Security and trust boundaries

An access envelope is **Ed25519-signed canonical JSON**, not a JWT. It contains the actor and operation binding, selected action authority, separately computed reach, issuance and expiry times, and version information. The verifier checks the signature, version, time window, and caller-supplied binding, then answers locally from signed claims.

**What this guarantees:** The envelope's claims were signed by a trusted issuer and are valid for the checked binding and time window.

**What this does not guarantee:** That the issuer's policy or underlying data were correct; that the actor remains enabled after issuance; that the bearer is the original human; or that authentication is recent enough for a sensitive action. The host must protect bearer credentials and enforce its own authentication-assurance requirements.

Revocation is **bounded, not instantaneous**. Existing envelopes may remain usable until `exp` (default lifetime: 900 seconds). Refresh rechecks authoritative actor state and fails closed when it cannot obtain the required state. A refresh racing with a disable may have read the pre-disable state and issue another bounded envelope. The specification does not promise a globally linearized disable/refresh boundary. See [authority invariants](specs/authority.md) and [envelope invariants](specs/envelope.md).

Authentication method and authentication time (`amr`, `auth_time`) are carried through refresh; issuing a fresh envelope **does not** constitute fresh authentication. Sensitive operations may require a fresh runtime authorization decision or step-up authentication.

**Envelope evolution:** Older verifiers may ignore optional claims only when ignoring them cannot increase effective authority or bypass a required restriction. Security-significant changes require an explicitly compatible versioned rollout. See [envelope invariants](specs/envelope.md).

The project does not yet publish a full threat model or independent security audit. See [security reporting](SECURITY.md).

## Implementation and verification boundaries

| Package | Responsibility |
| --- | --- |
| `org-hats` | Pure organizational model, policy vocabulary, reach and invariants |
| `org-hats/authority` | Portable four-call runtime, in-memory engine, fixtures |
| `org-hats/access` | Local verification and neutral access API |
| `org-hats/conformance` | Executable `OH-*` public-interface conformance inventory |
| `org-hats-cloudflare` | Reference runtime with SQLite-backed coordinators and service bindings |

The portable `src/` modules avoid Cloudflare imports and ambient runtime types. The Cloudflare runtime is the deployed reference implementation; the in-memory runtime is for examples and tests. The full conformance inventory runs against the workerd coordinators; the deployed service-binding smoke test is a narrower claim, not equivalent to full conformance.

## Versions and distribution

| Surface | Current version in this source archive |
| --- | --- |
| `org-hats` | 3.3.0 |
| Authority interface | 3 |
| Access envelope format | 1 |
| Cloudflare runtime | Separate `0.x` series (`cloudflare-v*` tags); operation schema 5 |

Interface and envelope versions advance independently. See [v2 migration](docs/migration-v2.md), [v3 migration](docs/migration-v3.md), and [publishing](docs/publishing.md). Codeberg is canonical; GitHub is a release mirror. Git tag immutability depends on repository governance; verify an exact commit or signed release where supply-chain reproducibility matters.

## Known gaps

There is no AD/LDAP cutover runbook, formal policy-bundle authoring guide, published threat model, compromised-key incident runbook, performance benchmark, or documented deployment-cost estimate. These are **current limitations**, not promises of future features.

## Documentation

Start with the [tutorial](docs/tutorial.md), [model reference](docs/authority_redesign.md), [envelope reference](docs/envelope.md), [specification index](specs/README.md), and [persona guides](docs/personas/README.md). For background and comparisons, see [literature review](docs/literature_review.md).

## License

MIT.
