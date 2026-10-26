# Migrating from org-hats v1 to v2

**Status:** `2.0.0` crosses this break; `1.2.0` is the last 1.x release and
stays a valid pin until the consumer moves. `2.1.0` is additive: no consumer
action is required, and the interface and envelope versions do not move. This
note records the deltas a consumer crosses. The architecture itself is
unchanged — see [authority_redesign.md](authority_redesign.md).

## 1.2 → 2.0

`2.0.0` is a deliberate break in the command surface. The envelope format
does not move.

### `grant-hat` takes one target

The command no longer carries independent `teamId?` / `siteId?` optionals:

```ts
// 1.x
{ kind: "grant-hat", operationId, organizationId, actorId, role, teamId }
// or siteId

// 2.x
{ kind: "grant-hat", operationId, organizationId, actorId, role,
  target: { kind: "team", teamId } }
// or target: { kind: "site", siteId }
```

`AuthorityContext`'s wearable hats use the same shape
(`HatSummary.target`) instead of the pair. The exclusivity is now in the
type, so the runtime's "exactly one target" checks are gone. A bootstrap
fixture that declares a `grants` array changes shape as well.

### The interface version is 2

`AUTHORITY_INTERFACE_VERSION` moves from 1 to 2, so a 1.x caller gets
`wrong-interface-version` before its command body is interpreted. Send 2.
A breaking command shape is a breaking interface; additive changes still do
not move the version.

### Envelopes keep reading across the break

`ACCESS_ENVELOPE_VERSION` stays 1. Verification gates on the envelope
version pair — `format`, the envelope's `v`, and the claims' own `v` — and
never on the claims' `interfaceVersion`, which is issuer provenance. An
envelope signed by a 1.x issuer therefore keeps verifying on a 2.x runtime;
no live session drops because the call vocabulary changed. The claims' `v`
is now checked, so a signature-valid `v: 2` payload inside a `v: 1` envelope
fails closed instead of being read as v1.

### Behavior tightenings

- `grant-hat` refuses an unknown actor (`invalid-command`) and an
  organization that does not actively participate (`denied`).
- Participation transitions run through the model's state machine: an
  acceptance delivered after a revoke cannot resurrect it, revoke is
  terminal (a re-invite is refused), and revoking a non-participant is
  `denied`. Revoking twice remains a successful no-change receipt.
- An operation with no declared admin role has no administering role title;
  the hardcoded `["admin"]` fallback is gone.
- An unknown role at decision time is `policy-inconsistent` rather than a
  wearable hat with no actions; issuance and context fail `unavailable`
  naming the role.

## Ids

The five id types are branded at compile time inside the package. The public
command, evidence, context, and claims surfaces still take and return plain
strings; the wire format is unchanged, and a host needs no constructor. A
build fence compiles a consumer-shaped file against the published
declarations so that cannot regress silently.

## Cloudflare reference runtime

- The operation coordinator holds a read-only projection of each
  participating organization's roster (`org_actors`): actor id and disabled
  only. The organization remains the sole writer; the operation pushes on
  change and reconciles every fifteen minutes. No write path reads the
  organization coordinator synchronously.
- The operation schema moved 2 → 3 for the roster projection and 3 → 4 for
  routing facts. Older exports restore into the current schema with the new
  columns null; a restored operation is backfilled with
  `POST /ops/operation/routing-facts`. The projection is derived and is
  deliberately absent from export; restore clears it and rebuilds by pulling.
- `cloudflare-v0.3.0` adds operation routing facts: bootstrap requires
  `slug` and `sites[].path`, the export and `/snapshot` carry them, and the
  typed routing-facts route backfills the full set. It is not a rename route:
  no old-name history is carried yet. The operation schema is 4. This is
  runtime-only; the portable pin and interface version do not move.
- `cloudflare-v0.3.1` adds refresh freshness: before reissuing, refresh
  re-resolves the actor's existence and disabled flag at the organization;
  missing or disabled fails `not-admitted`, and an unavailable organization
  fails `unavailable`. The operation schema stays 4; interface 2 and envelope
  1 do not move.
- The exchange in `cloudflare-v0.3.1` verifies ES256, but RS256 does not
  verify (the SHA-256 algorithm parameter is missing), so a deployment of
  that tag must use ES256 for the provider login. `cloudflare-v0.3.2`
  carries the corrected exchange and the RFC 8414/7515/7519/7636
  tightenings: discovery issuer/HTTPS validation, `crit` rejection,
  P-256-only ES256, a valid DER conversion, `iat`/`nbf`/`azp`, optional-claim
  type checks, and the PKCE verifier grammar. `cloudflare-v0.3.1` remains the
  live deployment until the host deploys the new tag.
- New operator verbs: `POST /reconcile-rosters` on an operation;
  `GET /ops/schema-status` reports `orgActors`, `disabledOrgActors`,
  `rosterSyncedAt`, and `rosterReconcileSeconds`; `GET /snapshot` reports
  `orgActors`.
- The provider-callback exchange posts to the discovery document's
  `token_endpoint`, not the authorization endpoint. `cloudflare-v0.1.0` is
  not safe for real-provider login; take `cloudflare-v0.3.2`.

## 2.0 → 2.1 (additive)

`2.1.0` adds public surface and model facts; it changes no command, claim, or
envelope meaning. Interface version 2 and envelope version 1 stay put.

- A host's own world enters through `defineWorld` (with `WorldFixture` and
  `WorldDefinition`) from `org-hats/authority`. It converts hand-written,
  plain-string-id data once and refuses an invalid policy bundle, an invariant
  violation, or a fixture carrying other than exactly one operation.
- `assembleAccessClaims` is exported from `org-hats/authority` for hosts that
  need the issuer's claim shape outside the engine.
- `NeutralAccess` gains `memberTeamIds()`, `authenticatedWith()`,
  `authenticatedAt()`, and `actor()`. They expose claims the envelope already
  carried; no claim changed.
- `isFailed` is exported from `org-hats/access` alongside `verify`.
- `IssuerInterfaceVersion` names the claims' provenance field as `number`;
  calls still speak the current interface literal (a compile-time exactness
  check pins that).
- The model carries operation routing facts — `slug` and each site's
  `path` — with invariant checks and the one-namespace rule. These are
  operation-authority facts; the registry projects them (A12 in
  [`specs/authority.md`](../specs/authority.md)). The `cloudflare-v0.3.x`
  tags already serve them.
- `parseVerifyKeySet` ignores unknown fields by design: an operator-
  distributed set may grow a field without bricking live verifiers; `format`
  and `v` carry compatibility.

A consumer that wants the new exports moves its pin to `v2.1.0`. One that
does not stays on `v2.0.0`; envelopes cross the pin in both directions
because the format did not move.

## Consumer checklist

- Send `interfaceVersion: 2`.
- Replace `teamId` / `siteId` on `grant-hat` and on `HatSummary` with
  `target`.
- Update any bootstrap `grants` fixture to the `target` shape.
- Leave envelope verification alone: format 1 still verifies, including
  envelopes issued before the upgrade.
- On Cloudflare, export before upgrading, then let restore rebuild the
  roster projection. If the export predates schema 4, backfill the operation
  slug and site paths with `POST /ops/operation/routing-facts`.
