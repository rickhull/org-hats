// The canonical verification-key set: serialization, parse, and fail-closed
// cases. The fixture supplies a real Ed25519 public key and signature.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ACCESS_ENVELOPE_FORMAT,
  canonicalJson,
  type AccessEnvelopeClaimsV1,
  type SignedAccessEnvelope,
} from "../src/contract.ts";
import {
  parseVerifyKeySet,
  serializeVerifyKeySet,
  verificationKeysFrom,
  verifyKeysOf,
  VERIFY_KEY_SET_FORMAT,
  VERIFY_KEY_SET_VERSION,
} from "../src/access/keys.ts";
import { verify } from "../src/access/verify.ts";
import { asJson, successOf } from "./helpers.ts";

const vectors = JSON.parse(
  readFileSync(new URL("./fixtures/envelope-vectors.json", import.meta.url), "utf8"),
) as {
  keyId: string;
  publicKeyBase64: string;
  claims: AccessEnvelopeClaimsV1;
  canonical: string;
  signature: string;
};

const material = {
  keyId: vectors.keyId,
  algorithm: "Ed25519",
  publicKey: vectors.publicKeyBase64,
};

test("parseVerifyKeySet fails closed on a duplicate key id, not only serialize", () => {
  const duplicated = JSON.stringify({
    format: VERIFY_KEY_SET_FORMAT,
    v: VERIFY_KEY_SET_VERSION,
    keys: [material, { ...material, publicKey: "AA" + material.publicKey.slice(2) }],
  });
  assert.throws(() => parseVerifyKeySet(duplicated), /duplicate keyId/);
});

test("a key set round-trips and verifies the committed vector", async () => {
  const serialized = serializeVerifyKeySet([material]);
  const parsed = parseVerifyKeySet(serialized);
  assert.equal(parsed.format, VERIFY_KEY_SET_FORMAT);
  assert.equal(parsed.v, VERIFY_KEY_SET_VERSION);
  assert.deepEqual(parsed.keys, [material]);
  assert.equal(serializeVerifyKeySet(parsed.keys), serialized);

  const keys = await verifyKeysOf(parsed);
  assert.equal(keys.size, 1);
  assert.equal(await keys.get(vectors.keyId)?.verify(vectors.canonical, vectors.signature), true);

  const envelope: SignedAccessEnvelope = {
    format: ACCESS_ENVELOPE_FORMAT,
    v: 1,
    keyId: vectors.keyId,
    claims: vectors.claims,
    signature: vectors.signature,
  };
  const verified = successOf(await verify(envelope, await verificationKeysFrom(serialized), {
    now: vectors.claims.iat + 1,
  }));
  assert.equal(canonicalJson(asJson(verified.claims)), vectors.canonical);
});

test("an empty key set is refused", () => {
  assert.throws(() => serializeVerifyKeySet([]), /at least one key/);
  assert.throws(() => parseVerifyKeySet(JSON.stringify({ format: VERIFY_KEY_SET_FORMAT, v: 1, keys: [] })), /at least one key/);
});

test("duplicate key ids are refused", () => {
  assert.throws(() => serializeVerifyKeySet([material, material]), /duplicate keyId/);
});

test("malformed JSON, format, version, algorithm, and key material fail closed", () => {
  assert.throws(() => parseVerifyKeySet("not json"), /invalid JSON/);
  assert.throws(() => parseVerifyKeySet(JSON.stringify({ format: "other", v: 1, keys: [material] })), /format/);
  assert.throws(() => parseVerifyKeySet(JSON.stringify({ format: VERIFY_KEY_SET_FORMAT, v: 2, keys: [material] })), /version/);
  assert.throws(() => parseVerifyKeySet(JSON.stringify({ format: VERIFY_KEY_SET_FORMAT, v: 1, keys: [{ ...material, algorithm: "ECDSA" }] })), /Ed25519/);
  assert.throws(() => parseVerifyKeySet(JSON.stringify({ format: VERIFY_KEY_SET_FORMAT, v: 1, keys: [{ ...material, publicKey: "not-base64!" }] })), /base64/);
  assert.throws(() => parseVerifyKeySet(JSON.stringify({ format: VERIFY_KEY_SET_FORMAT, v: 1, keys: [{ ...material, publicKey: "AAAA" }] })), /Ed25519 key/);
});

test("each key-shape failure is named", () => {
  const wrapped = (key: unknown): string =>
    JSON.stringify({ format: VERIFY_KEY_SET_FORMAT, v: 1, keys: [key] });
  assert.throws(
    () => parseVerifyKeySet(JSON.stringify({ format: VERIFY_KEY_SET_FORMAT, v: 1, keys: {} })),
    /keys must be an array/,
  );
  assert.throws(() => parseVerifyKeySet(wrapped("not an object")), /not an object/);
  assert.throws(() => parseVerifyKeySet(wrapped([])), /not an object/);
  assert.throws(
    () => parseVerifyKeySet(wrapped({ algorithm: "Ed25519", publicKey: material.publicKey })),
    /no keyId/,
  );
  assert.throws(
    () => parseVerifyKeySet(wrapped({ keyId: "k", algorithm: "Ed25519" })),
    /no publicKey/,
  );
});
