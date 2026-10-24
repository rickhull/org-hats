// The shared v1 vocabulary — identifiers, interface versions, the failure
// taxonomy, and the access-envelope contract.
//
// Both portable modules import from here and neither imports the other:
// authority fills an envelope, access verifies one, and this file is the
// shape they agree on (docs/authority_redesign.md § Access). It is pure data
// and pure functions, compiled with `types: []` alongside the core fence.
//
// Nothing here is re-exported from the v0.4 root (src/index.ts); it becomes
// public through the `org-hats/authority` and `org-hats/access` subpaths,
// whose names this specification pass settles.

// --- identifiers --------------------------------------------------------------

/**
 * v1 ids are caller-supplied and opaque — collision-resistant UUIDs in real
 * deployments. The named aliases are documentation, not brands: like the
 * v0.4 `Id`, they are plain strings so data stays open and inspectable.
 */
export type OrganizationId = string;
export type ActorId = string;
export type OperationId = string;
export type SiteId = string;
export type TeamId = string;

/** An idempotency key is derived from the caller's intent. Retrying a
 * command with the same key claims the original result rather than applying
 * twice; authority checks the payload matches the claim. */
export type IdempotencyKey = string;

/** An opaque refresh handle, hashed at rest by the issuer. Only authority
 * ever resolves one. */
export type RefreshHandle = string;

// --- versions -----------------------------------------------------------------

/** The authority interface version. Every runtime call and every envelope
 * carries it; a mismatch is the `wrong-interface-version` failure, never a
 * silent reinterpretation. */
export const AUTHORITY_INTERFACE_VERSION = 1 as const;
export type AuthorityInterfaceVersion = typeof AUTHORITY_INTERFACE_VERSION;

/** The envelope format version, independent of the interface version: the
 * envelope outlives the call signatures that produced it. */
export const ACCESS_ENVELOPE_VERSION = 1 as const;
export const ACCESS_ENVELOPE_FORMAT = "org-hats.access" as const;

// --- the closed failure taxonomy -------------------------------------------------
//
// One closed list covers the session and command surfaces. New failure kinds
// are interface-version changes; nothing may grow this list silently. The
// deploying host owns the product response to every kind — org-hats names
// the failure, never the page.
//
//   unavailable            the runtime could not be reached or is degraded
//   unauthenticated        the caller presented no usable authority
//   not-admitted           the actor is known but not admitted here
//   expired                an envelope or refresh handle passed its lifetime
//   wrong-interface-version  the caller's declared version is unsupported
//   wrong-binding          right proof, wrong operation or site
//   invalid-signature      envelope verification failed
//   invalid-command        the command failed validation before any commit
//   denied                 a valid command the policy refuses; `detail`
//                          carries the denial reason (core vocabulary)

export type FailureKind =
  | "unavailable"
  | "unauthenticated"
  | "not-admitted"
  | "expired"
  | "wrong-interface-version"
  | "wrong-binding"
  | "invalid-signature"
  | "invalid-command"
  | "denied";

export interface Failure {
  readonly kind: FailureKind;
  /** One sentence a host can show or log; for `denied`, the denial reason in
   * the core's vocabulary. */
  readonly detail?: string;
}

/** A session-surface failure, as a value — never an exception. Same closed
 * taxonomy as commands; the host owns the product response. */
export interface Failed {
  readonly failure: Failure;
}

// --- the access envelope ---------------------------------------------------------

/** A site the envelope admits, by permanent id and the aliases the operation
 * authority has made current. Aliases are routing decoration; ids resolve. */
export interface SiteBinding {
  readonly siteId: SiteId;
  readonly aliases: readonly string[];
}

/**
 * The v1 claims — the compact facts a host needs for local decisions and
 * nothing else (docs/envelope.md is the format contract):
 *
 * - `readableOrganizationIds` / `readableTeamIds` are precomputed by the
 *   issuer under the active policy bundle; a verifier never rebuilds reach;
 * - `hat` is the selected, worn hat: its role's actions and where it reaches;
 * - `memberTeamIds` supports site-local views without a grant query.
 */
