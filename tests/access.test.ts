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
  isFailed,
  type AccessEnvelopeClaimsV1,
  type SignedAccessEnvelope,
} from "../src/contract.ts";
import { ed25519VerifyKey, verify } from "../src/access/verify.ts";
import type { VerifyKey } from "../src/access/verify.ts";
import { webCryptoSigner } from "../src/authority/internal.ts";
import { asJson, failureOf, successOf } from "./helpers.ts";

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
  assert.equal(canonicalJson(asJson(vectors.claims)), vectors.canonical);
});

test("vector: the committed signature verifies with the committed public key", async () => {
  const result = await verify(envelopeOf(vectors.claims), keys, { now: vectors.claims.iat + 1 });
  assert.ok(!isFailed(result), "expected success");
});

test("vector: the claims were issued by an older interface and still verify", async () => {
  // The committed vector claims carry a historical `interfaceVersion`: the
  // fixture records interface 1. That they verify is the contract —
  // provenance is not a gate — and that they load into the claims type with
  // no cast is the type-layer claim: the field is `IssuerInterfaceVersion`,
  // not the current call-surface literal.
  assert.ok(vectors.claims.interfaceVersion !== AUTHORITY_INTERFACE_VERSION);
  assert.ok(!isFailed(await verify(envelopeOf(vectors.claims), keys, { now: vectors.claims.iat + 1 })));
});

test("vector: a forged signature fails closed", async () => {
  const forged = envelopeOf(vectors.claims, vectors.signature.slice(0, -4) + "AAAA");
  const result = failureOf(await verify(forged, keys, { now: vectors.claims.iat + 1 }));
  assert.equal(result.kind, "invalid-signature");
});

test("vector: tampered claims no longer match the signature", async () => {
  const tampered = envelopeOf({ ...vectors.claims, readableOrganizationIds: ["org-everything"] });
  const result = failureOf(await verify(tampered, keys, { now: vectors.claims.iat + 1 }));
  assert.equal(result.kind, "invalid-signature");
});

test("an unknown key id cannot verify", async () => {
  const unknown = envelopeOf(vectors.claims, vectors.signature, "key-retired");
  const result = failureOf(await verify(unknown, keys, { now: vectors.claims.iat + 1 }));
  assert.equal(result.kind, "invalid-signature");
  assert.match(result.detail ?? "", /unknown key id/);
});

test("expiry: the envelope dies at exp, verified one second before", async () => {
  const at = vectors.claims.exp - 1;
  assert.ok(!isFailed(await verify(envelopeOf(vectors.claims), keys, { now: at })));
  const dead = failureOf(await verify(envelopeOf(vectors.claims), keys, { now: vectors.claims.exp }));
  assert.equal(dead.kind, "expired");
});

test("verification fails closed in a fixed order when faults combine", async () => {
  // versions before the signature: a wrong version with a forged signature
  // is a version failure, not a signature failure
  const wrongVersionForged = {
    ...envelopeOf(vectors.claims, vectors.signature.slice(0, -4) + "AAAA"),
    v: 2 as never,
  };
  assert.equal(
    failureOf(await verify(wrongVersionForged, keys, { now: vectors.claims.iat + 1 })).kind,
    "wrong-interface-version",
  );
  // the key before the clock: an expired envelope under an unknown key id is
  // an invalid signature, not an expiry
  const expiredUnknownKey = envelopeOf(vectors.claims, vectors.signature, "key-never-configured");
  assert.equal(
    failureOf(await verify(expiredUnknownKey, keys, { now: vectors.claims.exp + 100 })).kind,
    "invalid-signature",
  );
  // the clock before the bindings: an expired envelope at the wrong site is
  // expired, not wrongly bound
  assert.equal(
    failureOf(await verify(envelopeOf(vectors.claims), keys, {
      now: vectors.claims.exp + 100,
      expectedSiteId: "site-not-admitted",
    })).kind,
    "expired",
  );
});

test("wrong versions fail closed, never reinterpreted", async () => {
  const now = vectors.claims.iat + 1;
  const badFormat = { ...envelopeOf(vectors.claims), format: "something.else" as never };
  assert.equal(failureOf(await verify(badFormat, keys, { now })).kind, "wrong-interface-version");
  const badVersion = { ...envelopeOf(vectors.claims), v: 2 as never };
  assert.equal(failureOf(await verify(badVersion, keys, { now })).kind, "wrong-interface-version");

  // The claims carry their own version, and it has to agree with the
  // wrapper's. This was unchecked: a signature-valid `v: 2` claims payload
  // inside a `v: 1` envelope was accepted and read as v1.
  const claimsVersionDisagrees = envelopeOf({ ...vectors.claims, v: 2 as never });
  const disagreement = failureOf(await verify(claimsVersionDisagrees, keys, { now }));
  assert.equal(disagreement.kind, "wrong-interface-version");
  assert.match(disagreement.detail ?? "", /disagree on the version/);
});

