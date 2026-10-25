/**
 * v1 ids are caller-supplied and opaque — collision-resistant UUIDs in real
 * deployments. At runtime each is a plain string, so data stays open and
 * inspectable: the brand below is a compile-time phantom, erased entirely by
 * the compiler. `JSON.stringify` and `JSON.parse` see no difference, the
 * wire format is unchanged, and a stored id is still just text.
 *
 * What the brand buys is that a function expecting one of these cannot
 * silently accept another. The model's hot functions take three to five ids
 * positionally — `wearableGrants(snapshot, organizationId, actorId,
 * operationId)` — and with five aliases for `string` an argument-order slip
 * compiled clean.
 *
 * The consumer-facing surface keeps plain `string` id fields, spelled
 * `Unbranded<OrganizationId>` and so on so the kind stays readable: commands,
 * evidence, envelope claims, neutral access, and target references. A host
 * passes ids it read from its own records and must not need a constructor to
 * do it, and the wire format must not move. Each runtime converts at its own
 * command-handler seam, and `Unbranded` is also how data decoded from
 * storage or a fixture enters the domain.
 */
declare const brand: unique symbol;
type Branded<B extends string> = string & {
    readonly [brand]: B;
};
export type OrganizationId = Branded<"OrganizationId">;
export type ActorId = Branded<"ActorId">;
export type OperationId = Branded<"OperationId">;
export type SiteId = Branded<"SiteId">;
export type TeamId = Branded<"TeamId">;
/**
 * The same shape with plain-string ids: what hand-written data looks like
 * before it enters the domain. Derived from the branded types by a mapped
 * type, so it cannot drift from them the way a second hand-written shape
 * would.
 *
 * This is for data at a boundary — fixture snapshots, decoded storage rows,
 * a parsed request body — where writing a constructor call around every
 * literal would bury the structure the data exists to show. Coherence of
 * such data (does this organization id name a real organization?) is what
 * `invariantProblems` checks; the brand's job is the function boundaries,
 * where an argument-order slip would otherwise compile.
 */
export type Unbranded<T> = T extends Branded<string> ? string : T extends readonly (infer E)[] ? readonly Unbranded<E>[] : T extends object ? {
    readonly [K in keyof T]: Unbranded<T[K]>;
} : T;
/** The only way to make a branded id: a named, deliberate conversion at the
 * boundary where an opaque caller-supplied string becomes a domain id. */
export declare const organizationId: (raw: string) => OrganizationId;
export declare const actorId: (raw: string) => ActorId;
export declare const operationId: (raw: string) => OperationId;
export declare const siteId: (raw: string) => SiteId;
export declare const teamId: (raw: string) => TeamId;
/** What a grant reaches: one team, or a site and every team at it.
 *
 * Declared here beside `TargetRef` because it is target vocabulary both the
 * model and the command surface need. Exactly one of the two kinds, which is
 * the point: the pair of independent optionals it replaces could express
 * neither-or-both, so both runtimes carried matching runtime checks for a
 * state the type should have ruled out. */
export type GrantTarget = {
    readonly kind: "team";
    readonly teamId: TeamId;
} | {
    readonly kind: "site";
    readonly siteId: SiteId;
};
/** Where an act lands. `operation` is the whole undertaking; `site` and
 * `team` narrow it. Hosts map their own records onto these — a report's
 * team, a page's site — and never widen a target the envelope did not name.
 *
 * Declared here because both portable modules need it and neither imports
 * the other: the model reaches a target through a grant, the access module
 * checks one against precomputed reach. It was written out twice,
 * identically, with nothing keeping the two in step if one gained a
 * variant. */
export type TargetRef = {
    readonly kind: "operation";
} | {
    readonly kind: "site";
    readonly siteId: Unbranded<SiteId>;
} | {
    readonly kind: "team";
    readonly teamId: Unbranded<TeamId>;
};
/** An idempotency key is derived from the caller's intent. Retrying a
 * command with the same key claims the original result rather than applying
 * twice; authority checks the payload matches the claim. */
export type IdempotencyKey = string;
/** An opaque refresh handle, hashed at rest by the issuer. Only authority
 * ever resolves one. */
export type RefreshHandle = string;
export type AssertPlainId<T extends true> = T;
/** The authority interface version. Every runtime call carries it, and a
 * mismatch is the `wrong-interface-version` failure, never a silent
 * reinterpretation. An envelope records it as provenance — which interface
 * issued the claims — but `verify` never gates reading on it: the envelope
 * outlives the call signatures that produced it, so a command-surface break
 * must not strand live sessions. The envelope's own version pair is what
 * gates. */
export declare const AUTHORITY_INTERFACE_VERSION: 2;
export type AuthorityInterfaceVersion = typeof AUTHORITY_INTERFACE_VERSION;
/** The envelope and claims format version. This, with the format marker and
 * the envelope's own `v`, is what `verify` gates reading on. It moves only
 * when the meaning of the claims changes, never for a command-surface
 * change. */
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
    readonly siteId: Unbranded<SiteId>;
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
    readonly operationId: Unbranded<OperationId>;
    readonly actor: {
        readonly organizationId: Unbranded<OrganizationId>;
        readonly actorId: Unbranded<ActorId>;
    };
    readonly hat: {
        readonly role: string;
        readonly actions: readonly string[];
        readonly teamIds: readonly Unbranded<TeamId>[];
        readonly siteIds: readonly Unbranded<SiteId>[];
    };
    readonly memberTeamIds: readonly Unbranded<TeamId>[];
    readonly sites: readonly SiteBinding[];
    readonly readableOrganizationIds: readonly Unbranded<OrganizationId>[];
    readonly readableTeamIds: readonly Unbranded<TeamId>[];
    readonly configurableSiteIds: readonly Unbranded<SiteId>[];
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
export {};
