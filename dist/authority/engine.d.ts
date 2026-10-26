import { type ActorId, type OperationId, type OrganizationId, type VerificationKeyMaterial } from "../contract.js";
import type { Snapshot } from "../model.js";
import { type Clock, type Signer } from "./internal.js";
import type { WorldFixture } from "./world.js";
import type { AuthorityRuntime } from "./types.js";
export type SignerLike = Signer;
export type ClockLike = Clock;
/** Administration is deployment policy, never a hardcoded role title: the
 * host states which role titles administer an operation and which actors
 * administer an organization. An operation with no declared `adminRoles` has
 * no administering role title — administration then rests solely on holding
 * a hat that carries one of `configureActions`. */
export interface InMemoryAuthorityConfig {
    readonly fixtures?: readonly WorldFixture[];
    /** Verified-principal links created at bootstrap: evidence resolution
     * never creates an actor or a link implicitly. */
    readonly principalLinks?: readonly {
        readonly provider: string;
        readonly subject: string;
        readonly organizationId: OrganizationId;
        readonly actorId: ActorId;
    }[];
    /** Defaults to the wall clock. Tests inject a fixed clock for
     * determinism; verifiers should pass `now` when the issuer's clock is
     * not the verifier's. */
    readonly clock?: ClockLike;
    /** Defaults to a fresh Ed25519 key with a distinct id per engine. The
     * in-memory engine is single-signer; rotation is the Cloudflare runtime's
     * concern (T6.4). */
    readonly signer?: SignerLike;
    readonly envelopeLifetimeSeconds?: number;
    /** Actions that confer site-configuration reach (default `["configure"]`). */
    readonly configureActions?: readonly string[];
    readonly adminRoles?: Readonly<Record<OperationId, readonly string[]>>;
    readonly orgAdmins?: Readonly<Record<OrganizationId, readonly ActorId[]>>;
    /** Fault injection: the first N outbox deliveries fail and stay pending. */
    readonly transportFailures?: number;
}
export type { VerificationKeyMaterial } from "../contract.js";
export interface InMemoryAuthorityHandle {
    readonly runtime: AuthorityRuntime;
    /** The public verification key to distribute to verifiers before issuance. */
    verificationKey(): Promise<VerificationKeyMaterial>;
    /** Deliver pending outbox messages (retries included); returns delivered count. */
    drainOutbox(): Promise<number>;
    /** Messages still awaiting delivery — the visible partial state. */
    pendingOutbox(): number;
    /** Assemble the operation's current view as a model Snapshot. */
    snapshotOf(operationId: OperationId): Snapshot | undefined;
    /** The operation's pending access requests, copied — the administrator's
     * `admit` queue, each with the requester's note when one was sent. */
    accessRequestsOf(operationId: OperationId): readonly {
        requestId: string;
        organizationId: OrganizationId;
        actorId: ActorId;
        note?: string;
    }[];
    /** The organization's invitation inbox, by invitation id. */
    invitationsOf(organizationId: OrganizationId): ReadonlyMap<string, {
        operationId: OperationId;
        status: string;
    }>;
}
export declare const createInMemoryAuthority: (config?: InMemoryAuthorityConfig) => Promise<InMemoryAuthorityHandle>;
