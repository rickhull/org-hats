// The root export: the v1 generic organization model and the policy-bundle
// vocabulary (docs/authority_redesign.md § Core). The authority engine and
// the access verifier are separate subpaths — `org-hats/authority`,
// `org-hats/access` — and nothing here knows about them. The id aliases
// and `Unbranded` are shared vocabulary (src/contract.ts), re-exported so
// a root consumer can name them without importing a subpath. The aliases
// are the model's branded ids — the root is the core, not the host seam;
// hosts annotate their own strings with `Unbranded<OrganizationId>` and
// never need a constructor.
export * from "./model.js";
export * from "./policy.js";
