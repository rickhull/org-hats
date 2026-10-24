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
  const verified = await verify(envelope, await verificationKeysFrom(serialized), {
    now: vectors.claims.iat + 1,
  });
  assert.ok(!("failure" in verified));
  assert.equal(canonicalJson(verified.claims), vectors.canonical);
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
