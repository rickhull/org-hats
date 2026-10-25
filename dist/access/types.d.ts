import type { AccessEnvelopeClaimsV1, OperationId, OrganizationId, SiteBinding, SiteId, TargetRef, TeamId, Unbranded } from "../contract.js";
export type { TargetRef } from "../contract.js";
/** What a verified envelope yields: binding facts plus predicates. Callers
 * never see raw claims and never rebuild reach, fallback, or worn-hat rules. */
export interface NeutralAccess {
    readonly operationId: Unbranded<OperationId>;
    readonly sites: readonly SiteBinding[];
    /** The selected hat carries the action and its reach covers the target. */
    mayAct(action: string, target: TargetRef): boolean;
    /** Organizations whose work is readable under the active policy, as
     * computed by the issuer. */
    readableOrganizationIds(): readonly Unbranded<OrganizationId>[];
    /** Exceptional team grants only — never an expanded list of every
     * readable team. */
    readableTeamIds(): readonly Unbranded<TeamId>[];
    /** Site-configuration reach. */
    mayConfigure(siteId: Unbranded<SiteId>): boolean;
    /** Epoch seconds; authorization changes take effect at expiry. */
    expiresAt(): number;
}
/** The verified claims, for hosts that must persist or forward them. Product
 * code reaches for `NeutralAccess`, not this. */
export type VerifiedClaims = AccessEnvelopeClaimsV1;
