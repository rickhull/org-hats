// Conformance world data and the in-memory factory. Cases import the
// fixtures and ids from here; the runner treats the world as opaque.

import {
  actorId,
  operationId,
  organizationId,
  siteId,
  teamId,
  type ActorId,
  type OperationId,
  type OrganizationId,
} from "../contract.ts";
import type { AuthorityRuntime, PrincipalEvidence } from "../authority/types.ts";
import { createInMemoryAuthority } from "../authority/engine.ts";
import {
  DANA_OKAFOR,
  FESTIVAL,
  FESTIVAL_BOOTH_COUNT,
  HARBOR_LOGISTICS,
  MERIDIAN,
  PROFESSIONAL_OPERATION,
  type TwinFixture,
} from "../authority/twins.ts";
import { ed25519VerifyKey, type VerifyKey } from "../access/verify.ts";

export const IDP = "conformance-idp";

export const FESTIVAL_OP = operationId("op-61a8e3f2");
export const HOME_OP = operationId("op-conformance-home");
export const NORTH_ORG = organizationId("org-2b7c41de");
export const ATLAS_ORG = organizationId("org-a53e90f7");
export const CIDERS_ORG = organizationId("org-d94b1c6e");
export const PARK_ORG = organizationId("org-08f7a2b5");
export const INVITEE_ORG = organizationId("org-invitee");
export const INVITEE_ACTOR = actorId("actor-inv-lead");
export const INVITEE_UNCLAIMED = actorId("actor-inv-unclaimed");
export const INVITEE_SECOND_ADMIN = actorId("actor-inv-admin");
export const EAST = siteId("site-e4a1c9b3");
export const WEST = siteId("site-b8d620fa");
export const ROW = siteId("site-5c2f87ad");
export const GATE = siteId("site-a9e05c41");
export const HARBOR_TEAM = teamId("team-2e8c64b9");
export const NORTH_TEAM = teamId("team-c7d9e2a1");
export const NORTH_FLOOR = teamId("team-f5b3a08d");
export const GATE_CREW = teamId("team-3f8b52d6");
export const BOOTH_001 = teamId("team-booth-001");
// the actors conformance cases name directly, rather than through a
// principal: one declaration each, so a case reads the name not the id
export const PRIYA = actorId("actor-11c2f8ab");
export const MARCO = actorId("actor-6e0d94b2");
export const SAM = actorId("actor-3a91c4d8");
export const LEN = actorId("actor-77f2b0e5");
export const NOBODY = actorId("actor-nobody");

export interface ConformancePrincipal {
  readonly label: string;
  readonly evidence: PrincipalEvidence;
  readonly organizationId: OrganizationId;
  readonly actorId: ActorId;
}

const principal = (
  label: string,
  subject: string,
  organizationId: OrganizationId,
  actorId: ActorId,
): ConformancePrincipal => ({
  label,
  evidence: { provider: IDP, subject },
  organizationId,
  actorId,
});

/** The synthetic principals the inventory resolves. A host bootstraps the
 * matching links before running the cases. */
export const CONFORMANCE_PRINCIPALS = {
  dana: principal("Dana Okafor", "dana", HARBOR_LOGISTICS, DANA_OKAFOR),
  priya: principal("Priya Nandi", "priya", NORTH_ORG, actorId("actor-11c2f8ab")),
  marco: principal("Marco Reyes", "marco", NORTH_ORG, actorId("actor-6e0d94b2")),
  sam: principal("Sam Whitfield", "sam", HARBOR_LOGISTICS, actorId("actor-3a91c4d8")),
  len: principal("Len Chu", "len", ATLAS_ORG, actorId("actor-77f2b0e5")),
  iris: principal("Iris Bell", "iris", CIDERS_ORG, actorId("actor-40e9d1a7")),
  rosa: principal("Rosa Quill", "rosa", PARK_ORG, actorId("actor-b17d39e8")),
  inviteeLead: principal("Nia Fields", "invitee-lead", INVITEE_ORG, INVITEE_ACTOR),
  inviteeAdmin: principal("Tess Admin", "invitee-admin", INVITEE_ORG, INVITEE_SECOND_ADMIN),
} as const;

/** An organization that exists but does not participate in Meridian — the
 * invite target. It is conformance data, not a customer fixture. */
export const CONFORMANCE_INVITEE: TwinFixture = {
  name: "invitee",
  policy: PROFESSIONAL_OPERATION.policy,
  snapshot: {
    operations: [{ operationId: HOME_OP, displayName: "Conformance Home", slug: "conformance-home" }],
    organizations: [{ organizationId: INVITEE_ORG, displayName: "Cedar Works" }],
    actors: [
      { organizationId: INVITEE_ORG, actorId: INVITEE_ACTOR, displayName: "Nia Fields" },
      { organizationId: INVITEE_ORG, actorId: INVITEE_UNCLAIMED, displayName: "Unclaimed Invitee" },
      { organizationId: INVITEE_ORG, actorId: INVITEE_SECOND_ADMIN, displayName: "Tess Admin" },
    ],
    sites: [],
    teams: [],
    grants: [],
    participations: [{ organizationId: INVITEE_ORG, operationId: HOME_OP, status: "active" }],
  },
};

export const CONFORMANCE_FIXTURES: readonly TwinFixture[] = [
  PROFESSIONAL_OPERATION,
  FESTIVAL,
  CONFORMANCE_INVITEE,
];

export interface ConformanceWorldDescription {
  readonly fixtures: readonly TwinFixture[];
  readonly principalLinks: readonly {
    readonly provider: string;
    readonly subject: string;
    readonly organizationId: OrganizationId;
    readonly actorId: ActorId;
  }[];
  readonly orgAdmins: Readonly<Record<OrganizationId, readonly ActorId[]>>;
}

/** The world every adapter bootstraps before running the inventory. */
export const CONFORMANCE_WORLD: ConformanceWorldDescription = {
  fixtures: CONFORMANCE_FIXTURES,
  principalLinks: Object.values(CONFORMANCE_PRINCIPALS).map((entry) => ({
    provider: entry.evidence.provider,
    subject: entry.evidence.subject,
    organizationId: entry.organizationId,
    actorId: entry.actorId,
  })),
  orgAdmins: {
    [HARBOR_LOGISTICS]: [DANA_OKAFOR],
    [INVITEE_ORG]: [INVITEE_ACTOR, INVITEE_SECOND_ADMIN],
  },
};

export interface ConformanceWorld {
  readonly runtime: AuthorityRuntime;
  readonly keys: ReadonlyMap<string, VerifyKey>;
}

export type ConformanceWorldFactory = () => Promise<ConformanceWorld>;

/** The in-memory world, used by the default runner and by tests. */
export const createInMemoryConformanceWorld = async (): Promise<ConformanceWorld> => {
  const engine = await createInMemoryAuthority({
    fixtures: CONFORMANCE_WORLD.fixtures,
    principalLinks: CONFORMANCE_WORLD.principalLinks,
    orgAdmins: CONFORMANCE_WORLD.orgAdmins,
  });
  const material = await engine.verificationKey();
  const key = await ed25519VerifyKey(material.keyId, material.publicKey);
  return { runtime: engine.runtime, keys: new Map([[key.keyId, key]]) };
};

export {
  DANA_OKAFOR,
  FESTIVAL,
  FESTIVAL_BOOTH_COUNT,
  HARBOR_LOGISTICS,
  MERIDIAN,
  PROFESSIONAL_OPERATION,
};
