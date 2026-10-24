# Examples

Runnable proof, not package surface. `bin/check` runs the pilot after the
suites.

```sh
node examples/pilot.ts
```

`pilot.ts` imports the public subpaths only (`authority`, `access`); it must
never reach into an internal seam. It bootstraps the Professional Operation,
resolves verified evidence, issues and verifies a signed envelope with a
distributed public key, calls neutral predicates, and shows the bounded-expiry
denial.

Examples are not shipped in the package (`files: ["dist", "SECURITY.md"]`);
they are repository proof.
