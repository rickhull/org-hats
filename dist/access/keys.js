// The canonical verification-key set: the public half of one or more signing
// keys, serialized for deployment configuration. Rotation is
// install-before-sign, so the set is the unit, never a single key.
import { base64Decode, canonicalJson, } from "../contract.js";
import { ed25519VerifyKey } from "./verify.js";
export const VERIFY_KEY_SET_FORMAT = "org-hats.verify-keys";
export const VERIFY_KEY_SET_VERSION = 1;
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const material = (value, index) => {
    if (!isRecord(value))
        throw new Error(`verification key set: key ${index} is not an object`);
    const keyId = value["keyId"];
    const algorithm = value["algorithm"];
    const publicKey = value["publicKey"];
    if (typeof keyId !== "string" || keyId.length === 0) {
        throw new Error(`verification key set: key ${index} has no keyId`);
    }
    if (algorithm !== "Ed25519") {
        throw new Error(`verification key set: key ${keyId} must use Ed25519`);
    }
    if (typeof publicKey !== "string" || publicKey.length === 0) {
        throw new Error(`verification key set: key ${keyId} has no publicKey`);
    }
    let bytes;
    try {
        bytes = base64Decode(publicKey);
    }
    catch {
        throw new Error(`verification key set: key ${keyId} publicKey is not base64`);
    }
    if (bytes.length !== 32) {
        throw new Error(`verification key set: key ${keyId} publicKey is not an Ed25519 key`);
    }
    return { keyId, algorithm, publicKey };
};
const materials = (input) => {
    if (input.length === 0)
        throw new Error("verification key set: at least one key is required");
    const keys = input.map((key, index) => material(key, index));
    const ids = new Set();
    for (const key of keys) {
        if (ids.has(key.keyId))
            throw new Error(`verification key set: duplicate keyId ${key.keyId}`);
        ids.add(key.keyId);
    }
    return keys;
};
/** Canonical JSON for deployment configuration. */
export const serializeVerifyKeySet = (input) => canonicalJson({
    format: VERIFY_KEY_SET_FORMAT,
    v: VERIFY_KEY_SET_VERSION,
    keys: materials(input),
});
/** Fail closed on malformed JSON, unknown format/version, duplicate ids, and
 * an empty set. A set that verifies nothing looks like a credential problem
 * and is really a deployment problem. */
export const parseVerifyKeySet = (text) => {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new Error("verification key set: invalid JSON");
    }
    if (!isRecord(parsed))
        throw new Error("verification key set: expected an object");
    if (parsed["format"] !== VERIFY_KEY_SET_FORMAT) {
        throw new Error(`verification key set: format must be ${VERIFY_KEY_SET_FORMAT}`);
    }
    if (parsed["v"] !== VERIFY_KEY_SET_VERSION) {
        throw new Error(`verification key set: version must be ${VERIFY_KEY_SET_VERSION}`);
    }
    if (!Array.isArray(parsed["keys"]))
        throw new Error("verification key set: keys must be an array");
    return {
        format: VERIFY_KEY_SET_FORMAT,
        v: VERIFY_KEY_SET_VERSION,
        keys: materials(parsed["keys"]),
    };
};
/** Build the verifier map a host passes to `verify`. */
export const verifyKeysOf = async (set) => {
    const keys = new Map();
    for (const key of set.keys)
        keys.set(key.keyId, await ed25519VerifyKey(key.keyId, key.publicKey));
    return keys;
};
export const verificationKeysFrom = async (text) => verifyKeysOf(parseVerifyKeySet(text));
