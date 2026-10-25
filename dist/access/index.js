// The verification-only consumer module — and the codec home for both
// sides of the envelope handshake.
//
// Charter (docs/authority_redesign.md § Access): it accepts a signed,
// versioned authority projection and exposes neutral authority facts —
// operation and site binding, the selected hat's actions over a neutral
// target, readable organization and team ids, configuration reach. It never
// names a product entity; product verbs are host code. Unsupported versions
// fail closed.
//
// The verifier and its fixed vectors ship here, and so does the
// verification-key set codec (`keys.ts`): the issuer serializes the set it
// signs with and the verifier parses the set it verifies with through one
// home, so the two sides cannot drift. The interface and the envelope
// contract are the normative specification.
export { verify, ed25519VerifyKey, verifyKeyOf } from "./verify.js";
export { VERIFY_KEY_SET_FORMAT, VERIFY_KEY_SET_VERSION, parseVerifyKeySet, serializeVerifyKeySet, verificationKeysFrom, verifyKeysOf, } from "./keys.js";
export { ACCESS_ENVELOPE_FORMAT, ACCESS_ENVELOPE_VERSION, AUTHORITY_INTERFACE_VERSION, base64Decode, base64Encode, base64UrlDecode, base64UrlEncode, canonicalJson, isFailed, utf8, } from "../contract.js";
