import { type HatClaim, type HeldHat, type Id, type Target } from "./core.ts";
import type { OrgHatsRepository } from "./port.ts";
/** How the worn hat was chosen — rule 5's signal. A claim that did not
 * resolve reports `default` / `primary` / `first`, so the drift is auditable
 * (OH-QM-04: a revoked claim falls back; it does not fail). */
export type HatSource = "claimed" | "default" | "primary" | "first";
/** Why `decide` refused. The host maps these to its own responses. */
export type DenyReason = 
/** The actor holds no grant in the operation. */
"unknown-actor"
/** No hat is wearable at this scope (in this organization, if given). */
 | "not-admitted"
/** The worn hat's role lacks the action. */
 | "no-capability"
/** The worn hat's grant does not reach the target. */
 | "out-of-reach";
/** Why `decideSpeak` refused. The author half is `not-affiliated`: no *held*
 * grant over the target carries AUTHOR (rule 3). */
export type SpeakDenyReason = "unknown-actor" | "not-admitted" | "out-of-reach" | "not-affiliated";
/** One request, one act. Everything here is the application's context; the
 * model supplies only the order it is consulted in. */
export interface DecideRequest {
    readonly actorId: Id;
    readonly operationId: Id;
    /** Where the request happens — a scope path, `/acme/north/`. */
    readonly scopePath: string;
    /** The action — the application's vocabulary (`resolve`, `read_reports`). */
    readonly action: string;
    /** The team the act concerns; absent, the target is the scope itself. */
    readonly teamId?: Id | null;
    /** The hat the session claims — a grant id, or a matcher (`HatClaim`): a
     * name-keyed claim passes `(hat) => hat.roleName === name` and never
     * translates ids. Re-validated here against the *wearable* set (rule 7). */
    readonly claimedHatId?: HatClaim | null;
    /** Optional organization context (C31): when present, only that
     * organization's hats are wearable. The organization is request context,
     * never session-global. */
    readonly organizationId?: Id | null;
}
/** What every decision carries, allowed or denied — the audit facts minus
 * time and names, which the host adds (an adapter fills `roleName` /
 * `teamName` / `scopeName`; a host may extend `HeldHat` further still). */
export interface DecisionCore {
    readonly target: Target;
    readonly action: string;
    /** How the worn hat was chosen; `null` when none was. */
    readonly fallback: HatSource | null;
    /** The claim as the audit row wants it: the id when the claim was an id;
     * for a matcher claim, the grant id it resolved to when it resolved, and
     * `null` when it fell back (the host records its own claim token
     * alongside). */
    readonly claimed: Id | null;
}
export interface DecisionAllow extends DecisionCore {
    readonly ok: true;
    readonly hat: HeldHat;
}
export interface DecisionDeny extends DecisionCore {
    readonly ok: false;
    readonly reason: DenyReason;
    /** The hat that was worn when the decision denied — for the audit row. */
    readonly hat: HeldHat | null;
}
export type Decision = DecisionAllow | DecisionDeny;
export interface SpeakAllow extends DecisionCore {
    readonly ok: true;
    readonly hat: HeldHat;
}
export interface SpeakDeny extends DecisionCore {
    readonly ok: false;
    readonly reason: SpeakDenyReason;
    readonly hat: HeldHat | null;
}
export type SpeakDecision = SpeakAllow | SpeakDeny;
/** May the actor, wearing the hat in force, do this action on this target?
 * `can` split into its reasons: the role's capability, then the grant's
 * reach. */
export declare function decide(repo: OrgHatsRepository, request: DecideRequest): Promise<Decision>;
/** May the actor *speak for* the target — file, author, commit? The two-edge
 * rule (OH-QM-07): the worn hat must reach the target, and some *held* grant
 * over it must carry AUTHOR. The worn hat need not itself author, so a lead
 * files on their own team without switching hats. */
export declare function decideSpeak(repo: OrgHatsRepository, request: DecideRequest): Promise<SpeakDecision>;
