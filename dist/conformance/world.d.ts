import { type ActorId, type OperationId, type OrganizationId } from "../contract.js";
import type { AuthorityRuntime, PrincipalEvidence } from "../authority/types.js";
import { DANA_OKAFOR, FESTIVAL, FESTIVAL_BOOTH_COUNT, HARBOR_LOGISTICS, MERIDIAN, PROFESSIONAL_OPERATION, type TwinFixture } from "../authority/twins.js";
import { type VerifyKey } from "../access/verify.js";
export declare const IDP = "conformance-idp";
export declare const FESTIVAL_OP: OperationId;
export declare const HOME_OP: OperationId;
export declare const NORTH_ORG: OrganizationId;
export declare const ATLAS_ORG: OrganizationId;
export declare const CIDERS_ORG: OrganizationId;
export declare const PARK_ORG: OrganizationId;
export declare const INVITEE_ORG: OrganizationId;
export declare const INVITEE_ACTOR: ActorId;
export declare const INVITEE_UNCLAIMED: ActorId;
export declare const INVITEE_SECOND_ADMIN: ActorId;
export declare const EAST: import("../contract.js").SiteId;
export declare const WEST: import("../contract.js").SiteId;
export declare const ROW: import("../contract.js").SiteId;
export declare const GATE: import("../contract.js").SiteId;
export declare const HARBOR_TEAM: import("../contract.js").TeamId;
export declare const NORTH_TEAM: import("../contract.js").TeamId;
export declare const NORTH_FLOOR: import("../contract.js").TeamId;
export declare const GATE_CREW: import("../contract.js").TeamId;
export declare const BOOTH_001: import("../contract.js").TeamId;
export declare const PRIYA: ActorId;
export declare const MARCO: ActorId;
export declare const SAM: ActorId;
export declare const LEN: ActorId;
export declare const NOBODY: ActorId;
export interface ConformancePrincipal {
    readonly label: string;
    readonly evidence: PrincipalEvidence;
    readonly organizationId: OrganizationId;
    readonly actorId: ActorId;
}
/** The synthetic principals the inventory resolves. A host bootstraps the
 * matching links before running the cases. */
export declare const CONFORMANCE_PRINCIPALS: {
    readonly dana: ConformancePrincipal;
    readonly priya: ConformancePrincipal;
    readonly marco: ConformancePrincipal;
    readonly sam: ConformancePrincipal;
    readonly len: ConformancePrincipal;
    readonly iris: ConformancePrincipal;
    readonly rosa: ConformancePrincipal;
    readonly inviteeLead: ConformancePrincipal;
    readonly inviteeAdmin: ConformancePrincipal;
};
/** An organization that exists but does not participate in Meridian — the
 * invite target. It is conformance data, not a customer fixture. */
export declare const CONFORMANCE_INVITEE: TwinFixture;
export declare const CONFORMANCE_FIXTURES: readonly TwinFixture[];
export interface ConformanceWorldDescription {
    readonly fixtures: readonly TwinFixture[];
    readonly principalLinks: readonly {
        readonly provider: string;
        readonly subject: string;
        readonly organizationId: OrganizationId;
        readonly actorId: ActorId;
    }[];
    readonly orgAdmins: Readonly<Record<OrganizationId, readonly ActorId[]>>;
}
/** The world every adapter bootstraps before running the inventory. */
export declare const CONFORMANCE_WORLD: ConformanceWorldDescription;
export interface ConformanceWorld {
    readonly runtime: AuthorityRuntime;
    readonly keys: ReadonlyMap<string, VerifyKey>;
}
export type ConformanceWorldFactory = () => Promise<ConformanceWorld>;
/** The in-memory world, used by the default runner and by tests. */
export declare const createInMemoryConformanceWorld: () => Promise<ConformanceWorld>;
export { DANA_OKAFOR, FESTIVAL, FESTIVAL_BOOTH_COUNT, HARBOR_LOGISTICS, MERIDIAN, PROFESSIONAL_OPERATION, };
