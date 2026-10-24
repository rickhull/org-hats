import { type ActorId, type OrganizationId } from "./contract.js";
import type { AuthorityRuntime, PrincipalEvidence } from "./authority/types.js";
import { type TwinFixture } from "./authority/twins.js";
import { type VerifyKey } from "./access/verify.js";
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
export interface ConformanceCase {
    readonly id: string;
    readonly title: string;
    readonly run: (world: ConformanceWorld) => Promise<void>;
}
export declare const CONFORMANCE_CASES: readonly ConformanceCase[];
export interface ConformanceResult {
    readonly id: string;
    readonly title: string;
    readonly ok: boolean;
    readonly error?: string;
}
/** Run every case in a fresh world, so one case's mutations cannot mask
 * another's. The default world is the in-memory authority. */
export declare const runConformance: (makeWorld?: ConformanceWorldFactory) => Promise<readonly ConformanceResult[]>;
