# Authority playground — teaching prototype

Can you tell the selected action hat apart from read, configuration, and team
reach? What changes when the same actor works in another operation, or when a
grant is revoked? This prototype makes those questions clickable using the
real portable authority engine and access verifier.

From the repository root, after `pnpm install`:

```sh
pnpm playground
```

Open <http://127.0.0.1:4173>. `PORT=4174 pnpm playground` chooses another
port. Use a current browser with Web Crypto Ed25519 support. The tracked
`dist/` supplies the library modules; run `pnpm build` if it is missing or if
you change root `src/`. The server uses the project's existing TypeScript
tooling to transpile the demo controller; there is no separate bundler or
browser framework.

## What to try

1. Start as Dana with the coordinator hat. Compare the team actions with
   site configuration, readable work, and team reach: these are separate
   authority layers.
2. Select the site administrator hat. The new envelope changes the acting
   capacity; the other layers still reflect the union of wearable grants.
3. Revoke the worn grant. The displayed live grants change, but the retained
   envelope still verifies locally. Try refresh: renewal is refused.
4. Advance to that envelope's exact expiry. Verification now refuses it,
   and the displayed permissions disappear. Reset to explore again.

The starting data is the existing Professional Operation and Festival twins.
The demo adds one synthetic administrator grant for Dana at West Yard through a real
`grant-hat` command, so one actor has two selectable hats. That is a teaching
setup, not a change to the shipped twin. Administrator role titles are
explicit example configuration, not built-in authority. The Festival twin
keeps its original data.

## One actor, two operations

Switch from Meridian Field Services to Riverbend Fest while Dana is selected.
The organization actor stays the same; the operation, hat, action vocabulary,
and read policy change. At the festival Dana administers Park Gate. Tasting
Row's booths are readable under the festival's `all-participating` read
policy, but the gate hat does not act at or reach those booths. Expand the
booth list to inspect the rest of the fixture.

Try the envelope in the other operation. With a valid envelope, the real
verifier reports `wrong-binding`; it does not transfer the hat. That probe
does not change the current operation's permissions. An expired envelope
still reports expiry according to the verifier's normal failure precedence.

Switching views retains a separate session for each operation and actor;
it does not reset revoked grants or renew an existing session. Revoking the
professional-operation grant and failing its refresh leaves the festival's
session usable. The simulated clock is shared: advancing to expiry can also
expire envelopes already issued in the other operation. Reset discards both
worlds and all sessions.

## From actor to access

Open <http://127.0.0.1:4173/activation> or choose **From actor to access**
in the lesson navigation. This page has its own engine and reset; it does
not change the exploration page's world.

1. **Create actor and check access.** Dana, an explicitly seeded organization
   administrator, creates a new Harbor Logistics actor. It has no principal
   link or hat. The learner's synthetic evidence is still `unauthenticated`.
2. **Activate identity and check access.** The lesson requests an activation
   as Dana and accepts it using the learner's synthetic provider evidence.
   The link now exists, but issuance is `not-admitted` because no hat exists.
3. **Grant hat and check access.** Len, an operation administrator under the
   example configuration, grants the `field` role at Yard crew. Issuance and
   local verification now succeed, and `observe` is allowed there.
4. **Replay activation.** Repeating the same secret with the same subject
   reports `applied: false`; another subject is refused. These probes do not
   issue or refresh an envelope.
5. **Unlink the principal.** Dana removes the link. The actor and grant stay.
   Try refresh and fresh issuance: both are refused, while the retained
   signed envelope still verifies. Advance to its exact expiry to see local
   access stop too.

This is a guided order, not a dependency rule. Authority also permits a
known actor to receive a grant before activation; the lesson lets you try
that order. Issuance stays `unauthenticated` until evidence is linked, then
succeeds because the grant is already present. Creating an actor never
creates a link, and activation never creates a grant.

The activation secret and refresh handle stay inside the disposable
controller. Its view and event log contain outcomes, not those values. Actor
and grant facts come from the engine snapshot; the displayed link state
records successful acceptance and unlink transitions. The lesson supplies
synthetic authenticated-provider evidence; it does not implement or prove a
real provider login, redirect, delivery channel, or account-recovery flow.

## Boundaries

Each tab owns a fresh engine, signing key, synthetic principal links,
sessions, and an adjustable clock in memory. Reset or reload discards them.
No real provider login occurs: the demo supplies fixture evidence. Signing
material here authorizes only this disposable synthetic world.

The local server serves only the prototype and built JavaScript modules on
loopback. It holds no authority state, accepts no mutation requests, and
stores no data. The browser contacts no external service. There are no
accounts, cookies, saved drafts, deployment controls, or live authority
bindings.

Permissions come from the access verifier; the UI does not rebuild policy.
Live grants and the retained envelope are deliberately shown separately. A
failed refresh leaves the old envelope visible so its remaining validity
can be observed. Advancing time changes both the issuer's injected clock
and the verifier's explicit `now`.

This browser shell is an experiment in teaching the model. It is not a
production administration UI, an authentication flow, or a hosted service.
The model's acceptance witnesses live in `tests/playground.test.ts` and
`tests/playground-activation.test.ts`; run `pnpm check` for the repository
gate. No package export or Cloudflare runtime is added by this example.
