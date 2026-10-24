// The canonical verification-key set: the public half of one or more signing
// keys, serialized for deployment configuration. Rotation is
// install-before-sign, so the set is the unit, never a single key.

import {
  base64Decode,
  canonicalJson,
  type JsonValue,
  type VerificationKeyMaterial,
} from "../contract.ts";
import { ed25519VerifyKey, type VerifyKey } from "./verify.ts";

export const VERIFY_KEY_SET_FORMAT = "org-hats.verify-keys" as const;
export const VERIFY_KEY_SET_VERSION = 1 as const;

export interface VerifyKeySet {
  readonly format: typeof VERIFY_KEY_SET_FORMAT;
  readonly v: typeof VERIFY_KEY_SET_VERSION;
  readonly keys: readonly VerificationKeyMaterial[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const material = (value: unknown, index: number): VerificationKeyMaterial => {
  if (!isRecord(value)) throw new Error(`verification key set: key ${index} is not an object`);
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
  let bytes: Uint8Array;
  try {
    bytes = base64Decode(publicKey);
  } catch {
    throw new Error(`verification key set: key ${keyId} publicKey is not base64`);
  }
  if (bytes.length !== 32) {
    throw new Error(`verification key set: key ${keyId} publicKey is not an Ed25519 key`);
  }
  return { keyId, algorithm, publicKey };
};

const materials = (input: readonly VerificationKeyMaterial[]): readonly VerificationKeyMaterial[] => {
  if (input.length === 0) throw new Error("verification key set: at least one key is required");
  const keys = input.map((key, index) => material(key, index));
  const ids = new Set<string>();
  for (const key of keys) {
    if (ids.has(key.keyId)) throw new Error(`verification key set: duplicate keyId ${key.keyId}`);
    ids.add(key.keyId);
  }
  return keys;
};

/** Canonical JSON for deployment configuration. */
export const serializeVerifyKeySet = (input: readonly VerificationKeyMaterial[]): string =>
  canonicalJson({
    format: VERIFY_KEY_SET_FORMAT,
    v: VERIFY_KEY_SET_VERSION,
    keys: materials(input),
  } as unknown as JsonValue);

/** Fail closed on malformed JSON, unknown format/version, duplicate ids, and
 * an empty set. A set that verifies nothing looks like a credential problem
 * and is really a deployment problem. */
export const parseVerifyKeySet = (text: string): VerifyKeySet => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("verification key set: invalid JSON");
  }
  if (!isRecord(parsed)) throw new Error("verification key set: expected an object");
  if (parsed["format"] !== VERIFY_KEY_SET_FORMAT) {
    throw new Error(`verification key set: format must be ${VERIFY_KEY_SET_FORMAT}`);
  }
  if (parsed["v"] !== VERIFY_KEY_SET_VERSION) {
    throw new Error(`verification key set: version must be ${VERIFY_KEY_SET_VERSION}`);
  }
  if (!Array.isArray(parsed["keys"])) throw new Error("verification key set: keys must be an array");
  return {
    format: VERIFY_KEY_SET_FORMAT,
    v: VERIFY_KEY_SET_VERSION,
    keys: materials(parsed["keys"] as VerificationKeyMaterial[]),
  };
};

/** Build the verifier map a host passes to `verify`. */
export const verifyKeysOf = async (set: VerifyKeySet): Promise<ReadonlyMap<string, VerifyKey>> => {
  const keys = new Map<string, VerifyKey>();
  for (const key of set.keys) keys.set(key.keyId, await ed25519VerifyKey(key.keyId, key.publicKey));
  return keys;
};

export const verificationKeysFrom = async (text: string): Promise<ReadonlyMap<string, VerifyKey>> =>
  verifyKeysOf(parseVerifyKeySet(text));
