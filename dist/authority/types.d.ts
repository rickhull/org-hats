import type { Failed, ActorId, GrantTarget, Unbranded, AuthorityInterfaceVersion, Failure, IdempotencyKey, OperationId, OrganizationId, RefreshHandle, RefreshHandleOutcome, SignedAccessEnvelope, SiteBinding, TeamId } from "../contract.js";
export { AUTHORITY_INTERFACE_VERSION } from "../contract.js";
/** Typed, verified principal evidence — what an identity adapter (or a host
 * that verified evidence itself) supplies to authority. Authority resolves
 * the durable `(organizationId, actorId)` link behind it; evidence is never
 * a roster and no provider claim links two actors. Authentication remains
 * distinct from authority: this value never carries a hat, and resolving it
 * admits nobody. */
export interface PrincipalEvidence {
    /** The provider or adapter that vouched for the subject, e.g. an IdP id. */
    readonly provider: string;
    /** The subject unique at that provider. */
    readonly subject: string;
    /** Presentation only; authority never uses it to identify or link an
     * actor. */
    readonly displayName?: string;
    /** Authentication method references (RFC 8176) as the adapter verified
     * them — opaque values in the host's or IdP's vocabulary. Authority
     * copies them into the envelope claims and context and never interprets
     * them; step-up policy stays with the host. */
    readonly amr?: readonly string[];
    /** Epoch seconds of the authentication event the `amr` describes.
     * Distinct from envelope `iat`: refresh moves `iat` and preserves this. */
    readonly authTime?: number;
}
/** Every call carries the interface version it speaks. */
interface Versioned {
    readonly interfaceVersion: AuthorityInterfaceVersion;
}
/** Resolve evidence at an operation and issue access when the organization
 * actor is admitted and active. Issuance — not authentication — computes
 * reach under the active policy bundle and signs the envelope. */
export interface AccessFromEvidenceInput extends Versioned {
    readonly operationId: Unbranded<OperationId>;
    readonly evidence: PrincipalEvidence;
}
/** A new envelope plus the explicit refresh-handle outcome, together. */
export interface AccessIssue {
    readonly envelope: SignedAccessEnvelope;
    readonly refresh: RefreshHandleOutcome;
}
export interface RefreshInput extends Versioned {
    readonly operationId: Unbranded<OperationId>;
    readonly handle: RefreshHandle;
}
/** Presentation context for the signed-in actor, proven by a valid envelope.
 * Display names are presentation, not identity; ids resolve. */
export interface ContextRequest extends Versioned {
    readonly envelope: SignedAccessEnvelope;
}
export interface HatSummary {
    readonly role: string;
    readonly actions: readonly string[];
    /** Where the hat reaches: exactly one team or one site. */
    readonly target: Unbranded<GrantTarget>;
    readonly primary: boolean;
}
export interface AuthorityContext {
    readonly actor: {
        readonly organizationId: Unbranded<OrganizationId>;
        readonly actorId: Unbranded<ActorId>;
        readonly displayName?: string;
    };
    readonly organizationDisplayName?: string;
    readonly operationId: Unbranded<OperationId>;
    readonly operationDisplayName?: string;
    readonly participation: "invited" | "accepted" | "active" | "revoked";
    readonly wearableHats: readonly HatSummary[];
    readonly selectedHat?: HatSummary;
    readonly sites: readonly SiteBinding[];
    /** How the session's principal authenticated, as the issuing evidence
     * stated: the same opaque `amr` values and authentication timestamp the
     * envelope claims carry, absent when that evidence carried none. */
    readonly amr?: readonly string[];
    readonly authTime?: number;
}
export type CommandAuthorization = {
    readonly kind: "access-envelope";
    readonly envelope: SignedAccessEnvelope;
} | {
    readonly kind: "fresh-evidence";
    readonly evidence: PrincipalEvidence;
    readonly operationId: Unbranded<OperationId>;
};
interface CommandShell extends Versioned {
    readonly idempotencyKey: IdempotencyKey;
    readonly authorization: CommandAuthorization;
}
export type ParticipationCommand = {
    readonly kind: "participation-invite";
    readonly operationId: Unbranded<OperationId>;
    readonly organizationId: Unbranded<OrganizationId>;
}
/** The organization accepts its pending invitation for this operation. */
 | {
    readonly kind: "participation-accept";
    readonly operationId: Unbranded<OperationId>;
} | {
    readonly kind: "participation-revoke";
    readonly operationId: Unbranded<OperationId>;
    readonly organizationId: Unbranded<OrganizationId>;
    readonly by: "operation" | "organization";
};
export type AdmissionCommand = {
    readonly kind: "request-access";
    readonly operationId: Unbranded<OperationId>;
    readonly evidence: PrincipalEvidence;
    readonly note?: string;
} | {
    readonly kind: "admit";
    readonly operationId: Unbranded<OperationId>;
    readonly organizationId: Unbranded<OrganizationId>;
    readonly actorId: Unbranded<ActorId>;
    readonly teamId?: Unbranded<TeamId>;
};
export type GrantCommand = {
    readonly kind: "grant-hat";
    readonly operationId: Unbranded<OperationId>;
    readonly organizationId: Unbranded<OrganizationId>;
    readonly actorId: Unbranded<ActorId>;
    readonly role: string;
    /** Exactly one team or one site — the type says so, so "neither" and
     * "both" are unrepresentable rather than runtime-checked twice. */
    readonly target: Unbranded<GrantTarget>;
    readonly primary?: boolean;
} | {
    readonly kind: "revoke-grant";
    readonly operationId: Unbranded<OperationId>;
    readonly grantId: string;
} | {
    readonly kind: "select-hat";
    readonly operationId: Unbranded<OperationId>;
    readonly grantId: string;
};
export type OrganizationCommand = {
    readonly kind: "disable-actor";
    readonly organizationId: Unbranded<OrganizationId>;
    readonly actorId: Unbranded<ActorId>;
};
export type AuthorityCommandBody = ParticipationCommand | AdmissionCommand | GrantCommand | OrganizationCommand;
/** A complete business act, validated as a whole before any adapter commits
 * it. */
export type AuthorityCommand = CommandShell & AuthorityCommandBody;
export interface CommandReceipt {
    readonly idempotencyKey: IdempotencyKey;
    /** `false` means the idempotency key claimed an earlier result: the
     * command was a safe retry, not a second application. */
    readonly applied: boolean;
}
export type { Failed } from "../contract.js";
export type CommandResult = {
    readonly ok: true;
    readonly receipt: CommandReceipt;
} | {
    readonly ok: false;
    readonly failure: Failure;
};
/**
 * The external seam. Application callers receive use cases, not a grant
 * repository; implementors receive the same four methods whether they are
 * the in-memory adapter or the Cloudflare reference runtime.
 */
export interface AuthorityRuntime {
    /** Verified evidence → organization actor, participation, wearable hats,
     * and a signed access envelope. */
    accessFromEvidence(input: AccessFromEvidenceInput): Promise<AccessIssue | Failed>;
    /** A new envelope plus the explicit handle outcome: kept, rotated,
     * revoked. Grant changes revoke affected refresh records in the same
     * commit. */
    refresh(input: RefreshInput): Promise<AccessIssue | Failed>;
    /** Presentation context for the envelope's actor. */
    context(input: ContextRequest): Promise<AuthorityContext | Failed>;
    /** A typed, idempotent authority command. */
    command(input: AuthorityCommand): Promise<CommandResult>;
}
