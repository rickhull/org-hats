import type { AccessEnvelopeClaimsV1, ActorId, OperationId, OrganizationId, SiteBinding, SiteId, TargetRef, TeamId, Unbranded } from "../contract.js";
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
    /** The teams the actor's wearable grants reach — what a site-local view
     * lists without a grant query. The name is historical; this is not a
     * directory membership list. */
    memberTeamIds(): readonly Unbranded<TeamId>[];
    /** How the session's principal authenticated (RFC 8176 `amr`), as the
     * issuing evidence stated and the issuer preserved; empty when that
     * evidence carried none. */
    authenticatedWith(): readonly string[];
    /** When the principal authenticated — the OIDC `auth_time`, epoch
     * seconds. Undefined has no zero: absent means the issuing evidence
     * carried no event time. */
    authenticatedAt(): number | undefined;
    /** Who holds the session: the stable pair, plain strings. */
    actor(): {
        readonly organizationId: Unbranded<OrganizationId>;
        readonly actorId: Unbranded<ActorId>;
    };
    /** Epoch seconds; authorization changes take effect at expiry. */
    expiresAt(): number;
}
/** The verified claims, for hosts that must persist or forward them. Product
 * code reaches for `NeutralAccess`, not this. */
export type VerifiedClaims = AccessEnvelopeClaimsV1;
