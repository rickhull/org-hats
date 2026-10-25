// The outbox between the two coordinators: visible partial state and
// retryable delivery, never a distributed transaction.
//
// Delivery is the only place a message crosses from one coordinator's fact
// space to the other's. `kind` decides the destination and the conversion
// from the message's plain-string address happens here — the runtime's own
// seam, not a second one.

import { operationId, organizationId, type EpochSeconds, type OperationId, type OrganizationId } from "../contract.ts";
import { applyParticipationEvent } from "../model.ts";
import type { OpState, OrgState, OutboxMessage } from "./state.ts";

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
export const deliverPending = async (state: OutboxDelivery): Promise<number> => {
  let count = 0;
  for (const message of [...state.outbox]) {
    if (state.failTransport()) continue;
    if (state.delivered.has(message.id)) continue;
    if (message.kind === "invitation" && message.invitationId !== undefined && message.operationId !== undefined) {
      // the outbox address is a plain string because a message routes to
      // either coordinator; `kind` says which, so the conversion is here
      const org = state.orgs.get(organizationId(message.target));
      if (org !== undefined && !org.invitations.has(message.invitationId)) {
        org.invitations.set(message.invitationId, { operationId: message.operationId, status: "pending" });
      }
    }
    if (message.kind === "acceptance" && message.invitationId !== undefined) {
      const op = state.ops.get(operationId(message.target));
      const invitation = op?.invitations.get(message.invitationId);
      if (op !== undefined && invitation !== undefined && invitation.status === "invited") {
        // Two events, in the model's order: the organization accepted, and
        // the operation activates. Jumping straight to `active` is what let
        // an acceptance delivered after a revoke flip `revoked` back —
        // `transitionParticipation` refuses both steps from `revoked`, so
        // the delivery is now a no-op against a terminal state.
        const accepted = applyParticipationEvent(
          op.participations,
          invitation.organizationId,
          op.operationId,
          { kind: "accept", by: "organization" },
        );
        if (!accepted.ok) {
          op.audit.push({ at: state.now(), by: "outbox", fact: `acceptance for ${invitation.organizationId} not applied: ${accepted.problem}` });
        } else {
          const activated = applyParticipationEvent(
            accepted.participations,
            invitation.organizationId,
            op.operationId,
            { kind: "activate", by: "operation" },
          );
          if (!activated.ok) {
            op.audit.push({ at: state.now(), by: "outbox", fact: `activation for ${invitation.organizationId} not applied: ${activated.problem}` });
          } else {
            invitation.status = "accepted";
            op.participations = [...activated.participations];
            op.audit.push({ at: state.now(), by: "outbox", fact: `participation ${invitation.organizationId} active (canonical)` });
          }
        }
      }
    }
    if (message.kind === "actor-disabled" && message.operationId !== undefined) {
      const op = state.ops.get(operationId(message.target));
      if (op !== undefined) {
        for (const record of op.refreshRecords) {
          if (record.organizationId === message.organizationId && record.actorId === message.actorId) {
            record.revoked = true;
          }
        }
      }
    }
    state.delivered.add(message.id);
    state.outbox.splice(state.outbox.indexOf(message), 1);
    count += 1;
  }
  return count;
};
