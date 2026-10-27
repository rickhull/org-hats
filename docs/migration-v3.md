# Migrating from org-hats v2 to v3

**Status:** `3.0.0` crosses this break; `2.2.0` is the last 2.x release. The
envelope format does not move. This note records the deltas a consumer
crosses and how to cross them. The architecture itself is unchanged — see
[authority_redesign.md](authority_redesign.md).

## 2.x → 3.0

### The interface version is 3

`AUTHORITY_INTERFACE_VERSION` moves from 2 to 3, so a 2.x caller gets
`wrong-interface-version` before its command body is interpreted. Send 3.
A breaking call or result shape is a breaking interface; additive changes
still do not move the version.

### The denial reason is `action-not-carried`

`Decision.reason` changes from `no-capability` to `action-not-carried`. It
still means “the worn role does not carry the action”; the decision shape
and the failure taxonomy are unchanged. A host that switches on the reason
must update its match.

### `memberTeamIds()` becomes `teamReach()`

`NeutralAccess` renames the method. It returns the same team ids: the teams
the actor's wearable grants reach, what a site-local view lists without a
grant query.

The envelope claim field keeps the historical name `memberTeamIds` because
the envelope format does not move. A host that reads the claim directly
still sees that field; a host that uses neutral access calls `teamReach()`.

### Envelopes keep reading across the break

`ACCESS_ENVELOPE_VERSION` stays 1. Verification gates on the envelope
version pair — `format`, the envelope's `v`, and the claims' own `v` — and
never on the claims' `interfaceVersion`, which is issuer provenance. A
2.x-issued envelope therefore keeps verifying on a 3.x runtime; no live
session drops because the call vocabulary changed. The claim field name is
unchanged.

## Cutover

The version gate is strict equality in both directions
(`src/authority/engine.ts:250`): a 2.x caller sending `interfaceVersion: 2`
is refused by a v3 authority, and a 3.x caller sending `interfaceVersion: 3`
is refused by a live v2 authority. Neither side can move first by
tolerating the other's version; there is no compatibility window upstream.
The cutover is therefore an explicit version change on both sides, with a
short interval in which one side is ahead — never a tolerant mixed state.
There are two shapes, chosen by what the platform retains.

**Same Worker, version flip.** When the platform keeps Worker Versions and
both versions share the Worker's storage (Cloudflare Worker Versions against
the same Durable Object namespace), flip the active version on the existing
Worker:

1. Publish the v3 authority and the changed callers as Worker Versions,
   leaving the live versions active. The previous versions stay
   addressable, so rollback is an activation, not a redeploy.
2. Flip the authority's active version to v3 and the callers' active
   versions to the changed code. A short `wrong-interface-version` window
   is unavoidable while a caller and the authority disagree; envelopes are
   unaffected, so only new commands and calls fail.
3. Roll back by reactivating the previous versions. Both authority versions
   use the same storage, so state does not diverge and no export/restore is
   involved.

**Two Workers, binding flip.** When the platform does not keep addressable
versions, or the two deployments do not share storage, cross the break
blue/green at the service binding:

1. Stand the v3 authority up as a second Worker, alongside the live v2
   deployment. Both run; neither caller population is touched yet.
2. Flip the host's service binding to the v3 Worker together with the
   caller changes from the checklist below, in one change. Before the
   flip, callers send `interfaceVersion: 2` to the v2 Worker; after, they
   send `interfaceVersion: 3` to the v3 Worker. There is no step where a
   3.x caller reaches a v2 authority or a 2.x caller reaches the v3
   authority.
3. Roll back by flipping the binding back to the v2 Worker, reverting the
   caller changes in the same motion. State is per-Worker: a write the v3
   Worker accepted after the flip does not exist in the v2 Worker, so a
   binding flip alone loses it. Roll back either with no writes since the
   flip, or export the v3 state, restore it into the v2 Worker, and then
   flip the binding and revert the callers. The operation schema does not
   move, so a v3 export restores into v2.

Already-issued envelopes keep verifying across either flip: `ACCESS_ENVELOPE_VERSION`
stays 1, and verification never gates on the claims' `interfaceVersion` (see
[specs/envelope.md](../specs/envelope.md) E8). A 2.x-issued envelope keeps
verifying on the v3 Worker, so a session in flight at the moment of the flip
is not dropped — only new commands and calls need the new interface
version.

## Consumer checklist

- Send `interfaceVersion: 3`.
- Replace `no-capability` with `action-not-carried` in decision handling.
- Replace `NeutralAccess.memberTeamIds()` with `teamReach()`.
- Leave envelope verification and the `memberTeamIds` claim alone.

The Cloudflare package follows its own `0.x` cadence; `cloudflare-v0.6.0`
is the first release carrying interface 3. Its operation schema and
envelope format do not move.
