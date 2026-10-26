// The consumer pilot's starting path: bootstrap the Professional Operation
// example world, resolve verified evidence to an organization actor, issue a signed envelope, distribute the
// verification key, verify locally, call neutral predicates, and watch the
// bounded expiry close the same envelope.
//
//   node examples/pilot.ts
//
// Everything here is public surface: `org-hats/authority` and
// `org-hats/access`. No authority rows, private adapter seams, or raw claims
// cross to the consumer side.

import {
  AUTHORITY_INTERFACE_VERSION,
  DANA_OKAFOR,
  HARBOR_LOGISTICS,
  isFailed,
  PROFESSIONAL_OPERATION,
  createInMemoryAuthority,
} from "../src/authority/index.ts";
import { ed25519VerifyKey, verify } from "../src/access/index.ts";

const OPERATION = "op-9f2e6ad4";
const WEST = "site-b8d620fa";
const REACHED_TEAM = "team-2e8c64b9";
const OTHER_TEAM = "team-c7d9e2a1";

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

// 1. Bootstrap: the example world's snapshot and the verified-principal link.
const engine = await createInMemoryAuthority({
  fixtures: [PROFESSIONAL_OPERATION],
  principalLinks: [
    {
      provider: "pilot-idp",
      subject: "dana",
      organizationId: HARBOR_LOGISTICS,
      actorId: DANA_OKAFOR,
    },
  ],
});

// 2. Login: typed evidence resolves to the organization-scoped actor and a
// signed envelope plus an explicit refresh-handle outcome.
const issued = await engine.runtime.accessFromEvidence({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  operationId: OPERATION,
  evidence: { provider: "pilot-idp", subject: "dana" },
});
if (isFailed(issued)) throw new Error(`issuance failed: ${issued.failure.kind}`);
const { envelope, refresh } = issued;

// 3. Key distribution: verifiers receive the public key before issuance.
const material = await engine.verificationKey();
const verifyKey = await ed25519VerifyKey(material.keyId, material.publicKey);
const keys = new Map([[verifyKey.keyId, verifyKey]]);

// 4. Local verification: the consumer gets neutral facts, not raw claims.
const verified = await verify(envelope, keys, {
  now: envelope.claims.iat + 1,
  expectedOperationId: OPERATION,
  expectedSiteId: WEST,
});
if (isFailed(verified)) throw new Error(`verification failed: ${verified.failure.kind}`);
const { access } = verified;

assert(access.mayAct("review", { kind: "team", teamId: REACHED_TEAM }), "the worn hat reaches the team");
assert(!access.mayAct("review", { kind: "team", teamId: OTHER_TEAM }), "reach is discrete");
assert(!access.mayAct("review", { kind: "operation" }), "nothing reaches the operation");
assert(!access.mayConfigure(WEST), "a coordinator does not configure");

console.log(`actor: ${envelope.claims.actor.organizationId}/${envelope.claims.actor.actorId}`);
console.log(`operation: ${access.operationId}`);
console.log(`worn hat: ${envelope.claims.hat.role}`);
console.log(`refresh: ${refresh.kind}`);
console.log(`readable organizations: ${access.readableOrganizationIds().join(", ")}`);
console.log(`may review the reached team: ${access.mayAct("review", { kind: "team", teamId: REACHED_TEAM })}`);
console.log(`may review another team: ${access.mayAct("review", { kind: "team", teamId: OTHER_TEAM })}`);
console.log(`may configure the site: ${access.mayConfigure(WEST)}`);
console.log(`expires at: ${access.expiresAt()}`);

// 5. The window is bounded: the same envelope fails closed at expiry.
const expired = await verify(envelope, keys, {
  now: envelope.claims.exp,
  expectedOperationId: OPERATION,
});
if (!isFailed(expired)) throw new Error("expected the bounded expiry denial");
assert(expired.failure.kind === "expired", `expected expired, got ${expired.failure.kind}`);
console.log(`at exp: ${expired.failure.kind}`);
console.log("pilot passed");
