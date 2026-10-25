import type { Failed, Failure } from "../contract.js";
import type { CommandResult } from "./types.js";
export declare const failed: (failure: Failure) => Failed;
export declare const fail: (kind: Failure["kind"], detail?: string) => {
    ok: false;
    failure: Failure;
};
export declare const ok: (idempotencyKey: string, applied: boolean) => CommandResult;
