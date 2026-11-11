import type { Failed, ActorId, GrantTarget, Unbranded, AuthorityInterfaceVersion, Failure, IdempotencyKey, OperationId, OrganizationId, RefreshHandle, RefreshHandleOutcome, SignedAccessEnvelope, SiteBinding, SiteId, TeamId } from "../contract.js";
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
/** Mint a return-once activation secret for an existing, unlinked actor.
 * Retrying rotates the secret; this call intentionally has no idempotency
 * key because authority stores only its digest. */
export interface ActivationRequestInput extends Versioned {
    readonly organizationId: Unbranded<OrganizationId>;
    readonly actorId: Unbranded<ActorId>;
    readonly evidence: PrincipalEvidence;
}
export interface ActivationRequestResult {
    readonly requestId: string;
    readonly secret: string;
    readonly expiresAt: number;
}
export interface ActivationInspectInput extends Versioned {
    readonly secret: string;
}
/** Deliberately reveals no actor, organization, or expiry metadata. */
export interface ActivationInspection {
    readonly usable: true;
}
export interface ActivationAcceptInput extends Versioned {
    readonly secret: string;
    readonly evidence: PrincipalEvidence;
}
export interface ActivationAcceptance {
    readonly applied: boolean;
    readonly actor: {
        readonly organizationId: Unbranded<OrganizationId>;
        readonly actorId: Unbranded<ActorId>;
    };
}
/** Presentation context for the signed-in actor, proven by a valid envelope.
 * Display names are presentation, not identity; ids resolve. */
export interface ContextRequest extends Versioned {
    readonly envelope: SignedAccessEnvelope;
}
/** The organization roster for the envelope's actor, proven by a valid
 * envelope and gated on organization-administrator standing: the actors
 * the organization owns, organization-wide, and the teams it fields in
 * the envelope's operation. A read, not a mutation — no fresh evidence. */
export interface RosterRequest extends Versioned {
    readonly envelope: SignedAccessEnvelope;
}
/** One organization actor. `displayName` is presentation only, the same
 * rule `update-actor` writes; `disabled` is the offboarding state. */
export interface RosterActorEntry {
    readonly actorId: string;
    readonly displayName?: string;
    readonly disabled: boolean;
}
/** One team the organization fields in the envelope's operation, with its
 * lifecycle status: a pending team awaits admission, a retired one is
 * tombstoned, and only an active team carries grants. */
