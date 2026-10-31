import { type ConformanceWorldFactory } from "./conformance/world.js";
export type { ConformanceCase } from "./conformance/case.js";
export { CONFORMANCE_FIXTURES, CONFORMANCE_INVITEE, CONFORMANCE_PRINCIPALS, CONFORMANCE_WORLD, createInMemoryConformanceWorld, } from "./conformance/world.js";
export type { ConformancePrincipal, ConformanceWorld, ConformanceWorldDescription, ConformanceWorldFactory, } from "./conformance/world.js";
export { CONFORMANCE_CASES } from "./conformance/cases.js";
export interface ConformanceResult {
    readonly id: string;
    readonly title: string;
    readonly ok: boolean;
    readonly error?: string;
}
/** Run every case in a fresh world, so one case's mutations cannot mask
 * another's. The default world is the in-memory authority. */
export declare const runConformance: (makeWorld?: ConformanceWorldFactory) => Promise<readonly ConformanceResult[]>;
