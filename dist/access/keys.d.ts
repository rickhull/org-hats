import { type VerificationKeyMaterial } from "../contract.js";
import { type VerifyKey } from "./verify.js";
export declare const VERIFY_KEY_SET_FORMAT: "org-hats.verify-keys";
export declare const VERIFY_KEY_SET_VERSION: 1;
export interface VerifyKeySet {
    readonly format: typeof VERIFY_KEY_SET_FORMAT;
    readonly v: typeof VERIFY_KEY_SET_VERSION;
    readonly keys: readonly VerificationKeyMaterial[];
}
/** Canonical JSON for deployment configuration. */
export declare const serializeVerifyKeySet: (input: readonly VerificationKeyMaterial[]) => string;
/** Fail closed on malformed JSON, unknown format/version, duplicate ids, and
 * an empty set. A set that verifies nothing looks like a credential problem
 * and is really a deployment problem. Unknown *fields* are deliberately
 * ignored: a key set is operator-distributed configuration, and a
 * forward-compatible addition must not brick live verifiers — `format` and
 * `v` carry compatibility, not field-by-field knowledge. */
export declare const parseVerifyKeySet: (text: string) => VerifyKeySet;
/** Build the verifier map a host passes to `verify`. */
export declare const verifyKeysOf: (set: VerifyKeySet) => Promise<ReadonlyMap<string, VerifyKey>>;
export declare const verificationKeysFrom: (text: string) => Promise<ReadonlyMap<string, VerifyKey>>;
