import { type AccessEnvelopeClaimsV1, type ActorId, type EpochSeconds, type Failure, type OperationId, type OrganizationId } from "../contract.js";
import { type Snapshot } from "../model.js";
import { type PolicyBundle } from "../policy.js";
/** How and when the principal authenticated, as the evidence stated it.
 * Opaque to authority: carried into claims, context, and refresh records,
 * never interpreted. */
export interface AuthenticationFacts {
    readonly amr?: readonly string[];
    readonly authTime?: number;
}
/** Copy the facts a source carried, dropping absent ones rather than
 * inventing a value. The evidence-to-claims and refresh-record-to-claims
 * paths share this so an absent `amr` never becomes `[]` and an absent
 * `auth_time` never becomes zero. */
export declare const authenticationFactsOf: (source: AuthenticationFacts | undefined) => AuthenticationFacts | undefined;
export interface AccessClaimsInput {
    readonly snapshot: Snapshot;
    readonly policy: PolicyBundle;
    readonly operationId: OperationId;
    readonly organizationId: OrganizationId;
    readonly actorId: ActorId;
    /** Actions that confer site-configuration reach, as deployment configured
     * them. */
    readonly configureActions: readonly string[];
    readonly envelopeLifetimeSeconds: number;
    /** Epoch seconds this envelope is issued at; `exp` derives from it. */
    readonly issuedAt: EpochSeconds;
    readonly auth?: AuthenticationFacts;
}
/** The complete claims payload, or the reason no honest hat exists: the
 * actor wears no grant (`not-admitted`) or the grant names a role the bundle
 * does not carry (`unavailable` — an administrator's inconsistency, never an
 * empty action list describing the actor). */
export declare const assembleAccessClaims: (input: AccessClaimsInput) => AccessEnvelopeClaimsV1 | Failure;