export interface AccessEnvelopeClaimsV1 {
  readonly v: typeof ACCESS_ENVELOPE_VERSION;
  readonly interfaceVersion: AuthorityInterfaceVersion;
  readonly operationId: OperationId;
  readonly actor: {
    readonly organizationId: OrganizationId;
    readonly actorId: ActorId;
  };
  readonly hat: {
    readonly role: string;
    readonly actions: readonly string[];
    readonly teamIds: readonly TeamId[];
    readonly siteIds: readonly SiteId[];
  };
  readonly memberTeamIds: readonly TeamId[];
  readonly sites: readonly SiteBinding[];
  readonly readableOrganizationIds: readonly OrganizationId[];
  readonly readableTeamIds: readonly TeamId[];
  readonly configurableSiteIds: readonly SiteId[];
  /** Epoch seconds. `exp` bounds the revocation window. */
  readonly iat: number;
  readonly exp: number;
}

/** The signed envelope as it travels: opaque to product code, verified by the
 * access module. The signature is unpadded base64url Ed25519 over the UTF-8
 * bytes of `canonicalJson(claims)`, with `keyId` naming the signing key. */
export interface SignedAccessEnvelope {
  readonly format: typeof ACCESS_ENVELOPE_FORMAT;
  readonly v: typeof ACCESS_ENVELOPE_VERSION;
  readonly keyId: string;
  readonly claims: AccessEnvelopeClaimsV1;
  readonly signature: string;
}

/** What happened to the refresh handle alongside a new envelope. A host never
 * infers session state; the issuer states it. */
export type RefreshHandleOutcome =
  | { readonly kind: "kept" }
  | { readonly kind: "rotated"; readonly handle: RefreshHandle }
  | { readonly kind: "revoked" };

// --- canonical JSON -----------------------------------------------------------
//
// The encoding half of the envelope contract: object keys sorted, no
// whitespace, arrays in order, numbers and strings as JSON renders them.
// Both issuer and verifier use this function; a host that reimplements it
// gets it wrong the day the format changes.

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const isRecord = (value: JsonValue): value is { readonly [key: string]: JsonValue } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const canonicalJson = (value: JsonValue): string => {
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    const body = keys
      .map((key) => {
        // the key comes from the object itself, so the lookup cannot miss
        const inner: JsonValue = value[key] ?? null;
        return `${JSON.stringify(key)}:${canonicalJson(inner)}`;
      })
      .join(",");
    return `{${body}}`;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return JSON.stringify(value);
};

// --- byte codecs ------------------------------------------------------------------
//
// The signed bytes must be exact, so UTF-8 and base64 are owned, not
// borrowed from a platform: both issuer and verifier encode through these,
// and a host never reimplements them.

export const utf8 = (text: string): Uint8Array => {
  const bytes: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(bytes);
};

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export const base64Encode = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = i + 1 < bytes.length ? (bytes[i + 1] ?? 0) : 0;
    const b2 = i + 2 < bytes.length ? (bytes[i + 2] ?? 0) : 0;
    out += BASE64[b0 >> 2];
    out += BASE64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? BASE64[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? BASE64[b2 & 63] : "=";
  }
  return out;
};

export const base64Decode = (text: string): Uint8Array => {
  const clean = text.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = BASE64.indexOf(char);
    if (value < 0) throw new Error("invalid base64");
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  return Uint8Array.from(bytes);
};

/** Unpadded base64url (RFC 4648 §5), the signature and handle encoding —
 * safe in cookies and URLs without escaping. Public keys stay standard
 * base64 because they are configuration, not transport. */
export const base64UrlEncode = (bytes: Uint8Array): string =>
  base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const base64UrlDecode = (text: string): Uint8Array =>
  base64Decode(text.replace(/-/g, "+").replace(/_/g, "/"));
