// The neutral access verifier and the fixed vectors. Vector data is
// committed at fixtures/envelope-vectors.json — byte-exact across
// implementations.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ACCESS_ENVELOPE_FORMAT,
  AUTHORITY_INTERFACE_VERSION,
  canonicalJson,
  type AccessEnvelopeClaimsV1,
  type SignedAccessEnvelope,
} from "../src/contract.ts";
import { ed25519VerifyKey, verify } from "../src/access/verify.ts";
import type { VerifyKey } from "../src/access/verify.ts";
import { webCryptoSigner } from "../src/authority/internal.ts";

const vectors = JSON.parse(
  readFileSync(new URL("./fixtures/envelope-vectors.json", import.meta.url), "utf8"),
) as {
  note: string;
  keyId: string;
  publicKeyBase64: string;
  claims: AccessEnvelopeClaimsV1;
  canonical: string;
  signature: string;
};

const envelopeOf = (claims: AccessEnvelopeClaimsV1, signature = vectors.signature, keyId = vectors.keyId): SignedAccessEnvelope => ({
  format: ACCESS_ENVELOPE_FORMAT,
  v: 1,
  keyId,
  claims,
  signature,
});

const key = await ed25519VerifyKey(vectors.keyId, vectors.publicKeyBase64);
const keys = new Map<string, VerifyKey>([[key.keyId, key]]);

test("vector: the canonical serialization is byte-exact", () => {
  assert.equal(canonicalJson(vectors.claims), vectors.canonical);
});

test("vector: the committed signature verifies with the committed public key", async () => {
  const result = await verify(envelopeOf(vectors.claims), keys, { now: vectors.claims.iat + 1 });
  assert.ok(!("failure" in result), "expected success");
});

test("vector: a forged signature fails closed", async () => {
  const forged = envelopeOf(vectors.claims, vectors.signature.slice(0, -4) + "AAAA");
  const result = await verify(forged, keys, { now: vectors.claims.iat + 1 });
  assert.equal(result.failure.kind, "invalid-signature");
});

test("vector: tampered claims no longer match the signature", async () => {
  const tampered = envelopeOf({ ...vectors.claims, readableOrganizationIds: ["org-everything"] });
  const result = await verify(tampered, keys, { now: vectors.claims.iat + 1 });
  assert.equal(result.failure.kind, "invalid-signature");
});

test("an unknown key id cannot verify", async () => {
  const unknown = envelopeOf(vectors.claims, vectors.signature, "key-retired");
  const result = await verify(unknown, keys, { now: vectors.claims.iat + 1 });
  assert.equal(result.failure.kind, "invalid-signature");
  assert.match(result.failure.detail ?? "", /unknown key id/);
});

test("expiry: the envelope dies at exp, verified one second before", async () => {
  const at = vectors.claims.exp - 1;
  assert.ok(!("failure" in (await verify(envelopeOf(vectors.claims), keys, { now: at }))));
  const dead = await verify(envelopeOf(vectors.claims), keys, { now: vectors.claims.exp });
  assert.equal(dead.failure.kind, "expired");
});

test("wrong versions fail closed, never reinterpreted", async () => {
  const badFormat = { ...envelopeOf(vectors.claims), format: "something.else" };
  assert.equal((await verify(badFormat, keys, { now: vectors.claims.iat + 1 })).failure.kind, "wrong-interface-version");
  const badVersion = { ...envelopeOf(vectors.claims), v: 2 };
  assert.equal((await verify(badVersion, keys, { now: vectors.claims.iat + 1 })).failure.kind, "wrong-interface-version");
  const badInterface = envelopeOf({ ...vectors.claims, interfaceVersion: 99 as never });
  assert.equal((await verify(badInterface, keys, { now: vectors.claims.iat + 1 })).failure.kind, "wrong-interface-version");
});

test("wrong-binding: another operation, or a site the envelope is not admitted to", async () => {
  const now = vectors.claims.iat + 1;
  const otherOp = await verify(envelopeOf(vectors.claims), keys, { now, expectedOperationId: "op-61a8e3f2" });
  assert.equal(otherOp.failure.kind, "wrong-binding");
  const otherSite = await verify(envelopeOf(vectors.claims), keys, { now, expectedSiteId: "site-e4a1c9b3" });
  assert.equal(otherSite.failure.kind, "wrong-binding");
  const rightSite = await verify(envelopeOf(vectors.claims), keys, {
    now,
    expectedOperationId: vectors.claims.operationId,
    expectedSiteId: "site-b8d620fa",
  });
  assert.ok(!("failure" in rightSite));
});

test("key rotation: two keys live during rollout, then the old retires", async () => {
  const claims = vectors.claims;
  const now = claims.iat + 1;

  // verifier-first: the new key is distributed before the issuer uses it
  const newSigner = await webCryptoSigner("vec-key-2");
  const newKey = await ed25519VerifyKey(newSigner.keyId, await newSigner.publicKey());
  const both = new Map<string, VerifyKey>([[key.keyId, key], [newKey.keyId, newKey]]);

  const oldEnvelope = envelopeOf(claims);
  const newEnvelope: SignedAccessEnvelope = {
    ...oldEnvelope,
    keyId: newSigner.keyId,
    signature: await newSigner.sign(canonicalJson(claims)),
  };
  assert.ok(!("failure" in (await verify(oldEnvelope, both, { now }))));
  assert.ok(!("failure" in (await verify(newEnvelope, both, { now }))));

  // retirement: the old key is removed; only its envelopes stop verifying
  const newOnly = new Map<string, VerifyKey>([[newKey.keyId, newKey]]);
  const retired = await verify(oldEnvelope, newOnly, { now });
  assert.equal(retired.failure.kind, "invalid-signature");
  assert.match(retired.failure.detail ?? "", /unknown key id/);
  assert.ok(!("failure" in (await verify(newEnvelope, newOnly, { now }))));
});

test("neutral access: a host maps product facts onto neutral targets", async () => {
  const result = await verify(envelopeOf(vectors.claims), keys, { now: vectors.claims.iat + 1 });
  assert.ok(!("failure" in result));
  const { access } = result;
  // the worn hat carries the action and reaches its team
  assert.equal(access.mayAct("resolve", { kind: "team", teamId: "team-2e8c64b9" }), true);
  assert.equal(access.mayAct("configure", { kind: "team", teamId: "team-2e8c64b9" }), false);
  assert.equal(access.mayAct("resolve", { kind: "team", teamId: "team-c7d9e2a1" }), false);
  assert.equal(access.mayAct("resolve", { kind: "site", siteId: "site-b8d620fa" }), false); // team grant, no site reach
  assert.equal(access.mayAct("resolve", { kind: "operation" }), false); // nothing reaches a whole operation
  assert.deepEqual(access.readableOrganizationIds(), ["org-4c1f9a2e"]);
  assert.deepEqual(access.readableTeamIds(), []);
  assert.equal(access.mayConfigure("site-b8d620fa"), false);
  assert.equal(access.expiresAt(), vectors.claims.exp);
});
