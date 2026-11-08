# Authority playground — teaching prototype

Can you tell the selected action hat apart from read, configuration, and team
reach? What changes when a grant is revoked, and what stays valid until the
already-issued envelope expires? This prototype makes those questions
clickable using the real portable authority engine and access verifier.

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

The starting data is the existing Professional Operation twin. The demo adds
one synthetic administrator grant for Dana at West Yard through a real
`grant-hat` command, so one actor has two selectable hats. That is a teaching
setup, not a change to the shipped twin. Administrator role titles are
explicit example configuration, not built-in authority.

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
