import { type ActorId, type OperationId, type OrganizationId } from "../contract.js";
import { type Snapshot } from "../model.js";
import type { TwinFixture } from "./twins.js";
import type { AuthorityRuntime } from "./types.js";
import { type Clock, type Signer } from "./internal.js";
export interface SignerLike extends Signer {
}
export interface ClockLike extends Clock {
}
/** Administration is deployment policy, never a hardcoded role title: the
 * host states which role titles administer an operation and which actors
 * administer an organization. */
export interface InMemoryAuthorityConfig {
    readonly fixtures?: readonly TwinFixture[];
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
/** What verifiers receive before issuance: the public half of the signing
 * key. The private key never leaves the engine. */
export interface VerificationKeyMaterial {
    readonly keyId: string;
    readonly algorithm: string;
    /** Standard base64 raw public bytes. */
    readonly publicKey: string;
}
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
    /** The organization's invitation inbox, by invitation id. */
    invitationsOf(organizationId: OrganizationId): ReadonlyMap<string, {
        operationId: OperationId;
        status: string;
    }>;
}
export declare const createInMemoryAuthority: (config?: InMemoryAuthorityConfig) => Promise<InMemoryAuthorityHandle>;
