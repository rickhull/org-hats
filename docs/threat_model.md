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
   coordinators are not public HTTP surfaces. Coordinators also call each
   other — organization intake into an operation, and the subject guard's
   bind relay — as plain binding `fetch` calls carrying JSON. A sibling
   coordinator's message is parsed with the same validators as any other
   input and is trusted *structurally*: there is no shared secret, signature,
   or provenance check, so the isolation of that channel is the platform's
   binding scope alone, with no application-level backstop.
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

8. **Browser authenticator → runtime.** The WebAuthn ceremonies cross a
   boundary beside the provider exchange. The browser's client data,
   authenticator data, attestation object, signature, and credential id are
   untrusted bytes, and the authenticator is the trust root for possession.
   The runtime mints the challenge and binds it to the host's origin and
   relying-party id; the host's `organizationId`, `operationId`, `rpId`, and
   `expectedOrigin` are caller configuration, not proof.

## Reachable inputs

Every boundary above is crossed by one of these. The list is named so that a
new input class is a visible addition to the model rather than an assumption.

- **Access envelopes and refresh handles** — untrusted bytes. The envelope
  arrives as JSON a host decoded from a cookie or body; its declared type is
  erased at runtime, so the shared version gate owns the structural checks
  (non-object envelope, absent or non-object claims, claims deeper than the
  format's bound) before any field is read or canonicalized. Canonical bytes
  are an input to the signature check, so the verifier canonicalizes claims
  before it can verify them — a published key id is enough to reach that work,
  which is why the depth bound precedes it.
- **Client and ops request bodies** — typed field-by-field by the HTTP
  validators; an unrecognized shape is `invalid-command`.
- **Inter-coordinator relay bodies** — trusted structurally; see boundary 3.
- **Stored snapshots** — a restore is operator-authorized *structure*, not
  operator-verified *fact*. Every restorable column is trusted: undelivered
  outbox rows, refresh-record `revoked`/`superseded` flags, and team status
  all come back as the snapshot states them. Structure and schema version are
  validated; the truth of the rows is not. Two things bound this in code
  rather than by the operator: a redelivered outbox row carries the row id as
  its message id, so intake recognises the replay; and a derived projection is
  not a restorable field at all — the operation's roster projection is absent
  from the operation export by design. An organization snapshot can restore
  actor disabled flags and administrator standing; an operation snapshot
  cannot assert the roster projection. What a snapshot cannot express is a
  stronger boundary than what it is trusted to state.
- **Environment configuration** — the signing trio, `OPS_TOKEN`, `DEMO_ROUTES`,
  and `AUTHORITY_ORGANIZATION_IDS`. The directory is the exchange's only route
  to an issuer's sealed configuration: an organization omitted from it is
  invisible to login, and one wrongly included extends evidence resolution to
  it.
- **OIDC documents** — discovery, JWKS, and token responses are hostile input.
  Only `issuer`, `token_endpoint`, and `jwks_uri` are read from discovery; the
  rest is ignored, and the exchange never redirects.
- **WebAuthn ceremony responses** — `clientDataJSON`, `attestationObject`,
  `authenticatorData`, `signature`, and credential ids are untrusted bytes
  from the browser. CBOR is depth- and item-bounded; COSE keys and
  authenticator data are parsed by named boundaries that refuse unknown
  constructs rather than skip them; the stored key is re-parsed before it is
  used to verify.
- **Release metadata** — tags, manifests, and tracked `dist/`; see the
  supply-chain row.

## Threats

| Threat | Vector | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Envelope forgery or claim tampering | Forged signature, edited claims, unknown key, structurally malformed envelope | Ed25519 over canonical JSON; closed version pair; configured key set; `invalid-signature` fails closed; the shared version gate refuses a non-object envelope or absent claims as `unauthenticated` before a field is read, and a host-supplied verify predicate that throws is `invalid-signature`, not an exception | A compromised signing key is authoritative until removed from verifiers |
| Replay of a stolen envelope | Bearer copy used by another party | Short `exp`, with a lifetime that is not a positive whole number refused at claims assembly and at engine construction rather than producing an `exp` no clock can be past; host TLS and cookie protections; refresh re-resolves actor state | A bearer envelope has no proof of possession; it is replayable within its lifetime. The host owns anti-replay and step-up |
| Stolen refresh handle | Handle leaked from host storage or logs | Handles are hashed at rest and rotate on use; actor disable or unlink, participation or grant revocation, and team retirement revoke affected refresh records; refresh re-reads organization state | A stolen, still-live handle can rotate once before the host notices; there is no global bulk revoke |
| Principal impersonation | Provider subject collision or malicious IdP | One `(provider, subject)` maps to one actor; links are explicit; bootstrap/bind refusals; subject guard serializes cross-organization binds; ambiguity is `unavailable` | The configured IdP is trusted for authentication. A malicious provider can authenticate the wrong human |
| Provider-callback exchange abused | Intercepted one-time code, nonce reuse, stale or attacker-pinned JWKS | The exchange runs authority-side with the sealed client secret; the nonce is verified against the ID token; signature, issuer, audience, and expiry are checked against a TTL-bounded JWKS cache with forced refetch on unknown kids | The one-time code is the provider's to enforce, and a provider key rotation is only picked up within the cache TTL; a malicious provider authenticates the wrong human (see the impersonation row) |
| Passkey assertion replay or cross-context use | Captured assertion, held challenge, wrong origin, or a relying-party id the runtime did not bind | The challenge is single-use, minted per ceremony, and bound at mint to the host's origin and RP id; expiry and consumption are checked in the same transaction that advances the counter; the signature covers the authenticator data and the client-data hash; origin and RP-id hash are compared before the signature; every refusal is `unauthenticated` | An assertion captured in transit can be submitted once before the host submits it, after which the challenge refuses the host; TLS, cookie hygiene, and request ordering are the host's |
| Passkey credential or counter tampering | A stolen or restore-rewritten credential row, a stored credential with no link, a rolled-back counter | Stored key JSON is parsed at the assertion boundary; the credential must have its `(webauthn, credential id)` link to the same actor; a stored nonzero counter must strictly advance and is re-read under the consume transaction; enrollment commits link, credential, and claim consume in one transaction | Database or ops-token access can replace a public key, but the holder still needs the matching private key; synced passkeys report zero forever, so counter replay is not detected; link and credential rows are not tamper-evident |
| Weak or unattested local credential | A synced or backed-up passkey, an authenticator without user verification, no attestation provenance | The relying-party id is the zone apex under the [zone-purity precondition](cloudflare.md#local-credentials-passkeys); backup-eligibility flags are stored opaquely; attestation is verified when present; `amr` states only `webauthn` | A backup-eligible credential is as strong as the account that syncs it and is not device-bound; there is no attestation or device-fleet policy; `userVerification` is preferred, so PIN or biometric verification is not required and is not surfaced in `amr`; a compromised sync account authenticates as the actor |
| Passkey challenge flooding | Unauthenticated callers mint assertion options repeatedly | Minting stores one row and performs no cryptography; expired rows are pruned on every mint; challenges are 256 bits and unknown ones answer uniformly | No built-in rate limiting; a flood consumes storage and request budget within the five-minute lifetime, so the Worker platform and host must absorb it |
| Privilege escalation through commands | A hat, envelope, or fresh evidence used beyond its standing | Command policy table; organization/operation standing; fresh-only writes; selected hat authorizes no command; idempotent claims; audit | An administrator compromised within their own granted authority can exercise it. Separation of duties beyond these roles is host code |
| Cross-organization or cross-operation reach | Wrong directory id, operation id, or target | Envelope operation binding; coordinator ownership; operation-local grants; per-operation Durable Objects; `wrong-binding` fail closed | A misconfigured organization directory can cause outage or route evidence to the wrong tenant; it is operator configuration |
| Ops-token compromise | Leaked bearer token | Token is a secret, stored outside the repository; it gates every ops route except the public, secret-free `GET /ops/verification-keys`; use a private ops Worker or tightly held transport | The token is all-or-nothing: bootstrap, links, activation recovery, routing facts, export, and restore. Export returns every table — sealed IdP configuration, refresh-handle hashes, activation digests, and audit rows — and restore can rewrite all of them. Rotating the token contains further use but undoes none of its writes: an administrator it added and a principal link it bound survive rotation and give their holder authenticated access without the token, so containment is a hunt and not only a rotation ([runbook](key_compromise.md)). Key ids and rotation state are visible to anyone who can reach the public verification-keys route |
| Sealed IdP configuration disclosure | Export/backup, database access, or ops-token use | Configuration is held by the organization object and resolved only by the exchange; named “sealed” because the portable core treats it as opaque | It is not encrypted by `org-hats`; export contains it. Protect exports and rotate the provider client secret if exposed |
| Signing-key compromise | Secret leak, host compromise, bad deployment configuration | Key pair is proven at import; verifier-first rotation; verifiers keep only configured keys; development fallback is per-isolate | A leaked private key can mint valid envelopes. Removing the old verification key immediately invalidates live sessions but is the safe containment |
| Accidental development signing | Deployment omits the signing trio | Full signing config is a proven pair; a partial set errors at runtime construction | The runtime cannot infer deployment intent, so a host gate must refuse the ephemeral dev signer in production |
| Demo or harness surface reached | The Worker is routed publicly, or a service-binding caller asks for `/demo/*` | The reference production config attaches no routes and sets `workers_dev` false; the routes refuse to serve unless the deployment sets `DEMO_ROUTES: "1"`, which the reference config does not | An operator who sets the flag on a routed Worker re-opens the exposure: unauthenticated callers could reset coordinator state and mint envelopes |
| Malicious or lost state | Database access, bad restore, operator mistake | Typed restore; schema version validated, with a future or unsupported version refused; atomic transactions; projections rebuild by pulling; audit rows, and a restore records itself after replacing the tables so it cannot erase its own trace | Direct storage access or an authorized restore can rewrite authority state. Restore validates structure, not truth: its refresh-record and team-status flags come back as stated. An organization snapshot can restore actor disabled flags and administrator standing. The operation's roster projection is absent from its export and is rebuilt by pulling. If the actor remains disabled at the organization, refresh refuses a restored unrevoked, unsuperseded handle (`not-admitted`, "actor disabled"); a revoked or superseded handle is refused earlier. Disable also sends a durable outbox message that revokes refresh records when delivered; the live organization check independently protects refresh while that message is delayed or lost. A crafted snapshot's undelivered outbox rows are re-delivered, but not applied as if fresh: delivery carries the outbox row id as the message id, that id survives the restore, and the receiving coordinator's intake is claim-deduped on it, so a replayed message is recognised and retired rather than applied twice. No tamper-evident audit log |
| Denial of service | Expensive envelope parsing, signature checks, provider fetches, or request floods | Claims depth is bounded by the format and checked before canonicalization, so unverified claims cannot drive unbounded recursion; the [envelope-size baseline](consumer-session.md) documents the largest envelope the authority issues today — a budget input, not a bound; bounded provider caches; Durable Object alarms; fail-closed failures | No built-in rate limiting; the Worker platform and host must absorb volumetric traffic. Claims breadth is not bounded at the verifier: reach legitimately scales with the operation, so a large envelope is the host's budget question, not a refusal. The outbox drain is bounded per invocation — one addressed row per fan-out target, at most 25 rows a drain, with the remainder left pending for the alarm — so a backlog drains in batches instead of exceeding the platform's subrequest cap and retrying the same batch forever; see the [amplification review](performance.md) |
| Clock and expiry skew | Verifier clock ahead/behind issuer | `exp` checked against the verifier's clock; no not-before check | Clock skew shortens or extends the usable window within the host's clock discipline |
| Supply-chain or tag rewrite | Moved tag, rebuilt `dist/`, compromised release credentials | Immutable-tag policy; `bin/check-version`; tracked `dist/`; artifact gate; no registry publication | Git tags are names, not cryptographic commitments. Consumers should pin a commit where reproducibility matters |
| Sensitive-data leakage through logs/notes | Secrets, exports, roster material copied into logs or relay notes | Activation stores only digests; refresh handles are hashed; notes are publishable by assumption; no secrets in audit | Host logs, exports, and browser storage are outside this repository's control |

## Assumptions

- The host drives the browser redirect and session flow; evidence reaches
  the authority verified — host-verified on the portable seam, and
  exchange-verified on the Cloudflare runtime — and the configured IdP is
  the trust root for authentication.
- TLS protects envelopes and refresh handles in transit.
- A passkey's private key stays in the authenticator, which is the trust
  root for possession; the runtime receives only public key material and
  signed assertions, and the browser enforces origin and relying-party
  scoping.
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
manager, a rate limiter, a tamper-evident audit log, or an authenticator or
device-management service. It does not demand or evaluate attestation trust
paths, defend the host's browser session, product authorization decisions,
or deployment credentials beyond the boundaries above. The host owns those,
and owns the product response to every failure kind.

## Review

The named invariants are in [`specs/`](../specs/), especially A4, A7, A10,
A11, A13, and A16. The emergency procedures are in
[key_compromise.md](key_compromise.md). Revisit this model when a trust
boundary, custody model, public surface, or failure taxonomy changes.

A residual-risk statement in the table above carries a confirming test, not
only a mitigation. A mitigation is tested because it is a control; an accepted
risk is the claim most likely to drift, because nothing fails when the
behaviour stops matching the sentence. The outbox-replay row is the worked
example: writing its test showed the risk was *narrower* than this document
said, and the correction only existed because the accepted behaviour was made
executable. Where a residual risk is genuinely untestable — an operational
ordering, a compromised credential — say so in the row rather than leaving the
absence to be rediscovered.
