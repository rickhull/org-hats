// The normative authority interface — the types every implementation (the
// in-memory adapter shipped beside this module, the Cloudflare reference
// runtime) and every consumer codes against. docs/authority_redesign.md
// § Authority is the charter; this file is the normative specification.
// Shapes are settled here, reviewed with the consumer, and hardened behind
// the interface; changes after the review gate are additive-only or
// re-reviewed.
export { AUTHORITY_INTERFACE_VERSION } from "../contract.js";
