// The portable authority engine — a deep module, not a repository.
//
// Charter (docs/authority_redesign.md § Authority): it owns the complete
// organizational use cases — participation workflows, admission and grants,
// hat selection, evidence resolution, refresh and envelope issuance — behind
// one runtime interface with a closed failure taxonomy. Persistence is an
// internal seam; the in-memory adapter ships beside it in this package and
// no adapter SPI is published.
//
// The normative specification: the runtime surface, the policy-bundle
// vocabulary, and the synthetic twins as data. The in-memory engine
// implements these types; nothing here is speculative.
export { AUTHORITY_INTERFACE_VERSION } from "./types.js";
export { actionsOf, validatePolicyBundle } from "../policy.js";
export { DANA_OKAFOR, FESTIVAL, FESTIVAL_BOOTH_COUNT, HARBOR_LOGISTICS, PROFESSIONAL_OPERATION, TWINS, } from "./twins.js";
export { createInMemoryAuthority } from "./engine.js";
export { ACCESS_ENVELOPE_FORMAT, ACCESS_ENVELOPE_VERSION, canonicalJson, } from "../contract.js";
