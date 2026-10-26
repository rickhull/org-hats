// A world that is not a twin: your organization, your site, your team, your
// grants. Define it once, boot it, issue, verify, decide locally — then
// switch hats for real and refresh the session onto the new capacity.
//
//   node examples/own-world.ts
//
// The ids, organization, people, and policy here are invented. Replace them
// with yours; the only rule is that ids are stable strings and a site name
// is one DNS label.

import {
  AUTHORITY_INTERFACE_VERSION,
  actorId,
  createInMemoryAuthority,
  defineWorld,
  isFailed,
  organizationId,
} from "../src/authority/index.ts";
import {
  ed25519VerifyKey,
  verify,
  type FailureKind,
  type SignedAccessEnvelope,
} from "../src/access/index.ts";

// --- your world ------------------------------------------------------------------

const OPERATION = "op-lantern-bay";
const PIER = "site-pier";
const SHED = "site-shed";
const TIDEWATER = "org-tidewater";
const YARD = "org-lantern-bay";
const ROBIN = "actor-robin";
const WREN = "actor-wren";

/** Two teams at the pier (one from each organization) and one at the shed.
 * Robin's two hats are a team grant and a site grant, which is what makes
 * the switch visible: the site hat reaches both pier teams and carries
 * `configure`. */
const world = defineWorld({
  name: "lantern-bay",
  policy: {
    format: 1,
    id: "policy-lantern-bay",
    version: "2026-10.1",
    actions: ["inspect", "repair", "configure"],
    roles: [
      { title: "hull-crew", actions: ["inspect", "repair"] },
      { title: "dock-master", actions: ["inspect", "repair", "configure"] },
      { title: "yard-hand", actions: ["inspect"] },
    ],
    readPolicy: { organizations: "granted-teams" },
  },
  snapshot: {
    operations: [{ operationId: OPERATION, displayName: "Lantern Bay Boatyard", slug: "lantern-bay" }],
    organizations: [
      { organizationId: TIDEWATER, displayName: "Tidewater Marine" },
      { organizationId: YARD, displayName: "Lantern Bay Works" },
    ],
    actors: [
      { organizationId: TIDEWATER, actorId: ROBIN, displayName: "Robin Vale" },
      { organizationId: YARD, actorId: WREN, displayName: "Wren Ash" },
    ],
    sites: [
      { siteId: PIER, operationId: OPERATION, displayName: "Pier", path: "pier", aliases: ["pier"] },
      { siteId: SHED, operationId: OPERATION, displayName: "Boat Shed", path: "shed", aliases: ["shed"] },
    ],
    teams: [
      { teamId: "team-hull", siteId: PIER, organizationId: TIDEWATER, displayName: "Hull crew" },
      { teamId: "team-rig", siteId: PIER, organizationId: YARD, displayName: "Rigging" },
      { teamId: "team-shed", siteId: SHED, organizationId: YARD, displayName: "Shed hands" },
    ],
    grants: [
      {
        grantId: "g-hull", operationId: OPERATION, organizationId: TIDEWATER,
        actorId: ROBIN, role: "hull-crew",
        target: { kind: "team", teamId: "team-hull" }, primary: true,
      },
      {
        grantId: "g-dock", operationId: OPERATION, organizationId: TIDEWATER,
        actorId: ROBIN, role: "dock-master",
        target: { kind: "site", siteId: PIER },
      },
      {
        grantId: "g-rig", operationId: OPERATION, organizationId: YARD,
        actorId: WREN, role: "yard-hand",
        target: { kind: "team", teamId: "team-shed" },
      },
    ],
    participations: [
      { organizationId: TIDEWATER, operationId: OPERATION, status: "active" },
      { organizationId: YARD, operationId: OPERATION, status: "active" },
    ],
  },
});

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

// --- boot, issue, verify --------------------------------------------------------

const engine = await createInMemoryAuthority({
  fixtures: [world],
  // The bootstrap link is domain data, not a host command: it is created
  // with the id constructors once, at the seam where the link enters.
  principalLinks: [
    {
      provider: "boatyard-idp", subject: "robin",
      organizationId: organizationId(TIDEWATER), actorId: actorId(ROBIN),
    },
  ],
});

const material = await engine.verificationKey();
const key = await ed25519VerifyKey(material.keyId, material.publicKey);
const keys = new Map([[key.keyId, key]]);

const issued = await engine.runtime.accessFromEvidence({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  operationId: OPERATION,
  evidence: { provider: "boatyard-idp", subject: "robin" },
});
if (isFailed(issued)) throw new Error(`issuance failed: ${issued.failure.kind}`);
if (issued.refresh.kind !== "rotated") throw new Error("the first issuance returns a refresh handle");

const before = issued.envelope;
const verifiedBefore = await verify(before, keys, {
  now: before.claims.iat + 1,
  expectedOperationId: OPERATION,
  expectedSiteId: PIER,
});
if (isFailed(verifiedBefore)) throw new Error(`verification failed: ${verifiedBefore.failure.kind}`);
const accessBefore = verifiedBefore.access;

