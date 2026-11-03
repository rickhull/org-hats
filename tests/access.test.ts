// The neutral access verifier and the fixed vectors. Vector data is
// committed at fixtures/envelope-vectors.json — byte-exact across
// implementations.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ACCESS_CLAIMS_MAX_DEPTH,
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

test("[E2] vector: the canonical serialization is byte-exact", () => {
  assert.equal(canonicalJson(asJson(vectors.claims)), vectors.canonical);
});

test("[E1] vector: the committed signature verifies with the committed public key", async () => {
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

test("[E7] expiry: the envelope dies at exp, verified one second before", async () => {
  const at = vectors.claims.exp - 1;
  assert.ok(!isFailed(await verify(envelopeOf(vectors.claims), keys, { now: at })));
  const dead = failureOf(await verify(envelopeOf(vectors.claims), keys, { now: vectors.claims.exp }));
  assert.equal(dead.kind, "expired");
});

test("[E4] verification fails closed in a fixed order when faults combine", async () => {
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

test("[E4] a structurally malformed envelope fails closed as a value, never a throw", async () => {
  // An envelope arrives as untrusted JSON, and the typed parameter is no
  // runtime guard. The version gate reads `format`, `v`, then `claims.v`, so
  // it must refuse a non-object envelope and an absent or non-object claims
  // payload before it reads a field. `format` and `v` are public constants:
  // clearing the first two gates costs an attacker nothing.
  // Unreadable as an envelope is `unauthenticated` — it declares no version,
  // so the caller presented no usable authority, and a host can tell the
  // person to clear the credential and sign in again.
  const now = vectors.claims.iat + 1;
  const unreadable: readonly unknown[] = [
    null,
    undefined,
    "org-hats.access",
    42,
    [],
    { format: ACCESS_ENVELOPE_FORMAT, v: 1 },
    { format: ACCESS_ENVELOPE_FORMAT, v: 1, claims: null },
    { format: ACCESS_ENVELOPE_FORMAT, v: 1, claims: "claims" },
    { format: ACCESS_ENVELOPE_FORMAT, v: 1, claims: 1 },
    { format: ACCESS_ENVELOPE_FORMAT, v: 1, claims: [] },
  ];
  for (const envelope of unreadable) {
    const result = await verify(envelope as never, keys, { now });
    assert.equal(
      failureOf(result).kind,
      "unauthenticated",
      `${String(JSON.stringify(envelope))} must fail as a value`,
    );
  }

  // Recognizable as an envelope, but declaring a version we do not support:
  // that is the version gate's own answer, unchanged. An absent format marker
  // is a declared-format mismatch, not an unreadable envelope.
  const disagreeing: readonly unknown[] = [
    {},
    { format: ACCESS_ENVELOPE_FORMAT },
    { format: ACCESS_ENVELOPE_FORMAT, v: 1, claims: {} },
  ];
  for (const envelope of disagreeing) {
    const result = await verify(envelope as never, keys, { now });
    assert.equal(
      failureOf(result).kind,
      "wrong-interface-version",
      `${String(JSON.stringify(envelope))} must fail as a value`,
    );
  }
});

// Claims nested to a given depth, measured the way `accessClaimsDepth` does:
// the leaf scalar counts, so `{ v: 1, deep: 1 }` is depth 2.
const claimsOfDepth = (depth: number): unknown => {
  let node: unknown = 1;
  for (let i = 0; i < depth - 2; i += 1) node = { a: node };
  return { v: 1, deep: node };
};

test("[E4] claims deeper than the format's bound are refused before canonicalization", async () => {
  // Canonical bytes are an input to the signature check, so the verifier
  // canonicalizes claims it has not verified yet. `canonicalJson` recurses, so
  // an unbounded claims payload was a stack overflow reachable with nothing
  // but a public key id — the gate bounds the depth first, as a value.
  const now = vectors.claims.iat + 1;
  const envelopeAt = (depth: number) => ({
    format: ACCESS_ENVELOPE_FORMAT,
    v: 1,
    keyId: vectors.keyId,
    claims: claimsOfDepth(depth),
    signature: vectors.signature,
  });

  // at the bound the gate passes and the signature decides
  assert.equal(
    failureOf(await verify(envelopeAt(ACCESS_CLAIMS_MAX_DEPTH) as never, keys, { now })).kind,
    "invalid-signature",
  );
  // one level past it, the claims are never read
  assert.equal(
    failureOf(await verify(envelopeAt(ACCESS_CLAIMS_MAX_DEPTH + 1) as never, keys, { now })).kind,
    "unauthenticated",
  );
  // and the depth that used to overflow the stack is now the same answer
  assert.equal(
    failureOf(await verify(envelopeAt(5_000) as never, keys, { now })).kind,
    "unauthenticated",
  );
});

test("[E4] an envelope missing its key id or signature is unreadable, not mis-signed", async () => {
  // These used to fail closed only by accident downstream: an absent key id
  // became `invalid-signature` ("unknown key id undefined") and an absent
  // signature was caught inside the Ed25519 key's own decode. The gate parses
  // them, so the refusal is its own and names what is actually wrong.
  const now = vectors.claims.iat + 1;
  const base = { format: ACCESS_ENVELOPE_FORMAT, v: 1, claims: vectors.claims };
  const cases: readonly (readonly [string, unknown])[] = [
    ["no key id", { ...base, signature: vectors.signature }],
    ["empty key id", { ...base, keyId: "", signature: vectors.signature }],
    ["non-string key id", { ...base, keyId: 7, signature: vectors.signature }],
    ["no signature", { ...base, keyId: vectors.keyId }],
    ["empty signature", { ...base, keyId: vectors.keyId, signature: "" }],
    ["non-string signature", { ...base, keyId: vectors.keyId, signature: 7 }],
  ];
  for (const [label, envelope] of cases) {
    assert.equal(failureOf(await verify(envelope as never, keys, { now })).kind, "unauthenticated", label);
  }

  // an unknown but well-formed key id stays a signature problem: the envelope
  // is readable, we simply do not trust the key that signed it
  const unknown = envelopeOf(vectors.claims, vectors.signature, "key-never-configured");
  assert.equal(failureOf(await verify(unknown, keys, { now })).kind, "invalid-signature");
});

test("[E4] a verify key that throws fails closed, not out of the call", async () => {
  // `verifyKeyOf` is a public escape hatch accepting any verify predicate, so
  // a host-supplied key that throws is a real input. The defensive catch in
  // `ed25519VerifyKey` does not cover it: the guard belongs at the call site.
  const exploding: VerifyKey = {
    keyId: vectors.keyId,
    verify: () => {
      throw new Error("the host's verify predicate threw");
    },
  };
  const result = await verify(
    envelopeOf(vectors.claims),
    new Map<string, VerifyKey>([[exploding.keyId, exploding]]),
    { now: vectors.claims.iat + 1 },
  );
  assert.equal(failureOf(result).kind, "invalid-signature");
});

test("[E8] wrong versions fail closed, never reinterpreted", async () => {
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

test("[E8] the issuing interface version is provenance, not a gate on reading", async () => {
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

test("[E3] an unrecognized optional claim is additive and does not gate reading", async () => {
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

test("[E5] key rotation: two keys live during rollout, then the old retires", async () => {
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

test("[A5] neutral access: a host maps product facts onto neutral targets", async () => {
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
