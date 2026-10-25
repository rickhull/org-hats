import type { Snapshot } from "../model.js";
import type { PolicyBundle } from "../policy.js";
export interface TwinFixture {
    readonly name: "professional" | "festival" | "airlift";
    readonly snapshot: Snapshot;
    readonly policy: PolicyBundle;
}
/** The organization that also joins the festival, and the actor who works
 * both — the cross-operation pair the conformance scenarios exercise. */
export declare const HARBOR_LOGISTICS = "org-4c1f9a2e";
export declare const DANA_OKAFOR = "actor-8d3b77c1";
export declare const PROFESSIONAL_OPERATION: TwinFixture;
export declare const FESTIVAL_BOOTH_COUNT = 150;
export declare const FESTIVAL: TwinFixture;
export declare const AIRLIFT: TwinFixture;
export declare const TWINS: readonly TwinFixture[];
