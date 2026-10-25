// What a consumer sees, compiled against the published declarations.
//
// Not a `node:test` file: nothing here runs. It is a type-level fence,
// compiled by `bin/check` against `dist/`, and its only job is to fail the
// build if the public surface stops accepting plain strings.
//
// This exists because the five id types are branded inside the package
// (src/contract.ts). Branding is a compile-time-only change — the wire
// format does not move — but only as long as the consumer-facing types stay
// plain. A host holds ids it read from its own database and must be able to
// pass them without importing a constructor. The `AssertPlainId` blocks in
// `src/` assert that from the inside; this asserts it from the outside,
// against the artifacts a consumer installs.

import { AUTHORITY_INTERFACE_VERSION } from "../dist/authority/index.js";
import type {
  OrganizationId as RootOrganizationId,
  ActorId as RootActorId,
  OperationId as RootOperationId,
  SiteId as RootSiteId,
  TeamId as RootTeamId,
  Unbranded as RootUnbranded,
} from "../dist/index.js";
import type {
  AccessEnvelopeClaimsV1,
  AuthorityCommand,
  AuthorityContext,
  FailureKind,
  PrincipalEvidence,
} from "../dist/authority/index.js";
import type { NeutralAccess, TargetRef, VerifyContext } from "../dist/access/index.js";

// ids as a host holds them: plain strings from its own records
const organizationId: string = "org-from-the-hosts-database";
const actorId: string = "actor-from-the-hosts-database";
const teamId: string = "team-from-the-hosts-database";
const siteId: string = "site-from-the-hosts-database";
const operationId: string = "op-from-the-hosts-database";

export const command: AuthorityCommand = {
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  idempotencyKey: "k-1",
  authorization: { kind: "fresh-evidence", evidence: { provider: "idp", subject: "s" }, operationId },
  kind: "grant-hat",
  operationId,
  organizationId,
  actorId,
  role: "field",
  target: { kind: "team", teamId },
};

export const evidence: PrincipalEvidence = { provider: "idp", subject: "s" };

export const teamTarget: TargetRef = { kind: "team", teamId };
export const siteTarget: TargetRef = { kind: "site", siteId };

export const verifyContext: VerifyContext = {
  now: 0,
  expectedOperationId: operationId,
  expectedSiteId: siteId,
};

/** Every id a verifier hands back is a plain string a host can compare
 * against its own records. */
export const readClaims = (claims: AccessEnvelopeClaimsV1): string[] => [
  claims.operationId,
  claims.actor.organizationId,
  claims.actor.actorId,
  ...claims.memberTeamIds,
  ...claims.readableOrganizationIds,
  ...claims.readableTeamIds,
  ...claims.configurableSiteIds,
  ...claims.hat.teamIds,
  ...claims.hat.siteIds,
  ...claims.sites.map((site) => site.siteId),
];

export const readAccess = (access: NeutralAccess): boolean =>
  access.mayAct("observe", teamTarget) &&
  access.mayConfigure(siteId) &&
  access.readableOrganizationIds().every((id: string) => id.length > 0) &&
  access.readableTeamIds().every((id: string) => id.length > 0) &&
  access.memberTeamIds().every((id: string) => id.length > 0) &&
  access.authenticatedWith().every((method: string) => method.length > 0) &&
  typeof access.authenticatedAt() !== "object" &&
  access.actor().organizationId === organizationId &&
  access.actor().actorId === actorId &&
  access.operationId === operationId;

// A root consumer can name the id aliases without importing a subpath.
// The root is the core model, and the model's ids are the branded ones;
// a host holding its own plain strings annotates with the `Unbranded`
// composition — never a constructor.
const namedOrg: RootUnbranded<RootOrganizationId> = organizationId;
const namedActor: RootUnbranded<RootActorId> = actorId;
const namedOperation: RootUnbranded<RootOperationId> = operationId;
const namedSite: RootUnbranded<RootSiteId> = siteId;
const namedTeam: RootUnbranded<RootTeamId> = teamId;
const fixtureShape: RootUnbranded<RootOrganizationId> = organizationId;
export const namedIds = [namedOrg, namedActor, namedOperation, namedSite, namedTeam, fixtureShape];

export const readContext = (context: AuthorityContext): string[] => [
  context.operationId,
  context.actor.organizationId,
  context.actor.actorId,
  // a hat reaches exactly one target, and the union says which
  ...context.wearableHats.map((hat) =>
    hat.target.kind === "team" ? hat.target.teamId : hat.target.siteId,
  ),
];

/** The host owns the product response to every failure kind. `satisfies`
 * checks the map covers the closed taxonomy without widening it, so adding
 * a kind fails this build until every kind has a sentence here. */
export const productResponse = {
  unavailable: "The operation directory is unreachable — try again shortly.",
  unauthenticated: "Sign in to continue.",
  "not-admitted": "Your organization is not part of this operation.",
  expired: "Your session has expired — sign in again.",
  "wrong-interface-version": "This client is out of date — reload.",
  "wrong-binding": "This session belongs to another operation or site.",
  "invalid-signature": "Your session could not be verified — sign in again.",
  "invalid-command": "That request was not understood.",
  denied: "You do not have permission to do that.",
} satisfies Record<FailureKind, string>;