assert(accessBefore.mayAct("repair", { kind: "team", teamId: "team-hull" }), "the hull hat reaches its team");
assert(!accessBefore.mayAct("repair", { kind: "team", teamId: "team-rig" }), "a team grant does not reach the neighbouring team");
assert(!accessBefore.mayAct("configure", { kind: "site", siteId: PIER }), "the hull hat does not configure the pier");

// --- switch hats for real: select the second grant, then refresh ---------------

const selected = await engine.runtime.command({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  idempotencyKey: "own-world-select-dock",
  authorization: { kind: "access-envelope", envelope: before },
  kind: "select-hat",
  operationId: OPERATION,
  grantId: "g-dock",
});
if (!selected.ok) throw new Error(`select-hat failed: ${selected.failure.kind}`);
assert(selected.receipt.applied, "the first selection applies");

const refreshed = await engine.runtime.refresh({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  operationId: OPERATION,
  handle: issued.refresh.handle,
});
if (isFailed(refreshed)) throw new Error(`refresh failed: ${refreshed.failure.kind}`);

const after = refreshed.envelope;
const verifiedAfter = await verify(after, keys, {
  now: after.claims.iat + 1,
  expectedOperationId: OPERATION,
  expectedSiteId: PIER,
});
if (isFailed(verifiedAfter)) throw new Error(`verification failed: ${verifiedAfter.failure.kind}`);
const accessAfter = verifiedAfter.access;

assert(accessAfter.mayAct("repair", { kind: "team", teamId: "team-rig" }), "the site hat reaches every pier team");
assert(!accessAfter.mayAct("repair", { kind: "team", teamId: "team-shed" }), "the site hat stops at the pier");
assert(accessAfter.mayAct("configure", { kind: "site", siteId: PIER }), "the dock-master configures the pier");
assert(!accessAfter.mayAct("configure", { kind: "site", siteId: SHED }), "another site is outside the hat");

// Read reach is a union over every wearable grant, not the active hat: both
// organizations are readable even while the hull hat is worn.
console.log(`actor: ${after.claims.actor.organizationId}/${after.claims.actor.actorId}`);
console.log(`worn hat before: ${before.claims.hat.role}`);
console.log(`worn hat after: ${after.claims.hat.role}`);
console.log(`repair the hull team: before ${accessBefore.mayAct("repair", { kind: "team", teamId: "team-hull" })} / after ${accessAfter.mayAct("repair", { kind: "team", teamId: "team-hull" })}`);
console.log(`repair the rigging team: before ${accessBefore.mayAct("repair", { kind: "team", teamId: "team-rig" })} / after ${accessAfter.mayAct("repair", { kind: "team", teamId: "team-rig" })}`);
console.log(`configure the pier: before ${accessBefore.mayAct("configure", { kind: "site", siteId: PIER })} / after ${accessAfter.mayAct("configure", { kind: "site", siteId: PIER })}`);
console.log(`readable organizations: ${accessAfter.readableOrganizationIds().join(", ")}`);

// --- the host's HTTP boundary ---------------------------------------------------
//
// Verification is a local call; the handler only maps outcomes onto product
// responses. A missing handle is the app's own 401; a failure kind is never
// rendered as an exception.

interface Request {
  readonly action: string;
  readonly teamId: string;
  readonly now: number;
  readonly envelope?: SignedAccessEnvelope;
}

const statusFor = (kind: FailureKind): number => {
  switch (kind) {
    case "unauthenticated":
    case "invalid-signature":
    case "expired":
      return 401;
    case "denied":
    case "not-admitted":
      return 403;
    case "wrong-binding":
      return 404;
    case "wrong-interface-version":
    case "invalid-command":
      return 400;
    case "unavailable":
      return 503;
  }
};

const handler = async (request: Request): Promise<{ status: number; body: string }> => {
  if (request.envelope === undefined) return { status: 401, body: "no access envelope" };
  const verified = await verify(request.envelope, keys, {
    now: request.now,
    expectedOperationId: OPERATION,
    expectedSiteId: PIER,
  });
  if (isFailed(verified)) {
    return { status: statusFor(verified.failure.kind), body: verified.failure.kind };
  }
  return verified.access.mayAct(request.action, { kind: "team", teamId: request.teamId })
    ? { status: 200, body: `${request.action} allowed` }
    : { status: 403, body: `${request.action} denied` };
};

const now = after.claims.iat + 1;
console.log(`handler, rigging repair: ${JSON.stringify(await handler({ envelope: after, action: "repair", teamId: "team-rig", now }))}`);
console.log(`handler, shed repair: ${JSON.stringify(await handler({ envelope: after, action: "repair", teamId: "team-shed", now }))}`);
console.log(`handler, at expiry: ${JSON.stringify(await handler({ envelope: after, action: "repair", teamId: "team-rig", now: after.claims.exp }))}`);
console.log(`handler, no envelope: ${JSON.stringify(await handler({ action: "repair", teamId: "team-rig", now }))}`);
console.log("own-world passed");
