/** How the issuer computes `readableOrganizationIds`:
 * - `granted-teams` — the organizations of the teams the actor's grants
 *   reach (read reach follows the grants);
 * - `all-participating` — every organization actively participating.
 */
export type OrganizationReadPolicy = "granted-teams" | "all-participating";
/** The read policy is a set of independent axes, one per dimension of reach.
 * v1 defines only the organization axis. A future team-read axis is an
 * additive optional property on this interface, not a change to the shape of
 * `readPolicy` or to what the organization axis means; no code may assume
 * organization-level reach is the only axis. It is a scope, not an expanded
 * team list: a festival-sized operation cannot carry every team id in the
 * envelope. */
export interface ReadPolicy {
    readonly organizations: OrganizationReadPolicy;
}
export interface PolicyRole {
    /** Role titles are data, not platform enums; the bundle owns them. */
    readonly title: string;
    readonly actions: readonly string[];
}
export interface PolicyBundle {
    readonly format: 1;
    readonly id: string;
    readonly version: string;
    /** The operation's action vocabulary. Actions are opaque to org-hats; the
     * host names them and the bundle maps roles onto them. */
    readonly actions: readonly string[];
    readonly roles: readonly PolicyRole[];
    readonly readPolicy: ReadPolicy;
}
/** One sentence per problem, in plain words. An empty list is the only valid
 * bundle. */
export type PolicyProblem = string;
export declare const validatePolicyBundle: (bundle: PolicyBundle) => readonly PolicyProblem[];
/** What a role title carries under a validated bundle, or that the bundle
 * does not name it at all.
 *
 * A result rather than `readonly string[] | undefined` because the
 * distinction is the whole point and `?? []` erased it: an unknown role
 * silently became a wearable-but-powerless hat instead of the visible
 * inconsistency it is. Six of this function's callers wrote `?? []`. A
 * union cannot be coalesced the same way. */
export type RoleActions = {
    readonly found: true;
    readonly actions: readonly string[];
} | {
    readonly found: false;
};
/** The actions a role title carries under a validated bundle.
 * `{ found: false }` means the title is not in the bundle — callers treat
 * that as a validation problem, never as "no actions". */
export declare const actionsOf: (bundle: PolicyBundle, role: string) => RoleActions;
