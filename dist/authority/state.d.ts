import { type ActorId, type EpochSeconds, type IdempotencyKey, type OperationId, type OrganizationId, type SiteId, type TeamId } from "../contract.js";
import { type Grant, type Participation, type Snapshot } from "../model.js";
import type { PolicyBundle } from "../policy.js";
import type { AuthorityCommand, CommandResult } from "./types.js";
export interface AuditEvent {
    readonly at: EpochSeconds;
    readonly by: string;
    readonly fact: string;
}
export interface Claim {
    readonly payloadHash: string;
    readonly receiptApplied: boolean;
}
export interface OrgState {
    readonly organizationId: OrganizationId;
    readonly displayName?: string;
    actors: {
        organizationId: OrganizationId;
        actorId: ActorId;
        displayName?: string;
        disabled?: boolean;
    }[];
    /** Administrator standing, seeded at bootstrap and changed only by the
     * organization's own appoint/retire commands. */
    admins: ActorId[];
    /** Org-side invitations received from operations, by invitation id. */
    invitations: Map<string, {
        operationId: OperationId;
        status: "pending" | "accepted";
    }>;
    audit: AuditEvent[];
    claims: Map<IdempotencyKey, Claim>;
    activationRequests: ActivationRequest[];
}
export interface ActivationRequest {
    readonly requestId: string;
    readonly organizationId: OrganizationId;
    readonly actorId: ActorId;
    readonly secretHash: string;
    readonly issuedAt: EpochSeconds;
    readonly expiresAt: EpochSeconds;
    consumedAt?: EpochSeconds;
    revokedAt?: EpochSeconds;
}
export interface RefreshRecord {
    readonly handleHash: string;
    readonly operationId: OperationId;
    readonly organizationId: OrganizationId;
    readonly actorId: ActorId;
    /** The authentication facts of the issuing evidence; every refresh of
     * this handle chain re-issues them unchanged. */
    readonly amr?: readonly string[];
    readonly authTime?: number;
    revoked: boolean;
    superseded: boolean;
}
export interface OpState {
    readonly operationId: OperationId;
    readonly displayName?: string;
    readonly slug?: string;
    readonly bounded?: boolean;
    policy: PolicyBundle;
    sites: {
        siteId: SiteId;
        operationId: OperationId;
        displayName?: string;
        path?: string;
        aliases: readonly string[];
    }[];
    teams: {
        teamId: TeamId;
        siteId: SiteId;
        organizationId: OrganizationId;
        displayName?: string;
    }[];
    grants: Grant[];
    participations: Participation[];
    /** Op-side invitation records, by invitation id. */
    invitations: Map<string, {
        organizationId: OrganizationId;
        status: "invited" | "accepted";
    }>;
    refreshRecords: RefreshRecord[];
    accessRequests: {
        requestId: string;
        organizationId: OrganizationId;
        actorId: ActorId;
        note?: string;
    }[];
    audit: AuditEvent[];
    claims: Map<IdempotencyKey, Claim>;
}
export interface OutboxMessage {
    readonly id: string;
    readonly target: string;
    readonly kind: "invitation" | "acceptance" | "actor-disabled" | "actor-unlinked";
    readonly invitationId?: string;
    readonly operationId?: OperationId;
    readonly organizationId?: OrganizationId;
    readonly actorId?: ActorId;
}
/** A resolved caller, after evidence or envelope verification. */
export interface Principal {
    readonly organizationId: OrganizationId;
    readonly actorId: ActorId;
    readonly adminOfOperation: boolean;
    readonly adminOfOrganization: boolean;
}
/** The shape both coordinators' command surfaces expose. The engine gates a
 * call (version, delivery, principal resolution) before handing it to the
 * coordinator that owns the act; the coordinator owns authorization,
 * idempotency, and the mutation. One shape means a handler can move between
 * coordinators without changing the dispatch. */
export type CommandHandler = (input: AuthorityCommand, principal: Principal) => CommandResult;
export interface PrincipalLink {
    readonly organizationId: OrganizationId;
    readonly actorId: ActorId;
}
/** The principal-link key: the (provider, subject) pair encoded as JSON, so
 * no split of the two strings can collide with another — ":" concatenation
 * made `"a:b"/"c"` and `"a"/"b:c"` the same link. */
export declare const principalKey: (provider: string, subject: string) => string;
/** Assemble one operation's view. Every list is copied: the snapshot is a
 * caller's to hold and mutate, and a shared array would make engine state
 * the caller's to corrupt. `readonly` on the type says the same thing; this
 * is the runtime half. */
export declare const snapshotOf: (ops: ReadonlyMap<OperationId, OpState>, orgs: ReadonlyMap<OrganizationId, OrgState>, operationId: OperationId) => Snapshot | undefined;
export declare const payloadHash: (command: AuthorityCommand) => string;
/** A retry claims its earlier result; the same key with a different payload
 * is a misuse, not a retry. Checking is pure — the claim is committed with
 * the mutation it guards, so a denied command never poisons its key. */
export declare const checkClaim: (claims: Map<IdempotencyKey, Claim>, command: AuthorityCommand) => CommandResult | undefined;
export declare const commitClaim: (claims: Map<IdempotencyKey, Claim>, command: AuthorityCommand) => void;
/** Revoke one organization's participation through the state machine.
 *
 * Revoking twice is a safe retry rather than a failure: the state the caller
 * asked for is the state that holds, and a retry under a fresh idempotency
 * key must not read as an error. "Not participating" is a different thing
 * and stays a denial. Whether a repeat is idempotent is the adapter's
 * policy; that `revoked` never moves back is the model's, and
 * `applyParticipationEvent` is what enforces it. */
export declare const revokeParticipation: (op: OpState, organizationId: OrganizationId, by: "operation" | "organization") => {
    ok: true;
} | {
    ok: false;
    problem: string;
};
export declare const revokeRefreshRecords: (op: OpState, organizationId: OrganizationId, actorId: ActorId) => void;