test("the issuing interface version is provenance, not a gate on reading", async () => {
  // An envelope outlives the call signatures that produced it. The claims
  // record which runtime interface issued them, but a verifier must not
  // reject live sessions because the issuer has since moved to a new command
  // vocabulary — nothing about what these claims *mean* changed. What governs
  // readability is the envelope version pair, asserted above.
  //
  // Signed here rather than reusing the vector signature, because the point
  // is a *valid* envelope whose issuing interface version differs.
  const signer = await webCryptoSigner("key-provenance");
  const signerKey = await ed25519VerifyKey("key-provenance", await signer.publicKey());
  // Deliberately not the current interface, and derived from it so the test
  // cannot become a no-op if the constant ever moves back. The claims field
  // is provenance (`IssuerInterfaceVersion`), so the historical literal
  // needs no cast — that is the type telling the truth this test asserts.
  const differentInterface = AUTHORITY_INTERFACE_VERSION + 1;
  const claims = { ...vectors.claims, interfaceVersion: differentInterface };
  const envelope: SignedAccessEnvelope = {
    format: ACCESS_ENVELOPE_FORMAT,
    v: 1,
    keyId: "key-provenance",
    claims,
    signature: await signer.sign(canonicalJson(asJson(claims))),
  };
  const verified = successOf(await verify(envelope, new Map([[signerKey.keyId, signerKey]]), {
    now: vectors.claims.iat + 1,
  }));
  assert.equal(verified.claims.interfaceVersion, differentInterface, "and is reported unchanged");
});

test("an unrecognized optional claim is additive and does not gate reading", async () => {
  // E3: claims grow additively within a format version. A newer issuer may
  // carry a claim an older verifier does not know; canonical serialization
  // covers it, and the verifier reads the claims it does know.
  const signer = await webCryptoSigner("key-additive");
  const signerKey = await ed25519VerifyKey("key-additive", await signer.publicKey());
  const claims = { ...vectors.claims, futureClaim: { note: "additive" } };
  const envelope: SignedAccessEnvelope = {
    format: ACCESS_ENVELOPE_FORMAT,
    v: 1,
    keyId: "key-additive",
    claims: claims as unknown as AccessEnvelopeClaimsV1,
    signature: await signer.sign(canonicalJson(asJson(claims))),
  };
  const verified = successOf(await verify(envelope, new Map([[signerKey.keyId, signerKey]]), {
    now: vectors.claims.iat + 1,
  }));
  assert.equal(verified.claims.operationId, vectors.claims.operationId);
  assert.equal(verified.claims.v, 1);
  assert.deepEqual(verified.access.readableOrganizationIds(), vectors.claims.readableOrganizationIds);
});

test("wrong-binding: another operation, or a site the envelope is not admitted to", async () => {
  const now = vectors.claims.iat + 1;
  const otherOp = failureOf(await verify(envelopeOf(vectors.claims), keys, { now, expectedOperationId: "op-61a8e3f2" }));
  assert.equal(otherOp.kind, "wrong-binding");
  const otherSite = failureOf(await verify(envelopeOf(vectors.claims), keys, { now, expectedSiteId: "site-e4a1c9b3" }));
  assert.equal(otherSite.kind, "wrong-binding");
  const rightSite = await verify(envelopeOf(vectors.claims), keys, {
    now,
    expectedOperationId: vectors.claims.operationId,
    expectedSiteId: "site-b8d620fa",
  });
  assert.ok(!isFailed(rightSite));
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
    signature: await newSigner.sign(canonicalJson(asJson(claims))),
  };
  assert.ok(!isFailed(await verify(oldEnvelope, both, { now })));
  assert.ok(!isFailed(await verify(newEnvelope, both, { now })));

  // retirement: the old key is removed; only its envelopes stop verifying
  const newOnly = new Map<string, VerifyKey>([[newKey.keyId, newKey]]);
  const retired = failureOf(await verify(oldEnvelope, newOnly, { now }));
  assert.equal(retired.kind, "invalid-signature");
  assert.match(retired.detail ?? "", /unknown key id/);
  assert.ok(!isFailed(await verify(newEnvelope, newOnly, { now })));
});

test("neutral access: a host maps product facts onto neutral targets", async () => {
  const { access } = successOf(await verify(envelopeOf(vectors.claims), keys, { now: vectors.claims.iat + 1 }));
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
  // member reach, authentication facts, and the holder — all without reading
  // raw claims
  assert.deepEqual(access.teamReach(), ["team-2e8c64b9"]);
  assert.deepEqual(access.authenticatedWith(), ["pwd"]);
  assert.equal(access.authenticatedAt(), 1_699_996_400);
  assert.equal(access.actor().organizationId, "org-4c1f9a2e");
  assert.equal(access.actor().actorId, "actor-8d3b77c1");
});

test("neutral access: absent authentication facts flatten honestly", async () => {
  // `amr` absent means the issuing evidence carried none — an empty list.
  // `auth_time` absent has no honest zero; it stays undefined.
  const { amr: _amr, auth_time: _authTime, ...bare } = vectors.claims;
  const signer = await webCryptoSigner("key-bare-amr");
  const signerKey = await ed25519VerifyKey(signer.keyId, await signer.publicKey());
  const envelope: SignedAccessEnvelope = {
    format: ACCESS_ENVELOPE_FORMAT,
    v: 1,
    keyId: signer.keyId,
    claims: bare,
    signature: await signer.sign(canonicalJson(asJson(bare))),
  };
  const { access } = successOf(await verify(envelope, new Map([[signerKey.keyId, signerKey]]), {
    now: vectors.claims.iat + 1,
  }));
  assert.deepEqual(access.authenticatedWith(), []);
  assert.equal(access.authenticatedAt(), undefined);
  assert.deepEqual(access.teamReach(), ["team-2e8c64b9"]);
});
