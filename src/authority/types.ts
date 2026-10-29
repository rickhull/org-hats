// The normative authority interface — the types every implementation (the
// in-memory adapter shipped beside this module, the Cloudflare reference
// runtime) and every consumer codes against. docs/authority_redesign.md
// § Authority is the charter; this file is the normative specification.
// Shapes are settled here, reviewed with the consumer, and hardened behind
// the interface; changes after the review gate are additive-only or
// re-reviewed.

import type {
  Failed,
  AccessEnvelopeClaimsV1,
  ActorId,
  GrantTarget,
  Unbranded,
  AuthorityInterfaceVersion,
  Failure,
  IdempotencyKey,
  OperationId,
  OrganizationId,
  RefreshHandle,
  RefreshHandleOutcome,
  SignedAccessEnvelope,
  SiteBinding,
  SiteId,
  TeamId,
} from "../contract.ts";

export { AUTHORITY_INTERFACE_VERSION } from "../contract.ts";

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

export interface HatSummary {
  readonly role: string;
  readonly actions: readonly string[];
  /** Where the hat reaches: exactly one team or one site. */
  readonly target: Unbranded<GrantTarget>;
  readonly primary: boolean;
  /** The grant's id: the addressing `select-hat` takes, so a host can
   * offer the switch the summary shows. */
  readonly grantId: string;
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

// The ids across this interface are plain strings — `Unbranded<ActorId>` and
// so on, which resolves to `string` while keeping the kind readable. A host
// passes ids it read from its own records and must not need to import a
// constructor to do it; each runtime converts at its own command-handler
// seam (docs/authority_redesign.md, src/contract.ts).

// --- commands -----------------------------------------------------------------
//
// Typed discriminated unions; each body carries what the act needs, the
// shared envelope carries who authorizes it and the idempotency claim.

export type CommandAuthorization =
  | { readonly kind: "access-envelope"; readonly envelope: SignedAccessEnvelope }
  | {
      readonly kind: "fresh-evidence";
      readonly evidence: PrincipalEvidence;
      readonly operationId: Unbranded<OperationId>;
    };

interface CommandShell extends Versioned {
  readonly idempotencyKey: IdempotencyKey;
  readonly authorization: CommandAuthorization;
}

export type ParticipationCommand =
  | { readonly kind: "participation-invite"; readonly operationId: Unbranded<OperationId>; readonly organizationId: Unbranded<OrganizationId> }
  /** The organization accepts its pending invitation for this operation. */
  | { readonly kind: "participation-accept"; readonly operationId: Unbranded<OperationId> }
  | { readonly kind: "participation-revoke"; readonly operationId: Unbranded<OperationId>; readonly organizationId: Unbranded<OrganizationId>; readonly by: "operation" | "organization" };

/** `admit` keeps an ignored `teamId` field from the pre-team shape: neither
 * runtime reads it, and team placement is the grant target plus
 * `request-team`/`admit-team`. Deprecated: remove it at the next interface
 * bump or with the consumer's explicit review. */
export type AdmissionCommand =
  | { readonly kind: "request-access"; readonly operationId: Unbranded<OperationId>; readonly evidence: PrincipalEvidence; readonly note?: string }
  | { readonly kind: "admit"; readonly operationId: Unbranded<OperationId>; readonly organizationId: Unbranded<OrganizationId>; readonly actorId: Unbranded<ActorId>; readonly teamId?: Unbranded<TeamId> };

export type GrantCommand =
  | {
      readonly kind: "grant-hat";
      readonly operationId: Unbranded<OperationId>;
      readonly organizationId: Unbranded<OrganizationId>;
      readonly actorId: Unbranded<ActorId>;
      readonly role: string;
      /** Exactly one team or one site — the type says so, so "neither" and
       * "both" are unrepresentable rather than runtime-checked twice. */
      readonly target: Unbranded<GrantTarget>;
      readonly primary?: boolean;
    }
  | { readonly kind: "revoke-grant"; readonly operationId: Unbranded<OperationId>; readonly grantId: string }
  | { readonly kind: "select-hat"; readonly operationId: Unbranded<OperationId>; readonly grantId: string };

export type TeamCommand =
  | {
      readonly kind: "request-team";
      readonly operationId: Unbranded<OperationId>;
      readonly organizationId: Unbranded<OrganizationId>;
      readonly teamId: Unbranded<TeamId>;
      readonly siteId: Unbranded<SiteId>;
      readonly displayName?: string;
    }
  | { readonly kind: "admit-team"; readonly operationId: Unbranded<OperationId>; readonly teamId: Unbranded<TeamId> }
  | {
      readonly kind: "update-team";
      readonly operationId: Unbranded<OperationId>;
      readonly teamId: Unbranded<TeamId>;
      readonly displayName: string | null;
    }
  | { readonly kind: "retire-team"; readonly operationId: Unbranded<OperationId>; readonly teamId: Unbranded<TeamId> };

export type OrganizationCommand =
  | { readonly kind: "disable-actor"; readonly organizationId: Unbranded<OrganizationId>; readonly actorId: Unbranded<ActorId> }
  | { readonly kind: "unlink-principal"; readonly organizationId: Unbranded<OrganizationId>; readonly actorId: Unbranded<ActorId> }
  | { readonly kind: "revoke-activation"; readonly organizationId: Unbranded<OrganizationId>; readonly actorId: Unbranded<ActorId> }
  /** The id is caller-supplied, opaque, and scoped to this organization. */
  | { readonly kind: "create-actor"; readonly organizationId: Unbranded<OrganizationId>; readonly actorId: Unbranded<ActorId>; readonly displayName?: string }
  /** `null` clears the display name; the field is required so a retry cannot
   * change shape between absent and null. */
  | { readonly kind: "update-actor"; readonly organizationId: Unbranded<OrganizationId>; readonly actorId: Unbranded<ActorId>; readonly displayName: string | null }
  | { readonly kind: "appoint-administrator"; readonly organizationId: Unbranded<OrganizationId>; readonly actorId: Unbranded<ActorId> }
  | { readonly kind: "retire-administrator"; readonly organizationId: Unbranded<OrganizationId>; readonly actorId: Unbranded<ActorId> };

export type AuthorityCommandBody =
  | ParticipationCommand
  | AdmissionCommand
  | GrantCommand
  | TeamCommand
  | OrganizationCommand;

/** A complete business act, validated as a whole before any adapter commits
 * it. */
export type AuthorityCommand = CommandShell & AuthorityCommandBody;

// The same seam assertion as `contract.ts`: a host must be able to build a
// command from ids it read from its own records, with no constructor
// imported. These are erased at compile time.
type AcceptsPlainString<T> = string extends T ? true : false;
type Assert<T extends true> = T;

type _GrantCommandIdsArePlain = Assert<
  AcceptsPlainString<Extract<GrantCommand, { kind: "grant-hat" }>["organizationId"]>
>;
type _GrantCommandTargetIsPlain = Assert<
  AcceptsPlainString<
    Extract<Extract<GrantCommand, { kind: "grant-hat" }>["target"], { kind: "team" }>["teamId"]
  >
>;
type _ParticipationCommandIsPlain = Assert<
  AcceptsPlainString<Extract<ParticipationCommand, { kind: "participation-invite" }>["operationId"]>
>;
type _AdmitCommandIsPlain = Assert<
  AcceptsPlainString<Extract<AdmissionCommand, { kind: "admit" }>["actorId"]>
>;
type _HatSummaryTargetIsPlain = Assert<
  AcceptsPlainString<Extract<HatSummary["target"], { kind: "site" }>["siteId"]>
>;
type _ContextIsPlain = Assert<AcceptsPlainString<AuthorityContext["operationId"]>>;

// Only the claims' provenance field is widened (`IssuerInterfaceVersion` in
// src/contract.ts); every call still speaks the *current* interface literal.
// Exactness, not assignability — `number` would satisfy an assignability
// check and silently widen every call.
type IsExact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type _CallsSpeakTheCurrentInterface = Assert<
  IsExact<AccessFromEvidenceInput["interfaceVersion"], AuthorityInterfaceVersion>
>;
type _CommandsSpeakTheCurrentInterface = Assert<
  IsExact<AuthorityCommand["interfaceVersion"], AuthorityInterfaceVersion>
>;

export interface CommandReceipt {
  readonly idempotencyKey: IdempotencyKey;
  /** `false` means the idempotency key claimed an earlier result: the
   * command was a safe retry, not a second application. */
  readonly applied: boolean;
}

export type { Failed } from "../contract.ts";

export type CommandResult =
  | { readonly ok: true; readonly receipt: CommandReceipt }
  | { readonly ok: false; readonly failure: Failure };

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
  /** Administrator-authorized return-once activation issuance. */
  activationRequest(input: ActivationRequestInput): Promise<ActivationRequestResult | Failed>;
  /** Non-consuming, metadata-free bearer-secret inspection. */
  activationInspect(input: ActivationInspectInput): Promise<ActivationInspection | Failed>;
  /** Atomically bind verified evidence and consume its activation. */
  activationAccept(input: ActivationAcceptInput): Promise<ActivationAcceptance | Failed>;
}
