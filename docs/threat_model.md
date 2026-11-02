# Threat model

*What `org-hats` protects, what it assumes, and where the remaining risk sits.
This is a design-level threat model, not an independent security audit. The
deploying host owns its product surface, IdP, secrets, and deployment; the
[security policy](../SECURITY.md) covers reporting.*

## Assets

- **Signing authority** — the Ed25519 private key and the `keyId` that signs
  access envelopes.
- **Verification trust** — the `VerifyKeySet` every verifier uses.
- **Access envelopes and refresh handles** — the bearer credentials the
  host carries, typically as cookies.
- **Authority state** — actors, principal links, administrators,
  participations, teams, grants, refresh records, audit, and outbox rows.
- **Activation material** — return-once secrets and their stored digests.
- **Operator material** — `OPS_TOKEN`, the organization directory, sealed
  IdP configuration, and the worker's Durable Object bindings.
- **Release integrity** — tags, manifests, and tracked `dist/` output.

## Trust boundaries

1. **Provider → host → evidence.** The portable seam takes typed, verified
   evidence and never sees provider credentials; anything before
   `accessFromEvidence` is the host's trust decision. The Cloudflare runtime
   additionally runs the provider-callback exchange authority-side —
   discovery, the token exchange with the sealed client secret, and ID-token
   verification (signature, issuer, audience, nonce, expiry) against the
   provider's JWKS. The configured IdP is the trust root for authentication
   either way.
2. **Issuer → verifier.** Verifiers trust the issuer's computed claims when
   a key in the configured set signs them. They do not recompute policy.
3. **Worker → coordinators.** The Worker reaches the organization and
   operation Durable Objects through Durable Object namespace bindings. The
   coordinators are not public HTTP surfaces.
4. **Operator → ops routes.** `OPS_TOKEN` authenticates a high-authority,
   all-or-nothing operator surface. The token is not a tenant credential.
5. **Host → bearer.** The host transports envelopes and refresh handles and
   owns cookie attributes, TLS, CSRF defenses, and session UX.
6. **Upstream → release consumer.** Tags and tracked `dist/` define what a
   host pins; the forge account and release tooling are part of the supply
   chain.
7. **Any reachable caller → the shipped surface.** The Worker's fetch surface
   also serves unauthenticated demo and harness routes: `GET /demo/bootstrap`
   resets and reseeds the coordinators, `POST /demo/login` mints an envelope
   and refresh handle, `/demo/access` verifies one, and `/increment` is a
   harness counter. The reference production config attaches no routes
   (`workers_dev` false, service binding only). These routes refuse to serve
   unless the deployment sets `DEMO_ROUTES: "1"`; the reference config does
   not, so a host that routes the Worker publicly — and any caller that can
   reach the service binding — gets 404s, not the routes.

## Threats

