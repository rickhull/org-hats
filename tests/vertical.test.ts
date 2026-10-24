// The vertical path that gates the alpha tag (plans/v1.md): evidence →
// engine issuance → public-key distribution → verification-only access →
// neutral predicates. No authority internals cross to the consumer side
// except the envelope and the public key.

import test from "node:test";
import assert from "node:assert/strict";

import { AUTHORITY_INTERFACE_VERSION } from "../src/contract.ts";
import { createInMemoryAuthority } from "../src/authority/engine.ts";
import { fixedClock, webCryptoSigner } from "../src/authority/internal.ts";
import { ed25519VerifyKey, verify } from "../src/access/verify.ts";
import { DANA_OKAFOR, HARBOR_LOGISTICS, PROFESSIONAL_OPERATION } from "../src/authority/twins.ts";

const OP = "op-9f2e6ad4";
const WEST = "site-b8d620fa";

test("evidence to neutral access, end to end", async () => {
  const clock = fixedClock(1_700_000_000);
  const signer = await webCryptoSigner("key-live");
  const engine = await createInMemoryAuthority({
    clock,
    signer,
    fixtures: [PROFESSIONAL_OPERATION],
    principalLinks: [
      { provider: "test-idp", subject: "dana", organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR },
    ],
  });

  // 1. login: the host hands typed evidence to authority
  const issue = await engine.runtime.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: OP,
    evidence: { provider: "test-idp", subject: "dana" },
  });
  assert.ok(!("failure" in issue));

  // 2. key distribution: verifiers receive the public key first
  const material = await engine.verificationKey();
  assert.equal(material.keyId, signer.keyId);
  const verifyKey = await ed25519VerifyKey(material.keyId, material.publicKey);
  const keys = new Map([[verifyKey.keyId, verifyKey]]);

  // 3. the consumer verifies and maps product facts onto neutral targets
  const verified = await verify(issue.envelope, keys, {
    now: clock.now(),
    expectedOperationId: OP,
    expectedSiteId: WEST,
  });
  assert.ok(!("failure" in verified));
  const { access } = verified;
  assert.equal(access.operationId, OP);
  assert.equal(access.mayAct("resolve", { kind: "team", teamId: "team-2e8c64b9" }), true);
  assert.equal(access.mayAct("configure", { kind: "team", teamId: "team-2e8c64b9" }), false);
  assert.deepEqual(access.readableOrganizationIds(), [HARBOR_LOGISTICS]);

  // 4. the window is bounded: at expiry the same envelope fails closed
  clock.advance(900);
  const expired = await verify(issue.envelope, keys, {
    now: clock.now(),
    expectedOperationId: OP,
    expectedSiteId: WEST,
  });
  assert.equal(expired.failure.kind, "expired");
});
