import type { Failure } from "../contract.js";
/** An opaque id (actor or team): non-empty, at most 128 characters. */
export declare const identifierFailure: (value: string, label: string) => Failure | undefined;
/** Any display label — a `longName`, a `shortName`, or the single
 * `displayName` an actor or team carries. One rule governs all of them:
 * `null` clears it; a string must be non-empty and at most 200 characters.
 * The name says label, not name, because a short name is one of these too. */
export declare const displayLabelFailure: (value: string | null, label?: string) => Failure | undefined;
