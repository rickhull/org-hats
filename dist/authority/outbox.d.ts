import { type EpochSeconds, type OperationId, type OrganizationId } from "../contract.js";
import type { OpState, OrgState, OutboxMessage } from "./state.js";
export interface OutboxDelivery {
    readonly orgs: Map<OrganizationId, OrgState>;
    readonly ops: Map<OperationId, OpState>;
    readonly outbox: OutboxMessage[];
    readonly delivered: Set<string>;
    /** Consume one injected transport failure; true when this attempt failed
     * and the message must stay pending and retryable. */
    failTransport(): boolean;
    readonly now: () => EpochSeconds;
}
/** Deliver every pending message that a transport attempt admits. Returns
 * the delivered count. Messages are attempted in arrival order, and a
 * delivered message leaves the outbox. */
export declare const deliverPending: (state: OutboxDelivery) => Promise<number>;
