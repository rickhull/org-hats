// The neutral access surface — what verification yields.
//
// The vocabulary is fixed and domain-neutral (docs/authority_redesign.md
// § Access): operation and site binding, the selected hat's actions over a
// neutral target, the organization and exceptional team ids readable under
// the active policy, and configuration reach. The module never names a
// product entity: product verbs — a host's `mayReadReport`, for example —
// are host code that maps product facts onto these targets.
//
// The verifier that produces this from a signed envelope ships beside it.

import type {
  AccessEnvelopeClaimsV1,
  OperationId,
  OrganizationId,
  SiteBinding,
  SiteId,
  TargetRef,
  TeamId,
  Unbranded,
} from "../contract.ts";

export type { TargetRef } from "../contract.ts";

/** What a verified envelope yields: binding facts plus predicates. Callers
 * never see raw claims and never rebuild reach, fallback, or worn-hat rules. */
export interface NeutralAccess {
  readonly operationId: Unbranded<OperationId>;
  readonly sites: readonly SiteBinding[];
  /** The selected hat carries the action and its reach covers the target. */
  mayAct(action: string, target: TargetRef): boolean;
  /** Organizations whose work is readable under the active policy, as
   * computed by the issuer. */
  readableOrganizationIds(): readonly Unbranded<OrganizationId>[];
  /** Exceptional team grants only — never an expanded list of every
   * readable team. */
  readableTeamIds(): readonly Unbranded<TeamId>[];
  /** Site-configuration reach. */
  mayConfigure(siteId: Unbranded<SiteId>): boolean;
  /** Epoch seconds; authorization changes take effect at expiry. */
  expiresAt(): number;
}

// A host reads these and compares them against its own record ids, so they
// must be plain strings. Erased at compile time.
type AcceptsPlainString<T> = string extends T ? true : false;
type Assert<T extends true> = T;

type _OperationIdIsPlain = Assert<AcceptsPlainString<NeutralAccess["operationId"]>>;
type _ReadableOrganizationsArePlain = Assert<
  AcceptsPlainString<ReturnType<NeutralAccess["readableOrganizationIds"]>[number]>
>;
type _ReadableTeamsArePlain = Assert<
  AcceptsPlainString<ReturnType<NeutralAccess["readableTeamIds"]>[number]>
>;
type _MayConfigureTakesPlain = Assert<
  AcceptsPlainString<Parameters<NeutralAccess["mayConfigure"]>[0]>
>;

/** The verified claims, for hosts that must persist or forward them. Product
 * code reaches for `NeutralAccess`, not this. */
export type VerifiedClaims = AccessEnvelopeClaimsV1;
