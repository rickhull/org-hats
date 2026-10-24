// The root export: the v1 generic organization model and the policy-bundle
// vocabulary (docs/authority_redesign.md § Core). The authority engine and
// the access verifier are separate subpaths — `org-hats/authority`,
// `org-hats/access` — and nothing here knows about them.
export * from "./model.js";
export * from "./policy.js";
