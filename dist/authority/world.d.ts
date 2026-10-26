import type { Unbranded } from "../contract.js";
import { type Snapshot } from "../model.js";
import { type PolicyBundle } from "../policy.js";
/** A complete world a runtime boots from: one operation's snapshot and the
 * bundle that judges it. A twin is a `WorldFixture` with a reserved name. */
export interface WorldFixture {
    readonly name: string;
    readonly snapshot: Snapshot;
    readonly policy: PolicyBundle;
}
export interface WorldDefinition {
    /** A label for logs and test failures, not a domain id. */
    readonly name: string;
    readonly policy: PolicyBundle;
    /** Hand-written data with plain-string ids; the cast below supplies the
     * brands once, at this boundary. */
    readonly snapshot: Unbranded<Snapshot>;
}
/** Convert a hand-written world once, and refuse it if it is incoherent.
 * The cast supplies the brands; the two validators decide validity. A
 * malformed world fails here, before any runtime loads it. */
export declare const defineWorld: (input: WorldDefinition) => WorldFixture;
