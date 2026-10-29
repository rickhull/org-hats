import type { Failure } from "../contract.js";
/** An opaque id (actor or team): non-empty, at most 128 characters. */
export declare const identifierFailure: (value: string, label: string) => Failure | undefined;
/** A display name: `null` clears it; a string must be non-empty and at most
 * 200 characters. */
export declare const displayNameFailure: (value: string | null, label?: string) => Failure | undefined;
