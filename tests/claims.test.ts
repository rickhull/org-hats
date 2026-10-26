// The envelope claims, assembled once. Both runtimes — the in-memory engine
// and the Cloudflare operation coordinator — call this pure function, so the
// hat, the reach, the configured sites, and the authentication facts cannot
// drift between them.

import test from "node:test";
import assert from "node:assert/strict";

import {
  actorId,
  epochSeconds,
  operationId,
  organizationId,
  siteId,
  type AccessEnvelopeClaimsV1,
  type ActorId,
  type Failure,
  type OperationId,
  type OrganizationId,
} from "../src/contract.ts";
import type { PolicyBundle } from "../src/policy.ts";
import {
  DANA_OKAFOR,
  HARBOR_LOGISTICS,
  PROFESSIONAL_OPERATION,
} from "../src/authority/twins.ts";
import { assembleAccessClaims } from "../src/authority/claims.ts";
import { fixtureSnapshot } from "./helpers.ts";

const OP = PROFESSIONAL_OPERATION.snapshot.operations[0]!.operationId;
const WEST = siteId("site-b8d620fa");
const LEN_ORG = organizationId("org-a53e90f7");
const LEN = actorId("actor-77f2b0e5");
const IAT = 1_700_000_000;

const claimsFor = (
  principal: ActorId,
  organization: OrganizationId,
  auth?: { amr?: readonly string[]; authTime?: number },
) =>
  assembleAccessClaims({
    snapshot: PROFESSIONAL_OPERATION.snapshot,
    policy: PROFESSIONAL_OPERATION.policy,
    operationId: OP,
    organizationId: organization,
    actorId: principal,
    configureActions: ["configure"],
    envelopeLifetimeSeconds: 900,
    issuedAt: epochSeconds(IAT),
    ...(auth !== undefined ? { auth } : {}),
  });

const failureOf = (value: AccessEnvelopeClaimsV1 | Failure): Failure => {
  if (!("kind" in value)) throw new Error("expected a failure");
  return value;
};

test("claims: the actor, wearable hat, reach, and lifetime in one shape", () => {
  const claims = claimsFor(DANA_OKAFOR, HARBOR_LOGISTICS);
  assert.ok(!("kind" in claims));
  assert.equal(claims.v, 1);
  assert.equal(claims.interfaceVersion, 3);
  assert.equal(claims.operationId, OP);
  assert.deepEqual(claims.actor, { organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR });
  assert.deepEqual(claims.hat, {
    role: "coordinator",
    actions: ["review", "resolve"],
    teamIds: ["team-2e8c64b9"],
    siteIds: [],
  });
  assert.deepEqual(claims.memberTeamIds, ["team-2e8c64b9"]);
  // the team grant reaches its site for envelope routing
  assert.deepEqual(claims.sites, [{ siteId: WEST, aliases: ["west"] }]);
  // read reach follows the grant: Dana's own organization, no exceptional teams
  assert.deepEqual(claims.readableOrganizationIds, [HARBOR_LOGISTICS]);
  assert.deepEqual(claims.readableTeamIds, []);
  // coordinator carries no configure action
  assert.deepEqual(claims.configurableSiteIds, []);
  assert.equal(claims.iat, IAT);
  assert.equal(claims.exp, IAT + 900);
});

test("claims: a site hat reaches every team at the site and configures it", () => {
  const claims = claimsFor(LEN, LEN_ORG);
  assert.ok(!("kind" in claims));
  assert.deepEqual(claims.hat, {
    role: "admin",
    actions: ["observe", "review", "resolve", "configure"],
    teamIds: ["team-2e8c64b9", "team-9a1f73e0"],
    siteIds: [WEST],
  });
  // reach is the same organization set, in team order; no exceptional teams
  assert.deepEqual(claims.readableOrganizationIds, [HARBOR_LOGISTICS, LEN_ORG]);
  assert.deepEqual(claims.readableTeamIds, []);
  assert.deepEqual(claims.configurableSiteIds, [WEST]);
});

test("claims: absent authentication facts stay absent; present ones are copied", () => {
  const bare = claimsFor(DANA_OKAFOR, HARBOR_LOGISTICS);
  assert.ok(!("kind" in bare));
  assert.equal("amr" in bare, false);
  assert.equal("auth_time" in bare, false);

  const amr = ["pwd", "mfa"];
  const withAuth = claimsFor(DANA_OKAFOR, HARBOR_LOGISTICS, { amr, authTime: 1_699_999_000 });
  assert.ok(!("kind" in withAuth));
  assert.deepEqual(withAuth.amr, amr);
  assert.equal(withAuth.auth_time, 1_699_999_000);
  // the issuer's envelope cannot be mutated through the evidence it read
  amr.push("otp");
  assert.deepEqual(withAuth.amr, ["pwd", "mfa"]);
});

test("claims: no wearable hat is not-admitted; a role missing from the bundle is unavailable", () => {
  const nobody = assembleAccessClaims({
    snapshot: fixtureSnapshot({
      operations: [{ operationId: "op-empty" }],
      organizations: [{ organizationId: "org-empty" }],
      actors: [{ organizationId: "org-empty", actorId: "actor-empty" }],
      sites: [],
      teams: [],
      grants: [],
      participations: [{ organizationId: "org-empty", operationId: "op-empty", status: "active" }],
    }),
    policy: PROFESSIONAL_OPERATION.policy,
    operationId: operationId("op-empty"),
    organizationId: organizationId("org-empty"),
    actorId: actorId("actor-empty"),
    configureActions: ["configure"],
    envelopeLifetimeSeconds: 900,
    issuedAt: epochSeconds(IAT),
  });
  assert.equal(failureOf(nobody).kind, "not-admitted");

  const drifted: PolicyBundle = {
    ...PROFESSIONAL_OPERATION.policy,
    roles: PROFESSIONAL_OPERATION.policy.roles.filter((role) => role.title !== "coordinator"),
  };
  const missing = assembleAccessClaims({
    snapshot: PROFESSIONAL_OPERATION.snapshot,
    policy: drifted,
    operationId: OP,
    organizationId: HARBOR_LOGISTICS,
    actorId: DANA_OKAFOR,
    configureActions: ["configure"],
    envelopeLifetimeSeconds: 900,
    issuedAt: epochSeconds(IAT),
  });
  const failure = failureOf(missing);
  assert.equal(failure.kind, "unavailable");
  assert.match(failure.detail ?? "", /coordinator/);
});
