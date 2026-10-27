// The consumer's side of the access seam.
//
//   node examples/consumer-access.ts
//
// The host does not rewrite verification.  It calls `org-hats/access` and
// maps the closed failure taxonomy onto its own product responses.  The
// exhaustive switch below is the point: a new failure kind is an
// interface-version change, so the `never` arm stops this example compiling
// rather than letting an unknown kind fall through to a generic error.

import {
  AUTHORITY_INTERFACE_VERSION,
  createInMemoryAuthority,
  isFailed,
} from "../src/authority/index.ts";
import {
  ed25519VerifyKey,
  verify,
  type Failure,
  type FailureKind,
  type SignedAccessEnvelope,
} from "../src/access/index.ts";
import { CONFORMANCE_PRINCIPALS, CONFORMANCE_WORLD } from "../src/conformance.ts";
import { MERIDIAN } from "../src/authority/twins.ts";

const WEST = "site-b8d620fa";
const YARD_TEAM = "team-2e8c64b9";
const OTHER_OPERATION = "op-61a8e3f2";

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

// --- the product response -------------------------------------------------------

interface ProductResponse {
  readonly status: number;
  /** Whether proving identity again could change the outcome. */
  readonly reauthenticate: boolean;
  /** Safe to show.  Never the failure's `detail`, which is for logs. */
  readonly message: string;
}

/** Illustrative, not prescribed: a host chooses its own statuses and copy.
 *  What it must not do is let a kind reach a generic default. */
const productResponse = (failure: Failure): ProductResponse => {
  switch (failure.kind) {
    case "unavailable":
      return { status: 503, reauthenticate: false, message: "Temporarily unavailable." };
    case "unauthenticated":
      return { status: 401, reauthenticate: true, message: "Sign in to continue." };
    case "expired":
      return { status: 401, reauthenticate: true, message: "Sign in to continue." };
    case "invalid-signature":
      return { status: 401, reauthenticate: true, message: "Sign in to continue." };
    case "not-admitted":
      return { status: 403, reauthenticate: false, message: "You are not admitted here." };
    case "denied":
      return { status: 403, reauthenticate: false, message: "That is not permitted." };
    case "wrong-binding":
      // Right proof, wrong operation.  A 404, not a 403: a proof for
      // somewhere else must not confirm that this address exists.
      return { status: 404, reauthenticate: false, message: "Not found." };
    case "invalid-command":
      return { status: 400, reauthenticate: false, message: "That request was not valid." };
    case "wrong-interface-version":
      // Our deployments disagree.  Nothing the caller can do.
      return { status: 500, reauthenticate: false, message: "Temporarily unavailable." };
    default: {
      const unreachable: never = failure.kind;
      throw new Error(`consumer-access: unhandled failure kind ${String(unreachable)}`);
    }
  }
};

// --- the real path --------------------------------------------------------------

const engine = await createInMemoryAuthority({
  fixtures: CONFORMANCE_WORLD.fixtures,
  principalLinks: CONFORMANCE_WORLD.principalLinks,
  orgAdmins: CONFORMANCE_WORLD.orgAdmins,
});

const material = await engine.verificationKey();
const key = await ed25519VerifyKey(material.keyId, material.publicKey);
const keys = new Map([[key.keyId, key]]);

const issued = await engine.runtime.accessFromEvidence({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  operationId: MERIDIAN,
  evidence: CONFORMANCE_PRINCIPALS.dana.evidence,
});
if (isFailed(issued)) throw new Error(`issuance failed: ${issued.failure.kind}`);

const check = (envelope: SignedAccessEnvelope, now: number, operationId: string = MERIDIAN) =>
  verify(envelope, keys, {
    now,
    expectedOperationId: operationId,
    expectedSiteId: WEST,
  });

const verified = await check(issued.envelope, issued.envelope.claims.iat + 1);
assert(!isFailed(verified), "a fresh envelope verifies");
assert(verified.access.operationId === MERIDIAN, "the neutral access carries the operation");
assert(verified.access.mayAct("review", { kind: "team", teamId: YARD_TEAM }), "the coordinator reviews the yard team");
assert(!verified.access.mayAct("configure", { kind: "team", teamId: YARD_TEAM }), "the coordinator does not configure it");
console.log(`verified: ${verified.claims.actor.organizationId}/${verified.claims.actor.actorId} on ${verified.access.operationId}`);

const wrongOperation = await check(issued.envelope, issued.envelope.claims.iat + 1, OTHER_OPERATION);
assert(isFailed(wrongOperation), "another operation's id is refused");
const wrongResponse = productResponse(wrongOperation.failure);
assert(wrongResponse.status === 404, "wrong-binding is a 404, not a 403");
console.log(`wrong operation: ${wrongOperation.failure.kind} -> ${wrongResponse.status} ${wrongResponse.message}`);

const expired = await check(issued.envelope, issued.envelope.claims.exp);
assert(isFailed(expired) && expired.failure.kind === "expired", "an envelope at exp is expired");
const expiredResponse = productResponse(expired.failure);
assert(expiredResponse.reauthenticate, "expiry asks for a new sign-in");
console.log(`expired: ${expired.failure.kind} -> ${expiredResponse.status} ${expiredResponse.message}`);

const signature = issued.envelope.signature;
const tampered: SignedAccessEnvelope = {
  ...issued.envelope,
  signature: `${signature.slice(0, -4)}AAAA`,
};
const forged = await check(tampered, issued.envelope.claims.iat + 1);
assert(isFailed(forged) && forged.failure.kind === "invalid-signature", "a changed signature is refused");
const forgedResponse = productResponse(forged.failure);
assert(forgedResponse.status === 401, "a forged envelope is indistinguishable from signed out");
console.log(`forged: ${forged.failure.kind} -> ${forgedResponse.status} ${forgedResponse.message}`);

// Every kind the taxonomy can produce has a response.  The switch above is
// exhaustive at compile time; this walks the list so the mapping is also
// visible at run time.
const kinds: readonly FailureKind[] = [
  "unavailable",
  "unauthenticated",
  "not-admitted",
  "expired",
  "wrong-interface-version",
  "wrong-binding",
  "invalid-signature",
  "invalid-command",
  "denied",
];
for (const kind of kinds) {
  const response = productResponse({ kind });
  console.log(`${kind.padEnd(24)} -> ${response.status} ${response.reauthenticate ? "reauthenticate" : "no-reauth"} ${response.message}`);
}
assert(new Set(kinds).size === 9, "the taxonomy is nine closed kinds");

console.log("consumer access passed");
