import type { AccessEnvelopeClaimsV1, OperationId, OrganizationId, SiteBinding, SiteId, TeamId } from "../contract.js";
/** Where an act lands. `operation` is the whole undertaking; `site` and
 * `team` narrow it. Hosts map their own records onto these — a report's
 * team, a page's site — and never widen a target the envelope did not name. */
export type TargetRef = {
    readonly kind: "operation";
} | {
    readonly kind: "site";
    readonly siteId: SiteId;
} | {
    readonly kind: "team";
    readonly teamId: TeamId;
};
/** What a verified envelope yields: binding facts plus predicates. Callers
 * never see raw claims and never rebuild reach, fallback, or worn-hat rules. */
export interface NeutralAccess {
    readonly operationId: OperationId;
    readonly sites: readonly SiteBinding[];
    /** The selected hat carries the action and its reach covers the target. */
    mayAct(action: string, target: TargetRef): boolean;
    /** Organizations whose work is readable under the active policy, as
     * computed by the issuer. */
    readableOrganizationIds(): readonly OrganizationId[];
    /** Exceptional team grants only — never an expanded list of every
     * readable team. */
    readableTeamIds(): readonly TeamId[];
    /** Site-configuration reach. */
    mayConfigure(siteId: SiteId): boolean;
    /** Epoch seconds; authorization changes take effect at expiry. */
    expiresAt(): number;
}
/** The verified claims, for hosts that must persist or forward them. Product
 * code reaches for `NeutralAccess`, not this. */
export type VerifiedClaims = AccessEnvelopeClaimsV1;
