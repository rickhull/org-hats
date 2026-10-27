# Binding conformance — the smoke subset

*The documented claim for a deployed `AuthorityRuntime` reached through a
service binding. It is **not** the full `OH-*` inventory. The full inventory
remains the workerd suite against the real coordinators
(`packages/cloudflare/test/conformance.test.ts`); this subset proves the
binding and entrypoint preserve the public runtime behaviour for a dedicated,
pre-bootstrapped operation without resetting it.*

*The reference runtime is deployed by the consuming host. The live
deployment is `cloudflare-v0.6.0` (configuration version `6044e4fe…`,
Worker Version tag `2720efd9…-config-5837ca5f866e`), accepted on
2026-10-26 with fresh fixture `org-authority-smoke-20261027a`; the subset
passed all six groups, and `exec authority verify` and schema status passed.
The previous acceptance, `cloudflare-v0.5.0` (configuration
`e7b4529…-config-627ee8a6f000`, fresh fixture
`org-authority-smoke-20261026c`), also passed all six groups on 2026-10-26;
`cloudflare-v0.4.0` (configuration
`c22a252efdcb391d796503c760b90a1a20392381-config-5ad6c5e46589`, fixture
`org-authority-smoke-20261026b`) passed the same day, and the host recorded
each acceptance. `cloudflare-v0.5.0` is the rollback target.  The live
pointer is the host's acceptance: upstream records it only after the host has
deployed and accepted the version.*

## Preconditions

- A dedicated authority deployment at the accepted `cloudflare-v*` tag,
  reachable as the host's Worker through the `AuthorityRuntimeEntrypoint`
  service binding. The claim names the binding contract, not any host's
  Worker name.
- A dedicated operation and organization fixture, a linked principal, and a
  wearable grant for the test actor. This is not the product operation.
- The distributed `VerifyKeySet` for the deployment, in `org-hats/access`
  form.
- A way to disable the dedicated test actor at the organization without
  delivering the roster image or `actor-disabled` message to the operation,
  for the stale-projection case.
- No reset/bootstrap call. The smoke consumes the seeded operation; `refresh`
  rotates its handle, so a rerun uses a fresh fixture or operation. The
  disabled-actor case is one-shot: the actor stays disabled, so a rerun
  needs a fresh actor (and a fresh fixture once its handle has rotated).

## Claim

Through the service binding, with the interface version the deployed tag
carries (`3` for the live `cloudflare-v0.6.0`; `2` for `cloudflare-v0.5.0`,
the rollback target):

1. `accessFromEvidence` for the linked evidence returns a signed envelope and
   a refresh handle.
2. `verify(envelope, keys, { expectedOperationId, expectedSiteId })` returns
   verified claims and neutral access: the actor pair, operation, sites,
   selected hat, and its actions.
3. `refresh(handle)` returns a new envelope and a rotated handle; the new
   envelope verifies, and replaying the old handle fails
   `unauthenticated`.
4. `context(envelope)` returns the actor, operation, site(s), wearable hats,
   and selected hat.
5. One command the policy refuses returns a closed failure (`denied`); it is
   not an ambiguous success.
6. Verification with the wrong operation fails `wrong-binding`; verification
   with `now >= exp` fails `expired`.
7. With the organization's actor disabled and the operation projection still
   saying enabled (the disable message was not delivered or reconciled),
   refresh fails `not-admitted`; it does not issue a replacement. The live
   organization read is the gate; the projection is not the revocation
   promise. An organization that cannot answer fails `unavailable`.

No reset or bootstrap is called, and this subset does not exercise the
remaining `OH-*` cases. Do not report it as the full inventory.

The seven steps above are six groups: steps 1 and 2 are one check.  The
runner's names are `issue-and-verify`, `refresh-and-supersede`, `context`,
`denied-command`, `wrong-binding-and-expired`, and
`stale-projection-refresh`.

## Procedure

Use the service binding as the `AuthorityRuntime` in the test host, and a
verifier built from the distributed key set:

1. Issue from the linked principal's evidence for the dedicated
   `operationId`. Keep the envelope and refresh handle.
2. Verify with `expectedOperationId` and the site the fixture admits. Assert
   the actor, operation, selected hat, and actions.
3. Refresh with the handle. Verify the replacement envelope. Replay the old
   handle and assert `unauthenticated`.
4. Call `context` with the replacement envelope. Assert the operation, at
   least one admitted site, and the wearable/selected hat.
5. Send a command the fixture's policy refuses, authorized by an actor
   the policy does not admit to that action, or by an unrelated grant. Assert
   `ok: false` with a closed failure — `denied` for a valid command the policy
   refuses.
6. Verify the replacement envelope with another operation's id and assert
   `wrong-binding`. Verify it with `now` at or after `exp` and assert
   `expired`.
7. Disable the dedicated actor at the organization while leaving the
   operation's projection stale — do not deliver the roster or
   `actor-disabled` message and do not reconcile. Refresh the current handle.
   Assert `not-admitted`; do not accept a replacement envelope.

The full `OH-*` claim is run separately:

```sh
pnpm --filter org-hats-cloudflare test
```

That suite boots the real coordinators in workerd, resets them per case, and
runs the complete inventory. It is the authority for the full claim; the
binding smoke is the additional evidence for the deployed entrypoint.

The binding subset and the exchange round trip are executable here:

```sh
pnpm --filter org-hats-cloudflare exec vitest run test/binding-smoke.test.ts
pnpm --filter org-hats-cloudflare exec vitest run test/exchange-devidp.test.ts
```

The first bootstraps the conformance world and supplies the runtime, key set,
operation-status, and direct-disable dependencies the smoke needs. The second
drives the provider exchange against a test provider through the fetch seam.
Both are test assets, not published surface.
