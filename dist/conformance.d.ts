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
