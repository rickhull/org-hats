# Examples

Runnable proof, not package surface. `bin/check` runs all examples after
the suites.

```sh
node examples/pilot.ts
node examples/own-world.ts
node examples/consumer-access.ts
```

`pilot.ts` imports the public subpaths only (`authority`, `access`); it must
never reach into an internal seam. It bootstraps the Professional Operation,
resolves verified evidence, issues and verifies a signed envelope with a
distributed public key, calls neutral predicates, and shows the bounded-expiry
denial.

`own-world.ts` is the same path through a world of your own: a small
organization, its sites and teams, two grants for one actor, and its policy
bundle enter through `defineWorld`, which validates the bundle, the snapshot
invariants, and the one-operation rule before the engine boots. The example
then switches hats for real (`select-hat` to a different grant), refreshes
onto the new capacity, and maps verification outcomes onto an HTTP handler's
status codes.

`consumer-access.ts` is the host's side of the seam. It verifies a real
envelope, shows the wrong-operation 404 and the expired and forged 401s, then
maps every kind in the closed failure taxonomy to an illustrative product
response. The switch is exhaustive: a new kind stops the example compiling,
which is the contract working.

Examples are not shipped in the package (`files: ["dist", "SECURITY.md"]`);
they are repository proof.
