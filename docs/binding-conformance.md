# Binding conformance — the smoke subset

*The documented claim for a deployed `AuthorityRuntime` reached through a
service binding. It is **not** the full `OH-*` inventory. The full inventory
remains the workerd suite against the real coordinators
(`packages/cloudflare/test/conformance.test.ts`); this subset proves the
binding and entrypoint preserve the public runtime behaviour for a dedicated,
pre-bootstrapped operation without resetting it.*

## Preconditions

- A dedicated authority deployment at the accepted `cloudflare-v*` tag, with
  `reporting-stream-authority` and the `AuthorityRuntimeEntrypoint` service
  binding.
- A dedicated operation and organization fixture, a linked principal, and a
  wearable grant for the test actor. This is not the product operation.
- The distributed `VerifyKeySet` for the deployment, in `org-hats/access`
  form.
- No reset/bootstrap call. The smoke consumes the seeded operation; `refresh`
  rotates its handle, so a rerun uses a fresh fixture or operation.

## Claim

Through the service binding, with `interfaceVersion: 2`:

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

No reset or bootstrap is called, and this subset does not exercise the
remaining `OH-*` cases. Do not report it as the full inventory.

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
5. Send a command the fixture's policy refuses, authorized by a non-admin or
   an unrelated grant. Assert `ok: false` with a closed failure — `denied` for
   a valid command the policy refuses.
6. Verify the replacement envelope with another operation's id and assert
   `wrong-binding`. Verify it with `now` at or after `exp` and assert
   `expired`.

The full `OH-*` claim is run separately:

```sh
pnpm --filter org-hats-cloudflare test
```

That suite boots the real coordinators in workerd, resets them per case, and
runs the complete inventory. It is the authority for the full claim; the
binding smoke is the additional evidence for the deployed entrypoint.