| Threat | Vector | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Envelope forgery or claim tampering | Forged signature, edited claims, unknown key | Ed25519 over canonical JSON; closed version pair; configured key set; `invalid-signature` fails closed | A compromised signing key is authoritative until removed from verifiers |
| Replay of a stolen envelope | Bearer copy used by another party | Short `exp`; host TLS and cookie protections; refresh re-resolves actor state | A bearer envelope has no proof of possession; it is replayable within its lifetime. The host owns anti-replay and step-up |
| Stolen refresh handle | Handle leaked from host storage or logs | Handles are hashed at rest, rotate on use, and are revoked by disable/unlink/participation/team/grant changes; refresh re-reads organization state | A stolen, still-live handle can rotate once before the host notices; there is no global bulk revoke |
| Principal impersonation | Provider subject collision or malicious IdP | One `(provider, subject)` maps to one actor; links are explicit; bootstrap/bind refusals; subject guard serializes cross-organization binds; ambiguity is `unavailable` | The configured IdP is trusted for authentication. A malicious provider can authenticate the wrong human |
| Provider-callback exchange abused | Intercepted one-time code, nonce reuse, stale or attacker-pinned JWKS | The exchange runs authority-side with the sealed client secret; the nonce is verified against the ID token; signature, issuer, audience, and expiry are checked against a TTL-bounded JWKS cache with forced refetch on unknown kids | The one-time code is the provider's to enforce, and a provider key rotation is only picked up within the cache TTL; a malicious provider authenticates the wrong human (see the impersonation row) |
| Privilege escalation through commands | A hat, envelope, or fresh evidence used beyond its standing | Command policy table; organization/operation standing; fresh-only writes; selected hat authorizes no command; idempotent claims; audit | An administrator compromised within their own granted authority can exercise it. Separation of duties beyond these roles is host code |
| Cross-organization or cross-operation reach | Wrong directory id, operation id, or target | Envelope operation binding; coordinator ownership; operation-local grants; per-operation Durable Objects; `wrong-binding` fail closed | A misconfigured organization directory can cause outage or route evidence to the wrong tenant; it is operator configuration |
| Ops-token compromise | Leaked bearer token | Token is a secret, stored outside the repository; it gates every ops route except the public, secret-free `GET /ops/verification-keys`; use a private ops Worker or tightly held transport | The token is all-or-nothing: bootstrap, links, activation recovery, routing facts, export, and restore. It can read sealed IdP config and alter state. Key ids and rotation state are visible to anyone who can reach the public verification-keys route |
| Sealed IdP configuration disclosure | Export/backup, database access, or ops-token use | Configuration is held by the organization object and resolved only by the exchange; named “sealed” because the portable core treats it as opaque | It is not encrypted by `org-hats`; export contains it. Protect exports and rotate the provider client secret if exposed |
| Signing-key compromise | Secret leak, host compromise, bad deployment configuration | Key pair is proven at import; verifier-first rotation; verifiers keep only configured keys; development fallback is per-isolate | A leaked private key can mint valid envelopes. Removing the old verification key immediately invalidates live sessions but is the safe containment |
| Accidental development signing | Deployment omits the signing trio | Full signing config is a proven pair; a partial set errors at runtime construction | The runtime cannot infer deployment intent, so a host gate must refuse the ephemeral dev signer in production |
| Demo or harness surface reached | The Worker is routed publicly, or a service-binding caller asks for `/demo/*` | The reference production config attaches no routes and sets `workers_dev` false; the routes refuse to serve unless the deployment sets `DEMO_ROUTES: "1"`, which the reference config does not | An operator who sets the flag on a routed Worker re-opens the exposure: unauthenticated callers could reset coordinator state and mint envelopes |
| Malicious or lost state | Database access, bad restore, operator mistake | Typed restore; atomic transactions; projections rebuild by pulling; audit rows | Direct storage access or an authorized restore can rewrite authority state, and a crafted snapshot's undelivered outbox rows are re-delivered as if fresh. No tamper-evident audit log |
| Denial of service | Expensive envelope parsing, signature checks, provider fetches, or request floods | The [envelope-size baseline](consumer-session.md) documents the largest envelope the authority issues today — a budget input, not a bound; bounded provider caches; Durable Object alarms; fail-closed failures | No built-in rate limiting; the Worker platform and host must absorb volumetric traffic |
| Clock and expiry skew | Verifier clock ahead/behind issuer | `exp` checked against the verifier's clock; no not-before check | Clock skew shortens or extends the usable window within the host's clock discipline |
| Supply-chain or tag rewrite | Moved tag, rebuilt `dist/`, compromised release credentials | Immutable-tag policy; `bin/check-version`; tracked `dist/`; artifact gate; no registry publication | Git tags are names, not cryptographic commitments. Consumers should pin a commit where reproducibility matters |
| Sensitive-data leakage through logs/notes | Secrets, exports, roster material copied into logs or relay notes | Activation stores only digests; refresh handles are hashed; notes are publishable by assumption; no secrets in audit | Host logs, exports, and browser storage are outside this repository's control |

## Assumptions

- The host drives the browser redirect and session flow; evidence reaches
  the authority verified — host-verified on the portable seam, and
  exchange-verified on the Cloudflare runtime — and the configured IdP is
  the trust root for authentication.
- TLS protects envelopes and refresh handles in transit.
- The host protects cookies and other bearer storage, and decides when
  reauthentication or step-up is required.
- The operator protects `OPS_TOKEN` and the signing secrets, and controls
  who can reach the ops surface and Durable Object bindings.
- The deployment uses a cryptographically random refresh-handle source. The
  in-memory engine's deterministic ids are for tests and examples, not a
  production deployment.
- Verifiers receive a verification-key set before the issuer signs with the
  corresponding key, and retain it until the last envelope it can verify has
  expired.

## Non-goals

`org-hats` is not an identity provider, a general policy engine, a secrets
manager, a rate limiter, or a tamper-evident audit log. It does not defend
the host's browser session, product authorization decisions, or deployment
credentials beyond the boundaries above. The host owns those, and owns the
product response to every failure kind.

## Review

The named invariants are in [`specs/`](../specs/), especially A4, A7, A10,
A11, A13, and A16. The emergency procedures are in
[key_compromise.md](key_compromise.md). Revisit this model when a trust
boundary, custody model, public surface, or failure taxonomy changes.
