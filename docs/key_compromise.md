# Key and secret compromise runbook

*Operator procedure for a suspected or confirmed compromise of signing keys,
verification trust, the ops token, the sealed identity-provider configuration,
or bearer credentials. The design assumptions and residual risk are in
[threat_model.md](threat_model.md).*

## First principles

- **Verifier-first for normal rotation; verifier-first or immediate removal
  for compromise.** Normal rotation keeps the old verification key until its
  last possible envelope expires. A compromised signing key is different:
  the old key can mint valid authority, so containment means removing it from
  verifiers, accepting that live sessions become invalid.
- **Never print or relay secret material.** Compare key ids and public keys,
  not private keys. Notes, issues, and logs are assumed publishable.
- **Tags are immutable.** A fix ships as a new tag. Do not move or delete a
  release tag.
- **The host owns the incident.** `org-hats` provides the mechanism and this
  runbook; the deploying operator owns provider rotation, traffic, secret
  custody, and user communication.

## Classify first

| Finding | First action | Do not wait for |
| --- | --- | --- |
| Signing private key exposed | Generate replacement pair; distribute new public key; switch signer; remove old verification key | The normal envelope-lifetime overlap |
| Unknown key in `AUTHORITY_VERIFICATION_KEYS` | Remove it; determine who could alter deployment configuration; consider full host compromise | A rotation window |
| `OPS_TOKEN` exposed | Rotate the host secret and redeploy; review state; rotate sealed IdP secret if it could be read | A release |
| Sealed IdP client secret exposed | Rotate at the provider; install new sealed config; destroy old exports/backups | Rebuilding authority state |
| Envelope or refresh handle leaked | Invalidate the host session; revoke the affected refresh authority through the owning command | A signing-key rotation |
| Activation secret exposed | Revoke the request through `/ops/organization/revoke-activation` and issue a fresh activation | The actor re-requesting |
| Deployment has no signing config | Treat as a deployment defect: ephemeral per-isolate keys; stop rollout and configure the signing trio | The next release |

## Signing-key compromise

The signing triple is `AUTHORITY_SIGNING_KEY`,
`AUTHORITY_SIGNING_PUBLIC_KEY`, and `AUTHORITY_SIGNING_KEY_ID`; verifiers use
`AUTHORITY_VERIFICATION_KEYS`. A partial signing set errors at runtime
construction — the first request into an isolate — and the runtime proves
the pair when the signer is built.

1. **Preserve evidence without exposing the key.** Record the observed key
   id, how the key is believed to have leaked, affected deployments, and the
   time window. Do not copy the private key into the incident record.
2. **Generate a new Ed25519 pair and a new key id** in the host's secret
   store.
3. **Publish the new public key before switching the issuer.** Add it to
   `AUTHORITY_VERIFICATION_KEYS` for every verifier that must accept the new
   envelopes, and deploy those verifiers. This includes hosts outside this
   repository that verify `org-hats` envelopes.
4. **Switch the signing triple** to the new private key, public key, and key
   id, and deploy the issuer.
5. **Remove the compromised public key from every verifier immediately.**
   Do not retain it for the normal overlap. Existing envelopes signed by the
   compromised key fail after removal; that is the intended containment.
   If a verifier cannot be reached yet, treat every envelope it accepts from
   the compromised key as untrusted. The authority serves its configured
   set plus the current signer, so the compromised key disappears from
   `GET /ops/verification-keys` only once the signing triple no longer
   names it; removal from `AUTHORITY_VERIFICATION_KEYS` takes effect at
   verifiers immediately.
6. **Assume existing sessions are compromised.** Force host-side re-login,
   invalidate cookies, and require fresh authentication where the product
   needs it.
7. **Check refresh authority separately.** A key rotation does not revoke
   refresh handles. There is no global bulk-refresh revoke:
   - disable or unlink affected actors, or revoke the affected
     participation/grant/team, to kill their refresh records;
   - if the handle store may also have been exposed, treat the affected
     accounts as compromised and use the owning authority commands rather
     than assuming key rotation fixed the session chain.
8. **Verify the result.** `GET /ops/verification-keys` must show the expected
   current key id and public key, and no compromised key. Verify a newly
   issued envelope end to end. Confirm no verifier still trusts the old key.

### If the old key must remain for continuity

That is a deliberate risk acceptance, not a normal rotation. While the old
key remains trusted, anyone holding it can mint valid envelopes for every
operation whose verifiers still accept it. Record the decision, the expected
removal time, and the affected verifiers. Prefer removal over continuity for
a confirmed private-key exposure.

## Verification-key-set tampering

`AUTHORITY_VERIFICATION_KEYS` is the trust root for verification. If it
contains a key nobody authorized:

1. Remove the key from the configuration and redeploy every verifier.
2. Rotate the signer as above if the added key could have signed anything.
3. Determine whether the actor could also change `AUTHORITY_SIGNING_*`, the
   deployment secrets, or the release pipeline. If so, treat the host as
   compromised, not just the key set.
