// The verification-only consumer module.
//
// Charter (docs/authority_redesign.md § Access): it accepts a signed,
// versioned authority projection and exposes neutral authority facts —
// operation and site binding, the selected hat's actions over a neutral
// target, readable organization and team ids, configuration reach. It never
// names a product entity; product verbs are host code. Unsupported versions
// fail closed.
//
// The verifier and its fixed vectors ship here (plans/v1.md M4); the
// interface and the envelope contract are the M1 specification.
export { verify, ed25519VerifyKey, verifyKeyOf } from "./verify.js";
export { ACCESS_ENVELOPE_FORMAT, ACCESS_ENVELOPE_VERSION, AUTHORITY_INTERFACE_VERSION, base64Decode, base64Encode, base64UrlDecode, base64UrlEncode, canonicalJson, utf8, } from "../contract.js";
