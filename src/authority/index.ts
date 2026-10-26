// The portable authority engine — a deep module, not a repository.
//
// Charter (docs/authority_redesign.md § Authority): it owns the complete
// organizational use cases — participation workflows, admission and grants,
// hat selection, evidence resolution, refresh and envelope issuance — behind
// one runtime interface with a closed failure taxonomy. Persistence is an
// internal seam; the in-memory adapter ships beside it in this package and
// no adapter SPI is published.
//
// The normative specification: the runtime surface, the policy-bundle
// vocabulary, and the synthetic twins as data. The in-memory engine
// implements these types; nothing here is speculative.
//
// Bootstrapping a test or local world: `org-hats/conformance` exposes
// CONFORMANCE_WORLD (fixtures, principal links, org admins) and
// createInMemoryConformanceWorld(). That world returns a built verifier
// map, which is right for exercising verification; use `verificationKey()`
// material when the test is key-configuration parsing. A host's own world
// enters through `defineWorld`, which validates before the engine loads it.

export type {
  AccessFromEvidenceInput,
  AccessIssue,
  AdmissionCommand,
  AuthorityCommand,
  AuthorityCommandBody,
  AuthorityContext,
  AuthorityRuntime,
  CommandAuthorization,
  CommandReceipt,
  CommandResult,
  ContextRequest,
  GrantCommand,
  HatSummary,
  OrganizationCommand,
  ParticipationCommand,
  PrincipalEvidence,
  RefreshInput,
} from "./types.ts";
export { AUTHORITY_INTERFACE_VERSION } from "./types.ts";

export type {
  OrganizationReadPolicy,
  PolicyBundle,
  PolicyProblem,
  PolicyRole,
  ReadPolicy,
} from "../policy.ts";
export { actionsOf, validatePolicyBundle } from "../policy.ts";

export type { TwinFixture } from "./twins.ts";
export type { WorldDefinition, WorldFixture } from "./world.ts";
export { defineWorld } from "./world.ts";
export {
  AIRLIFT,
  DANA_OKAFOR,
  FESTIVAL,
  FESTIVAL_BOOTH_COUNT,
  HARBOR_LOGISTICS,
  PROFESSIONAL_OPERATION,
  TWINS,
} from "./twins.ts";

export { createInMemoryAuthority } from "./engine.ts";
export { assembleAccessClaims } from "./claims.ts";
export type { AccessClaimsInput, AuthenticationFacts } from "./claims.ts";export type {
  ClockLike,
  InMemoryAuthorityConfig,
  InMemoryAuthorityHandle,
  SignerLike,
  VerificationKeyMaterial,
} from "./engine.ts";

export type {
  AccessEnvelopeClaimsV1,
  ActorId,
  EpochSeconds,
  Failed,
  Failure,
  GrantTarget,
  FailureKind,
  IdempotencyKey,
  IssuerInterfaceVersion,
  JsonValue,
  OperationId,
  OrganizationId,
  RefreshHandle,
  RefreshHandleOutcome,
  SiteBinding,
  SiteId,
  SignedAccessEnvelope,
  TeamId,
  Unbranded,
} from "../contract.ts";
export {
  ACCESS_ENVELOPE_FORMAT,
  ACCESS_ENVELOPE_VERSION,
  actorId,
  canonicalJson,
  epochSeconds,
  isFailed,
  operationId,
  organizationId,
  siteId,
  teamId,
} from "../contract.ts";
