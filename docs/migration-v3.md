# Migrating from org-hats v2 to v3

**Status:** the next major, `3.0.0`, crosses this break; `2.2.0` is the last
2.x release. The envelope format does not move. This note records the deltas
a consumer crosses. The architecture itself is unchanged — see
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

## Consumer checklist

- Send `interfaceVersion: 3`.
- Replace `no-capability` with `action-not-carried` in decision handling.
- Replace `NeutralAccess.memberTeamIds()` with `teamReach()`.
- Leave envelope verification and the `memberTeamIds` claim alone.

The Cloudflare package follows its own `0.x` cadence; the first release
after this break carries interface 3. Its operation schema and envelope
format do not move.
