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
The model's acceptance witnesses live in `tests/playground.test.ts`; run
`pnpm check` for the repository gate. No package export or Cloudflare runtime
is added by this example.
