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
  AccessEnvelopeClaimsV1,
  AuthorityCommand,
  AuthorityContext,
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
  access.operationId === operationId;

export const readContext = (context: AuthorityContext): string[] => [
  context.operationId,
  context.actor.organizationId,
  context.actor.actorId,
  // a hat reaches exactly one target, and the union says which
  ...context.wearableHats.map((hat) =>
    hat.target.kind === "team" ? hat.target.teamId : hat.target.siteId,
  ),
];
