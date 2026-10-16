import { type HatClaim, type HatSource, type HeldHat, type Id, type Target } from "./core.ts";
import type { OrgHatsRepository } from "./port.ts";
/** Why `decide` refused. The host maps these to its own responses. */
export type DenyReason = 
/** The actor holds no grant in the operation. */
"unknown-actor"
/** No hat is wearable at this scope (in this organization, if given). */
 | "not-admitted"
/** The worn hat's role lacks the action. */
 | "no-capability"
/** The worn hat's grant does not reach the target. */
 | "out-of-reach"
/** No *held* grant over the target carries `heldAction`. */
 | "no-held-action";
/** One request, one act. Everything here is the application's context; the
 * model supplies only the order it is consulted in. */
export interface DecideRequest {
    readonly actorId: Id;
    readonly operationId: Id;
    /** Where the request happens — a scope path, `/riverbend/bigpark/`. */
    readonly scopePath: string;
    /** The action the worn hat must carry — the application's vocabulary
     * (`resolve`, `read_log`). Absent when the act's only requirements are
     * presence and standing: the two-edge shape, where the worn hat need only
     * reach the target. */
    readonly action?: string | null;
    /** When set, additionally require a *held* grant over the target carrying
     * this action — the standing half of the two-edge rule, checked against
     * what the actor holds, not what is worn. What the action *means*
     * (membership, filing, representation) is the application's policy. */
    readonly heldAction?: string | null;
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
    /** The capacity action as received, or `null` in the two-edge shape. */
    readonly action: string | null;
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
/** May the actor, wearing the hat in force, do this act on this target?
 * `can` split into its reasons — the role's capability, then the grant's
 * reach — with the two-edge shape folded in: set `heldAction` and the
 * decision additionally requires a *held* grant over the target carrying
 * it (presence from the worn hat, standing from a held one — OH-QM-07). */
export declare function decide(repo: OrgHatsRepository, request: DecideRequest): Promise<Decision>;
