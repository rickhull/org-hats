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
/** The authority interface version. Every runtime call and every envelope
 * carries it; a mismatch is the `wrong-interface-version` failure, never a
 * silent reinterpretation. */
export declare const AUTHORITY_INTERFACE_VERSION: 1;
export type AuthorityInterfaceVersion = typeof AUTHORITY_INTERFACE_VERSION;
/** The envelope format version, independent of the interface version: the
 * envelope outlives the call signatures that produced it. */
export declare const ACCESS_ENVELOPE_VERSION: 1;
export declare const ACCESS_ENVELOPE_FORMAT: "org-hats.access";
export type FailureKind = "unavailable" | "unauthenticated" | "not-admitted" | "expired" | "wrong-interface-version" | "wrong-binding" | "invalid-signature" | "invalid-command" | "denied";
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
    /** Authentication method references (RFC 8176), opaque host/IdP
     * vocabulary copied from the principal evidence at issuance and preserved
     * through refresh. Authority never interprets the values; absent means
     * the issuing evidence carried none. */
    readonly amr?: readonly string[];
    /** Epoch seconds of the authentication event the `amr` describes — the
     * OIDC `auth_time` claim name, carried verbatim. Preserved through
     * refresh, unlike `iat`, which describes this envelope; absent means the
     * issuing evidence carried none. */
    readonly auth_time?: number;
}
/** The public half of a signing key, as an operator distributes it. The
 * private key never leaves the issuer. */
export interface VerificationKeyMaterial {
    readonly keyId: string;
    readonly algorithm: string;
    /** Standard base64 raw public bytes. */
    readonly publicKey: string;
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
export type RefreshHandleOutcome = {
    readonly kind: "kept";
} | {
    readonly kind: "rotated";
    readonly handle: RefreshHandle;
} | {
    readonly kind: "revoked";
};
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | {
    readonly [key: string]: JsonValue;
};
export declare const canonicalJson: (value: JsonValue) => string;
export declare const utf8: (text: string) => Uint8Array;
export declare const base64Encode: (bytes: Uint8Array) => string;
export declare const base64Decode: (text: string) => Uint8Array;
/** Unpadded base64url (RFC 4648 §5), the signature and handle encoding —
 * safe in cookies and URLs without escaping. Public keys stay standard
 * base64 because they are configuration, not transport. */
export declare const base64UrlEncode: (bytes: Uint8Array) => string;
export declare const base64UrlDecode: (text: string) => Uint8Array;
