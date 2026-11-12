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
- **Rotation contains future use, not past effects.** Replacing a credential
  stops the holder using it again; it does not undo what they already did.
  This runbook says in three places that a signing-key rotation does not
  revoke refresh handles, and the same applies to the ops token: rotating it
  does not remove an administrator it appointed or a principal link it bound.
  For every compromised credential, ask separately what it could *write* and
  contain that through the authority that owns it.
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
| `OPS_TOKEN` exposed | Rotate the host secret and redeploy; hunt the writes it could leave behind — links, administrators, sealed config, activations; rotate the sealed IdP secret if it could be read | A release |
| Sealed IdP client secret exposed | Rotate at the provider; install new sealed config; destroy old exports/backups | Rebuilding authority state |
| Envelope or refresh handle leaked | Invalidate the host session; revoke the affected refresh authority through the owning command | A signing-key rotation |
| Activation secret exposed | Revoke the request through `/ops/organization/revoke-activation` and issue a fresh activation | The actor re-requesting |
| Unexpected restore | Rotate `OPS_TOKEN`; read `GET /ops/audit` for the restore row; restore a known-good snapshot; re-check links and administrators first | A root-cause finding |
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
5. **Hunt the writes the token could leave behind.** Rotation stops further
   use; it does not undo these, and each outlives the token:
   - **a principal link bound to an existing actor.** Bootstrap inserts links
     for `(provider, subject)` pairs that do not yet exist — a conflicting
     re-point is refused, but a *fresh* subject bound to an administrator's
     actor is not. The holder can then authenticate through the real provider
     as that subject, with no token at all. Contain with
     `/ops/organization/unlink-principal` for the affected actor; compare
     `GET /ops/organization/principal-links` against the roster you expect.
   - **administrator standing introduced through creation or restore.**
     Bootstrap seeds administrators only when it creates an organization; a
     restore can replace standing in an existing organization. Rotation does
     not undo either. There is no ops route that retires an administrator:
     use `retire-administrator` under a surviving administrator's fresh
     evidence, or restore known-good state.
   - **a replaced sealed provider configuration**, which redirects
     authentication itself — see the sealed-configuration section, and treat
     it as the most urgent of these.
   - **issued activations**, each a live bearer secret until revoked or
     expired. Revoke with `/ops/organization/revoke-activation`.
   - **restored state**, which is the heavy hammer and leaves its own audit
     row; see the malicious-restore section.
6. **Read the audit trail.** `GET /ops/audit?coordinator=…&id=…` returns
   `{ seq, at, actor, fact }` and nothing else, so it is the tool for this
   review rather than a full export: it carries no sealed configuration to
   protect while you read it. Attribution is only as good as the operator
   identity callers were sending, and a holder of the token can claim any
   identity, so read the facts and treat the actor column as a hint.
7. **Check the release surface.** Confirm the deployed commit and tag, and
   that `dist/` matches the tag. An ops compromise does not by itself expose
   the signing private key, but it may expose every state fact the operator
   can read.
8. **Verify the rotation took effect.** A request carrying the old token must
   be refused, and one carrying the new token accepted, on a route that
   changes nothing — `GET /ops/schema-status` or `GET /ops/audit`.

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
5. **Verify.** The handle is refused on a second use, and a context call with
   the exposed envelope is refused once the owning command has landed — or, if
   the envelope is merely unexpired, confirm the window you are accepting and
   when it closes. An envelope cannot be revoked; only its lifetime and the
   state behind it bound the exposure.

## Malicious or unexpected restore

A restore replaces every table in a coordinator with the snapshot's rows. It
is authenticated by `OPS_TOKEN` and atomic, so an unexpected one means either
that token or an operator process is compromised; classify it with the
ops-token section as well as here.

**Detection.** A restore writes one audit row recording itself, and it is
written after the tables are replaced, so the snapshot cannot overwrite the
trace of the act that applied it. `GET /ops/audit` shows it as
`state restored from a snapshot of schema <n>`, attributed to the operator
identity the caller claimed. That row is the one entry a snapshot cannot
supply; its absence where you expected a restore, or its presence where you
did not, is the signal.

**What a snapshot can and cannot assert.** This bounds the response:

- it **can** reinstate every column the coordinator owns, including
  refresh-record `revoked` and `superseded` flags and team status, as stated —
  a snapshot's facts are trusted, only its structure is validated;
- its undelivered outbox rows **are** re-delivered on the next drain, but not
  applied twice: the message id is the outbox row id, which survives the
  restore, so the receiving coordinator recognises the replay;
- an **operation** snapshot cannot assert an actor's enabled state: its roster
  projection is absent from the export and rebuilt by pulling. If the actor
  remains disabled at the organization, refresh is refused regardless of the
  operation snapshot's refresh-record flags. An **organization** snapshot can
  replace actor disabled flags and administrator standing, so those facts must
  be checked after an organization restore.

**Containment.**

1. Rotate `OPS_TOKEN` first and follow the ops-token section — the restore is
   evidence of that credential's misuse, not a separate incident.
2. Restore a known-good snapshot of your own. Prefer this to repairing rows:
   the restore path is typed and atomic, and direct storage edits bypass every
   control the rest of this runbook relies on.
3. Re-check the facts a snapshot is trusted to state, in this order:
   principal links, administrators, grants and participations, then refresh
   records. The first two are persistence; the rest are reach.
4. Expect the next drain to re-deliver the snapshot's undelivered outbox rows.
   That is normal and bounded, but read the audit trail on the receiving
   coordinator rather than assuming nothing arrived.

**Verify.** A fresh export matches the snapshot you intended, apart from the
audit row recording your own restore; issuance, refresh, and context work for
a known actor; and a disabled actor is still refused.

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
harness counter. They refuse to serve unless the deployment sets
`DEMO_ROUTES: "1"`, and the reference production config deliberately
does not set it: a routed deployment and its service-binding callers
get 404s. Confirm no deployment that carries real authority sets the
flag — an operator who does re-opens the exposure.

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