export interface RosterTeamEntry {
    readonly teamId: string;
    readonly longName?: string;
    readonly shortName?: string;
    readonly status: "pending" | "active" | "retired";
}
export interface RosterRead {
    readonly organizationId: string;
    readonly actors: readonly RosterActorEntry[];
    readonly teams: readonly RosterTeamEntry[];
}
export interface HatSummary {
    readonly role: string;
    readonly actions: readonly string[];
    /** Where the hat reaches: exactly one team or one site. */
    readonly target: Unbranded<GrantTarget>;
    readonly primary: boolean;
    /** The grant's id: the addressing `select-hat` takes, so a host can
     * offer the switch the summary shows. */
    readonly grantId: string;
    /** The target's display name when the operation set one; absent when it
     * did not, never a fallback to the id, so a host decides what to show.
     * A target is a team or a site, so this carries a team's `displayName` or
     * a site's `longName`: the name is the genus over both, not the long half
     * of a site's pair, which is why it did not become `targetLongName`. */
    readonly targetDisplayName?: string;
}
export interface AuthorityContext {
    readonly actor: {
        readonly organizationId: Unbranded<OrganizationId>;
        readonly actorId: Unbranded<ActorId>;
        readonly displayName?: string;
    };
    readonly organizationLongName?: string;
    readonly operationId: Unbranded<OperationId>;
    readonly operationLongName?: string;
    readonly participation: "invited" | "accepted" | "active" | "revoked";
    readonly wearableHats: readonly HatSummary[];
    readonly selectedHat?: HatSummary;
    readonly sites: readonly SiteBinding[];
    /** Organization-administrator standing, live at the organization: a
     * presentation fact so a host can hide its administration surface.
     * It authorizes nothing — commands check standing at the handler — and
     * the envelope carries no standing claim (docs/authority_redesign.md
     * § Access). */
    readonly administrator: boolean;
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
/** `admit` keeps an ignored `teamId` field from the pre-team shape: neither
 * runtime reads it, and team placement is the grant target plus
 * `request-team`/`admit-team`. Deprecated: remove it at the next interface
 * bump or with the consumer's explicit review. */
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
export type TeamCommand = {
    readonly kind: "request-team";
    readonly operationId: Unbranded<OperationId>;
    readonly organizationId: Unbranded<OrganizationId>;
    readonly teamId: Unbranded<TeamId>;
    readonly siteId: Unbranded<SiteId>;
    readonly longName?: string;
    readonly shortName?: string;
} | {
    readonly kind: "admit-team";
    readonly operationId: Unbranded<OperationId>;
    readonly teamId: Unbranded<TeamId>;
}
/** Both labels are required, and `null` clears one. The pair is written in
 * one act because the consumer's editing surface is a full-form page that
 * submits every field: absent-meaning-unchanged would buy a field-scoped
 * client nobody has, and the remedy for concurrent editing it would want
 * is optimistic concurrency, which no command shape provides. A caller
 * that omits a field it did not mean to touch clears it. */
 | {
    readonly kind: "update-team";
    readonly operationId: Unbranded<OperationId>;
    readonly teamId: Unbranded<TeamId>;
    readonly longName: string | null;
    readonly shortName: string | null;
} | {
    readonly kind: "retire-team";
    readonly operationId: Unbranded<OperationId>;
    readonly teamId: Unbranded<TeamId>;
};
export type OrganizationCommand = {
    readonly kind: "disable-actor";
    readonly organizationId: Unbranded<OrganizationId>;
    readonly actorId: Unbranded<ActorId>;
} | {
    readonly kind: "unlink-principal";
    readonly organizationId: Unbranded<OrganizationId>;
    readonly actorId: Unbranded<ActorId>;
} | {
    readonly kind: "revoke-activation";
    readonly organizationId: Unbranded<OrganizationId>;
    readonly actorId: Unbranded<ActorId>;
}
/** The id is caller-supplied, opaque, and scoped to this organization. */
 | {
    readonly kind: "create-actor";
    readonly organizationId: Unbranded<OrganizationId>;
    readonly actorId: Unbranded<ActorId>;
    readonly displayName?: string;
}
/** `null` clears the display name; the field is required so a retry cannot
 * change shape between absent and null. */
 | {
    readonly kind: "update-actor";
    readonly organizationId: Unbranded<OrganizationId>;
    readonly actorId: Unbranded<ActorId>;
    readonly displayName: string | null;
} | {
    readonly kind: "appoint-administrator";
    readonly organizationId: Unbranded<OrganizationId>;
    readonly actorId: Unbranded<ActorId>;
} | {
    readonly kind: "retire-administrator";
    readonly organizationId: Unbranded<OrganizationId>;
    readonly actorId: Unbranded<ActorId>;
};
export type AuthorityCommandBody = ParticipationCommand | AdmissionCommand | GrantCommand | TeamCommand | OrganizationCommand;
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
 * repository; implementors receive the same session, command, and activation
 * methods whether they are the in-memory adapter or the Cloudflare reference
 * runtime.
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
    /** The organization roster for the envelope's administrator: actors
     * organization-wide, teams in the envelope's operation. */
    roster(input: RosterRequest): Promise<RosterRead | Failed>;
    /** A typed, idempotent authority command. */
    command(input: AuthorityCommand): Promise<CommandResult>;
    /** Administrator-authorized return-once activation issuance. */
    activationRequest(input: ActivationRequestInput): Promise<ActivationRequestResult | Failed>;
    /** Non-consuming, metadata-free bearer-secret inspection. */
    activationInspect(input: ActivationInspectInput): Promise<ActivationInspection | Failed>;
    /** Atomically bind verified evidence and consume its activation. */
    activationAccept(input: ActivationAcceptInput): Promise<ActivationAcceptance | Failed>;
}
