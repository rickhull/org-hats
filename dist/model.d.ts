import type { ActorId, GrantTarget, OperationId, OrganizationId, SiteId, TargetRef, TeamId } from "./contract.js";
import type { PolicyBundle } from "./policy.js";
export interface Organization {
    readonly organizationId: OrganizationId;
    readonly displayName?: string;
}
/** An actor is a person known to one organization. The pair with
 * `organizationId` is the actor's stable identity across every operation
 * that organization joins; equal emails never merge two actors. */
export interface Actor {
    readonly organizationId: OrganizationId;
    readonly actorId: ActorId;
    readonly displayName?: string;
    /** A disabled actor holds no wearable hat and issues no new access; the
     * flag is organization-owned and binds every operation. */
    readonly disabled?: boolean;
}
export interface Operation {
    readonly operationId: OperationId;
    readonly displayName?: string;
    /** The one DNS label naming this operation's hostname. The registry
     * projects it; operation authority is the only writer. Optional only for
     * snapshots that predate routing facts; a snapshot with site paths must
     * carry it. */
    readonly slug?: string;
    /** `true` marks a time-boxed undertaking whose access closes on a
     * schedule rather than by revocation alone. */
    readonly bounded?: boolean;
}
/** A site is an independently administered place inside one operation; a
 * team always belongs to exactly one site, which is what makes site
 * independence structural. */
export interface Site {
    readonly siteId: SiteId;
    readonly operationId: OperationId;
    readonly displayName?: string;
    /** The canonical one-segment path beneath the operation's hostname. The
     * registry projects it; operation authority is the only writer. Optional
     * only for snapshots that predate routing facts. */
    readonly path?: string;
    /** Hostname labels that resolve to this site, alongside the operation's
     * slug. `www` is reserved for the apex. */
    readonly aliases: readonly string[];
}
export interface Team {
    readonly teamId: TeamId;
    readonly siteId: SiteId;
    readonly organizationId: OrganizationId;
    readonly displayName?: string;
}
export type { GrantTarget } from "./contract.js";
/** A hat is an operation-local grant: this organization's actor may act in
 * this role over this target. `primary` marks the actor's default hat at
 * the operation; one per actor per operation. */
export interface Grant {
    readonly grantId: string;
    readonly operationId: OperationId;
    readonly organizationId: OrganizationId;
    readonly actorId: ActorId;
    /** A role title from the operation's active policy bundle. */
    readonly role: string;
    readonly target: GrantTarget;
    readonly primary?: boolean;
    /** A revoked grant is retained for audit and never wearable; revocation
     * is immediate for new issuance. */
    readonly revoked?: boolean;
}
/** A grant that has survived the revocation filter: `revoked` is absent or
 * `false`, never `true`. `wearableGrants` returns these and the decision
 * path takes them, so the filter is in the signature rather than a
 * convention callers must know. `Snapshot.grants` keeps revoked records
 * for audit; only the decision path sees `ActiveGrant`. */
export type ActiveGrant = Grant & {
    readonly revoked?: false;
};
/** The named narrowing behind the revocation filter. This is the runtime
 * check the type records — the predicate is where the claim is made, and
 * `wearableGrants` routes every grant through it. */
export declare const isActiveGrant: (grant: Grant) => grant is ActiveGrant;
/** One organization's standing at one operation. `active` is canonical —
 * recorded by the operation, and the only state under which hats are
 * wearable. */
export interface Participation {
    readonly organizationId: OrganizationId;
    readonly operationId: OperationId;
    readonly status: "invited" | "accepted" | "active" | "revoked";
}
/** The whole organizational state one operation's authority owns, plus the
 * shared organization directory it references. */
export interface Snapshot {
    readonly organizations: readonly Organization[];
    readonly actors: readonly Actor[];
    readonly operations: readonly Operation[];
    readonly sites: readonly Site[];
    readonly teams: readonly Team[];
    readonly grants: readonly Grant[];
    readonly participations: readonly Participation[];
}
export type ParticipationEvent = {
    readonly kind: "invite";
    readonly by: "operation";
} | {
    readonly kind: "accept";
    readonly by: "organization";
} | {
    readonly kind: "activate";
    readonly by: "operation";
} | {
    readonly kind: "revoke";
    readonly by: "operation" | "organization";
};
export type ParticipationTransition = {
    readonly ok: true;
    readonly participation: Participation;
} | {
    readonly ok: false;
    readonly problem: string;
};
/** The visible, retryable workflow — never a distributed transaction. The
 * operation invites and activates (activation is canonical); the
 * organization accepts; either side may revoke, terminally. */