4. Re-run the artifact and tag checks on the deployed release:
   `bin/check-version <tag>` and, for the Cloudflare artifact,
   `bin/check-artifact <tag>`; the release checks are
   [publishing.md](publishing.md)'s.

## `OPS_TOKEN` compromise

`OPS_TOKEN` is all-or-nothing operator authority: bootstrap, principal-link
writes, activation recovery, routing facts, export, and restore. It is not a
tenant token and has no per-route scopes.

1. **Rotate the token at the host secret store and redeploy.** Remove the old
   value everywhere; do not leave a grace copy.
2. **Limit the window.** If a private ops Worker or network restriction
   fronts the ops routes, disable the exposed path while rotating.
3. **Review authority state using exports:** organization actors,
   administrators, principal links, invitations, activation requests,
   sealed IdP configuration; operation slugs, sites, teams, grants,
   participations, outbox, and refresh records. Compare against a trusted
   backup. Restore a known-good snapshot through `/ops/restore` when state
   was altered; restore is authenticated and atomic, and it re-delivers the
   snapshot's undelivered outbox rows on the next drain, so a snapshot's
   outbox is part of what you are trusting.
4. **Rotate the sealed IdP client secret** if the token could read it. An
   export contains the sealed configuration.
5. **Check the release surface.** Confirm the deployed commit and tag, and
   that `dist/` matches the tag. An ops compromise does not by itself expose
   the signing private key, but it may expose every state fact the operator
   can read.

## Sealed identity-provider configuration

The sealed configuration is opaque to the portable core, not encrypted by
`org-hats`. It is stored by the organization object, included in organization
exports, and read by the provider-callback exchange.

1. Rotate the client secret at the provider.
2. Install the new configuration through the organization bootstrap route,
   which updates the organization's sealed configuration. Do not edit storage
   directly.
3. Destroy old exports, backups, and browser downloads that contain the old
   secret.
4. Verify a fresh login through the provider-callback exchange and confirm
   the old secret no longer works at the provider.

## Envelope and refresh-handle exposure

An envelope is a bearer credential; it is replayable until `exp`. A refresh
handle is a bearer credential that can rotate once, subject to the operation's
live organization read and revocation state.

1. Invalidate the host session and remove the cookie/browser state.
2. Revoke the refresh authority through the owning command: disable the
   actor, unlink the principal, revoke participation, or revoke the grant or
   team that the session stood on.
3. If the exposure is broad or the attacker had signing authority, follow the
   signing-key procedure; otherwise a key rotation does not revoke refresh
   handles.
4. Record the affected actor and operation; do not put the envelope or handle
   itself in the incident note.

## Development signer check

When none of the signing variables are set, the runtime creates an ephemeral
Ed25519 key per isolate. That is for local development only. A deployment
with no signing configuration will mint envelopes no external verifier should
trust, and the key id changes across isolates.

Before or after any incident, confirm:

- the signing triple is present and complete in the deployed environment;
- `GET /ops/verification-keys` shows the expected stable key id and public
  key;
- the host's deployment gate refuses the development fallback in production.

## Activation-secret exposure

An activation secret is a bearer credential until redeemed: return-once,
22 characters, 128 random bits. Only its SHA-256 digest is stored, so a
store leak exposes digests, not secrets, and brute force from digests is
bounded by the secret's entropy.

1. Revoke the exposed request through
   `/ops/organization/revoke-activation` — containment first.
2. Issue a fresh activation; the old secret is dead once revoked.
3. Record the request id, not the secret.

## Demo and harness routes

The shipped Worker serves unauthenticated demo routes: `/demo/bootstrap`
resets and reseeds the coordinators, `/demo/login` mints an envelope
and refresh handle, `/demo/access` verifies one, and `/increment` is a
harness counter. The reference production config attaches no routes
and reaches the Worker only through the service binding. A deployment
that routes the Worker publicly must front or filter these routes before
it carries real authority.

## Normal rotation

The routine, non-compromise procedure remains verifier-first:

1. generate the next key pair and key id;
2. add the new public key to `AUTHORITY_VERIFICATION_KEYS` everywhere;
3. switch the signing triple;
4. retain the old verification key until the last envelope it signed has
   expired;
5. remove the old key and verify.

This is the same routine [cloudflare.md](cloudflare.md) states for
rotation; move the two together when either changes.

The envelope lifetime is deployment configuration; use the maximum lifetime
the host can issue, not the default as an assumption. The key set is the
rotation unit; an empty set, a duplicate key id, or malformed key material
fails closed.

## Aftercare

- Verify the deployed tag, manifest, and `dist/` have not moved.
- Re-run the host's acceptance for the affected operation: issuance, refresh,
  context, export/restore, and the service binding where used.
- Record the timeline, the affected key ids, the removal confirmation, and
  the user/session action taken. Never record private keys, tokens, refresh
  handles, activation secrets, or sealed configuration in the note.
- If the compromise crossed a trust boundary not covered here — host
  product code, IdP, Cloudflare account, or release credentials — the host's
  incident process owns it.
