/** How the issuer computes `readableOrganizationIds`:
 * - `granted-teams` — the organizations of the teams the actor's grants
 *   reach (read reach follows the grants);
 * - `all-participating` — every organization actively participating.
 */
export type OrganizationReadPolicy = "granted-teams" | "all-participating";
/** The read policy is a set of independent axes, one per dimension of reach.
 * v1 defines only the organization axis. A future team-audience axis is an
 * additive optional property on this interface, not a change to the shape of
 * `readPolicy` or to what the organization axis means; no code may assume
 * organization-level reach is the only axis. */
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
/** The actions a role title carries under a validated bundle; `undefined`
 * when the title is not in the bundle — callers treat that as a validation
 * problem, never as "no actions". */
export declare const actionsOf: (bundle: PolicyBundle, role: string) => readonly string[] | undefined;