export declare const transitionParticipation: (organizationId: OrganizationId, operationId: OperationId, current: Participation | undefined, event: ParticipationEvent) => ParticipationTransition;
export type ParticipationOutcome = {
    readonly ok: true;
    readonly participations: readonly Participation[];
    readonly participation: Participation;
} | {
    readonly ok: false;
    readonly problem: string;
};
/** Apply an event to a participation list: find the current standing, decide
 * with `transitionParticipation`, and return the new list. This is the only
 * way a participation status should move — an adapter that writes the status
 * directly is an adapter that can flip `revoked` back to `active`, which the
 * state machine above refuses by construction.
 *
 * Seeding is not transitioning: bootstrap and restore install a declared
 * status and must not come through here. */
export declare const applyParticipationEvent: (participations: readonly Participation[], organizationId: OrganizationId, operationId: OperationId, event: ParticipationEvent) => ParticipationOutcome;
export type { TargetRef } from "./contract.js";
/** A grant reaches its own team; a site grant reaches the site and every
 * team at it. Nothing reaches a whole operation. */
export declare const grantReaches: (snapshot: Snapshot, grant: Grant, target: TargetRef) => boolean;
/** The grants an actor could wear at this operation right now: not revoked,
 * actor enabled, and the organization's participation active. The return
 * type says the revocation filter ran: every element is an `ActiveGrant`. */
export declare const wearableGrants: (snapshot: Snapshot, organizationId: OrganizationId, actorId: ActorId, operationId: OperationId) => readonly ActiveGrant[];
/** A grant resolved to what a decision carries: the role's actions under the
 * bundle and where the hat reaches. Historical acts keep this snapshot. */
export interface WornHat {
    readonly grantId: string;
    readonly role: string;
    readonly actions: readonly string[];
    readonly target: GrantTarget;
}
/** Worn-hat selection, operation-local: the primary when it is wearable at
 * the target, otherwise the deterministic first by (role, target id, grant
 * id). A revoked or disabled primary never blocks the fallback. */
export declare const selectWornHat: (snapshot: Snapshot, bundle: PolicyBundle, organizationId: OrganizationId, actorId: ActorId, operationId: OperationId, target: TargetRef) => WornHat | undefined;
export type DenialReason = 
/** the actor holds no wearable hat here: unknown, disabled, not
 * participating, or every grant revoked */
"not-admitted"
/** the worn hat reaches the target but its role does not carry the action */
 | "no-capability"
/** no grant reaches the target at all */
 | "out-of-reach"
/** the worn grant names a role the active bundle does not carry: the
 * snapshot and the policy disagree, which is an administrator's problem
 * and not a statement about this actor's authority */
 | "policy-inconsistent";
export type Decision = {
    readonly allowed: true;
    readonly hat: WornHat;
} | {
    readonly allowed: false;
    readonly reason: DenialReason;
};
/**
 * The rule, in the model's order: wear the hat first (primary or fallback),
 * then ask whether its role carries the action. The formula stays an
 * implementation rule — application callers ask the authority runtime or the
 * access module, not this function directly.
 */
export declare const decide: (snapshot: Snapshot, bundle: PolicyBundle, organizationId: OrganizationId, actorId: ActorId, operationId: OperationId, action: string, target: TargetRef) => Decision;
export interface ReadReach {
    readonly readableOrganizationIds: readonly OrganizationId[];
    /** Exceptional team grants only — reached teams whose organization is
     * outside the readable organization set. Empty for the shipped twins; a
     * crossed-organization grant target can make it non-empty under either
     * policy. */
    readonly readableTeamIds: readonly TeamId[];
}
/** What the issuer will place in an envelope, computed here so the verifier
 * never rebuilds it. Each read-policy axis contributes independently; v1 has
 * only the organization axis (`granted-teams`: the organizations of the
 * teams the actor's wearable grants reach; `all-participating`: every
 * organization actively participating). A future team-audience axis composes
 * here without changing what this axis means. */
export declare const readReach: (snapshot: Snapshot, bundle: PolicyBundle, organizationId: OrganizationId, actorId: ActorId, operationId: OperationId) => ReadReach;
export declare const isHostnameLabel: (value: string) => boolean;
/** A site path is one segment; it is a path, not a hostname, so `www` is not
 * reserved there. */
export declare const isSitePath: (value: string) => boolean;
/** One sentence per violation. An empty list is the only healthy snapshot. */
export declare const invariantProblems: (snapshot: Snapshot, bundle: PolicyBundle) => readonly string[];
