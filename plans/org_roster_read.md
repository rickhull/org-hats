# Organization roster read and standing on context

## The work

Two additive seam reads, decided with Quartermaster across
`notes/to-quartermaster.md` (entries "Both asks taken…" and "Shape
closed…"):

1. `AuthorityContext.administrator` — organization-administrator standing
   as a live presentation fact, so a host can hide its administration
   surface. Commands keep checking standing at the handler; the envelope
   gains no claim (a signed bearer standing fact is explicitly refused).
2. `AuthorityRuntime.roster()` — the organization's roster, authorized by
   a valid access envelope and gated server-side on the same standing:
   - `actors`: organization-wide, unfiltered by the envelope's operation —
     id, display name, disabled state;
   - `teams`: the teams the organization fields **in the envelope's
     operation** — id, display name, status.

Non-goals, recorded in the consumer exchange: no member-visible roster (a
member directory would be a separate narrower read); no operation-admin
standing on `context()` — that is hat-derived and already projected
(`configureActions`/`adminRoles`, `configurableSiteIds`); the one residue
(a role in `adminRoles` carrying no configure action is envelope-invisible)
is answered by the deployment rule "every declared admin role carries a
configure action", not by a seam field.

## Done-when

- Both runtimes (in-memory, Cloudflare) answer `roster()` and carry
  `administrator` on the context, passing the shared conformance
  inventory; the interface version stays `3` and the envelope format
  stays `1` (additive-only).
- A non-administrator's envelope is `denied`; a disabled actor's
  still-live envelope reads until expiry (the envelope is the remaining
  authority, the rule `disable` already states).
- The docs state the read and the standing fact; `docs/inventory.md` and
  `tests/conformance.test.ts` pin the new cases.

## Evidence

- New conformance cases `OH-ROSTER-06..08` and the rows that pin them.
- `tests/roster.test.ts` and `tests/context.test.ts` (in-memory),
  `packages/cloudflare/test/roster.test.ts` and `context.test.ts`
  (Cloudflare), all green through `pnpm verify`.
- A containing release for the consumer to pin, after Rick commits.
