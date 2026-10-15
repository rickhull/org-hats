export interface ConformanceCase {
    /** Stable. Never renumbered and never reused — two suites compare these. */
    readonly id: string;
    /** One sentence of behavior, not of mechanism. */
    readonly description: string;
}
export declare const CONFORMANCE_CASES: readonly ConformanceCase[];
export declare const CONFORMANCE_IDS: readonly string[];
export interface ConformanceGaps {
    /** Inventory ids the host did not run. Non-empty means non-conformant. */
    readonly missing: readonly string[];
    /** Ids the host ran that the inventory does not name — stale or invented. */
    readonly unknown: readonly string[];
}
/** The one rule both sides share: a host that has run its bodies passes the
 * ids it ran; a non-empty `missing` or `unknown` fails the run. It grows
 * safely — adding a case here makes every host report it missing until it is
 * implemented, instead of passing quietly. */
export declare function conformanceGaps(ran: Iterable<string>): ConformanceGaps;
/** One case's proof: build a fixture, assert behavior, throw to fail. */
export type ConformanceBody = () => void | Promise<void>;
/** A suite: one body per inventory id. */
export type ConformanceBodies = Readonly<Record<string, ConformanceBody>>;
/** A body that ran and threw. A body never registered is not a failure; it
 * is a gap. */
export interface ConformanceFailure {
    readonly id: string;
    readonly error: unknown;
}
export interface ConformanceResult {
    /** The drift check: inventory ids never registered, ids nobody knows. */
    readonly gaps: ConformanceGaps;
    /** Bodies that ran and threw. */
    readonly failures: readonly ConformanceFailure[];
}
/** Run a suite against the published inventory: every body runs, a throw is
 * recorded as a failure, and the ids ran are diffed against the inventory so
 * drift fails the report. A host calls this in its own test run;
 * `examples/conformance.ts` is the reference proof. */
export declare function runConformance(bodies: ConformanceBodies): Promise<ConformanceResult>;
