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
export {
  DANA_OKAFOR,
  FESTIVAL,
  FESTIVAL_BOOTH_COUNT,
  HARBOR_LOGISTICS,
  PROFESSIONAL_OPERATION,
  TWINS,
} from "./twins.ts";

export { createInMemoryAuthority } from "./engine.ts";
export type {
  ClockLike,
  InMemoryAuthorityConfig,
  InMemoryAuthorityHandle,
  SignerLike,
  VerificationKeyMaterial,
} from "./engine.ts";

export type {
  AccessEnvelopeClaimsV1,
  ActorId,
  Failure,
  FailureKind,
  IdempotencyKey,
  JsonValue,
  OperationId,
  OrganizationId,
  RefreshHandle,
  RefreshHandleOutcome,
  SiteBinding,
  SiteId,
  SignedAccessEnvelope,
  TeamId,
} from "../contract.ts";
export {
  ACCESS_ENVELOPE_FORMAT,
  ACCESS_ENVELOPE_VERSION,
  canonicalJson,
} from "../contract.ts";
