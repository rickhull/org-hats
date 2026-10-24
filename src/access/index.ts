// The verification-only consumer module.
//
// Charter (docs/authority_redesign.md § Access): it accepts a signed,
// versioned authority projection and exposes neutral authority facts —
// operation and site binding, the selected hat's actions over a neutral
// target, readable organization and team ids, configuration reach. It never
// names a product entity; product verbs are host code. Unsupported versions
// fail closed.
//
// The verifier and its fixed vectors ship here; the interface and the
// envelope contract are the normative specification.

export type { NeutralAccess, TargetRef, VerifiedClaims } from "./types.ts";
export { verify, ed25519VerifyKey, verifyKeyOf } from "./verify.ts";
export type { Verified, VerifyContext, VerifyKey } from "./verify.ts";

export type {
  AccessEnvelopeClaimsV1,
  ActorId,
  Failed,
  Failure,
  FailureKind,
  JsonValue,
  OperationId,
  OrganizationId,
  SiteBinding,
  SiteId,
  SignedAccessEnvelope,
  TeamId,
} from "../contract.ts";
export {
  ACCESS_ENVELOPE_FORMAT,
  ACCESS_ENVELOPE_VERSION,
  AUTHORITY_INTERFACE_VERSION,
  base64Decode,
  base64Encode,
  base64UrlDecode,
  base64UrlEncode,
  canonicalJson,
  utf8,
} from "../contract.ts";
