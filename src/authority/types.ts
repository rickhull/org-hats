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
}

/** Every call carries the interface version it speaks. */
interface Versioned {
  readonly interfaceVersion: AuthorityInterfaceVersion;
}

/** Resolve evidence at an operation and issue access when the organization
 * actor is admitted and active. Issuance — not authentication — computes
 * reach under the active policy bundle and signs the envelope. */
export interface AccessFromEvidenceInput extends Versioned {
  readonly operationId: OperationId;
  readonly evidence: PrincipalEvidence;
}

/** A new envelope plus the explicit refresh-handle outcome, together. */
export interface AccessIssue {
  readonly envelope: SignedAccessEnvelope;
  readonly refresh: RefreshHandleOutcome;
}

export interface RefreshInput extends Versioned {
  readonly operationId: OperationId;
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
  readonly teamId?: TeamId;
  readonly siteId?: SiteId;
  readonly primary: boolean;
}

export interface AuthorityContext {
  readonly actor: {
    readonly organizationId: OrganizationId;
    readonly actorId: ActorId;
    readonly displayName?: string;
  };
  readonly organizationDisplayName?: string;
  readonly operationId: OperationId;
  readonly operationDisplayName?: string;
  readonly participation: "invited" | "accepted" | "active" | "revoked";
  readonly wearableHats: readonly HatSummary[];
  readonly selectedHat?: HatSummary;
  readonly sites: readonly SiteBinding[];
}

// --- commands -----------------------------------------------------------------
//
// Typed discriminated unions; each body carries what the act needs, the
// shared envelope carries who authorizes it and the idempotency claim.

export type CommandAuthorization =
  | { readonly kind: "access-envelope"; readonly envelope: SignedAccessEnvelope }
  | {
      readonly kind: "fresh-evidence";
      readonly evidence: PrincipalEvidence;
      readonly operationId: OperationId;
    };

interface CommandShell extends Versioned {
  readonly idempotencyKey: IdempotencyKey;
  readonly authorization: CommandAuthorization;
}

export type ParticipationCommand =
  | { readonly kind: "participation-invite"; readonly operationId: OperationId; readonly organizationId: OrganizationId }
  /** The organization accepts its pending invitation for this operation. */
  | { readonly kind: "participation-accept"; readonly operationId: OperationId }
  | { readonly kind: "participation-revoke"; readonly operationId: OperationId; readonly organizationId: OrganizationId; readonly by: "operation" | "organization" };

export type AdmissionCommand =
  | { readonly kind: "request-access"; readonly operationId: OperationId; readonly evidence: PrincipalEvidence; readonly note?: string }
  | { readonly kind: "admit"; readonly operationId: OperationId; readonly organizationId: OrganizationId; readonly actorId: ActorId; readonly teamId?: TeamId };

export type GrantCommand =
  | {
      readonly kind: "grant-hat";
      readonly operationId: OperationId;
      readonly organizationId: OrganizationId;
      readonly actorId: ActorId;
      readonly role: string;
      readonly teamId?: TeamId;
      readonly siteId?: SiteId;
      readonly primary?: boolean;
    }
  | { readonly kind: "revoke-grant"; readonly operationId: OperationId; readonly grantId: string }
  | { readonly kind: "select-hat"; readonly operationId: OperationId; readonly grantId: string };

export type OrganizationCommand =
  | { readonly kind: "disable-actor"; readonly organizationId: OrganizationId; readonly actorId: ActorId };

export type AuthorityCommandBody =
  | ParticipationCommand
  | AdmissionCommand
  | GrantCommand
  | OrganizationCommand;

/** A complete business act, validated as a whole before any adapter commits
 * it. */
export type AuthorityCommand = CommandShell & AuthorityCommandBody;

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
}
