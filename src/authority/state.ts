// The two coordinators' state shapes and the pure helpers they share.
//
// The in-memory engine is one process, so the organization coordinator and
// the operation coordinator hold their facts in two maps but can read each
// other for the checks the reference world does locally. The types make the
// ownership explicit: actors, principal links, invitations, and org audits
// are organization-side; sites, teams, grants, policy, refresh records,
// access requests, and op audits are operation-side. Participation is the
// one fact both sides carry, by design — the two halves meet at the model's
// transition function.
//
// Everything here is pure: no clock, signer, or storage. The coordinators
// supply those.

import {
  canonicalJson,
  type ActorId,
  type EpochSeconds,
  type IdempotencyKey,
  type JsonValue,
  type OperationId,
  type OrganizationId,
  type SiteId,
  type TeamId,
} from "../contract.ts";
import {
  applyParticipationEvent,
  type Grant,
  type Participation,
  type Snapshot,
} from "../model.ts";
import type { PolicyBundle } from "../policy.ts";
import type { AuthorityCommand, CommandResult } from "./types.ts";
import { fail, ok } from "./result.ts";

export interface AuditEvent {
  readonly at: EpochSeconds;
  readonly by: string;
  readonly fact: string;
}

export interface Claim {
  readonly payloadHash: string;
  readonly receiptApplied: boolean;
}

export interface OrgState {
  readonly organizationId: OrganizationId;
  readonly displayName?: string;
  actors: { organizationId: OrganizationId; actorId: ActorId; displayName?: string; disabled?: boolean }[];
  /** Administrator standing, seeded at bootstrap and changed only by the
   * organization's own appoint/retire commands. */
  admins: ActorId[];
  /** Org-side invitations received from operations, by invitation id. */
  invitations: Map<string, { operationId: OperationId; status: "pending" | "accepted" }>;
  audit: AuditEvent[];
  claims: Map<IdempotencyKey, Claim>;
  activationRequests: ActivationRequest[];
}

export interface ActivationRequest {
  readonly requestId: string;
  readonly organizationId: OrganizationId;
  readonly actorId: ActorId;
  readonly secretHash: string;
  readonly issuedAt: EpochSeconds;
  readonly expiresAt: EpochSeconds;
  consumedAt?: EpochSeconds;
  revokedAt?: EpochSeconds;
}

export interface RefreshRecord {
  readonly handleHash: string;
  readonly operationId: OperationId;
  readonly organizationId: OrganizationId;
  readonly actorId: ActorId;
  /** The authentication facts of the issuing evidence; every refresh of
   * this handle chain re-issues them unchanged. */
  readonly amr?: readonly string[];
  readonly authTime?: number;
  revoked: boolean;
  superseded: boolean;
}

export interface OpState {
  readonly operationId: OperationId;
  readonly displayName?: string;
  readonly slug?: string;
  readonly bounded?: boolean;
  policy: PolicyBundle;
  sites: { siteId: SiteId; operationId: OperationId; displayName?: string; path?: string; aliases: readonly string[] }[];
  teams: { teamId: TeamId; siteId: SiteId; organizationId: OrganizationId; displayName?: string }[];
  grants: Grant[];
  participations: Participation[];
  /** Op-side invitation records, by invitation id. */
  invitations: Map<string, { organizationId: OrganizationId; status: "invited" | "accepted" }>;
  refreshRecords: RefreshRecord[];
  accessRequests: { requestId: string; organizationId: OrganizationId; actorId: ActorId; note?: string }[];
  audit: AuditEvent[];
  claims: Map<IdempotencyKey, Claim>;
}

export interface OutboxMessage {
  readonly id: string;
  readonly target: string;
  readonly kind: "invitation" | "acceptance" | "actor-disabled" | "actor-unlinked";
  readonly invitationId?: string;
  readonly operationId?: OperationId;
  readonly organizationId?: OrganizationId;
  readonly actorId?: ActorId;
}

/** A resolved caller, after evidence or envelope verification. */
export interface Principal {
  readonly organizationId: OrganizationId;
  readonly actorId: ActorId;
  readonly adminOfOperation: boolean;
  readonly adminOfOrganization: boolean;
}

/** The shape both coordinators' command surfaces expose. The engine gates a
 * call (version, delivery, principal resolution) before handing it to the
 * coordinator that owns the act; the coordinator owns authorization,
 * idempotency, and the mutation. One shape means a handler can move between
 * coordinators without changing the dispatch. */
export type CommandHandler = (input: AuthorityCommand, principal: Principal) => CommandResult;

export interface PrincipalLink {
  readonly organizationId: OrganizationId;
  readonly actorId: ActorId;
}

/** The principal-link key: the (provider, subject) pair encoded as JSON, so
 * no split of the two strings can collide with another — ":" concatenation
 * made `"a:b"/"c"` and `"a"/"b:c"` the same link. */
export const principalKey = (provider: string, subject: string): string => JSON.stringify([provider, subject]);

/** Assemble one operation's view. Every list is copied: the snapshot is a
 * caller's to hold and mutate, and a shared array would make engine state
 * the caller's to corrupt. `readonly` on the type says the same thing; this
 * is the runtime half. */
export const snapshotOf = (
  ops: ReadonlyMap<OperationId, OpState>,
  orgs: ReadonlyMap<OrganizationId, OrgState>,
  operationId: OperationId,
): Snapshot | undefined => {
  const op = ops.get(operationId);
  if (op === undefined) return undefined;
  return {
    organizations: [...orgs.values()].map((org) => ({
      organizationId: org.organizationId,
      ...(org.displayName !== undefined ? { displayName: org.displayName } : {}),
    })),
    actors: [...orgs.values()].flatMap((org) => org.actors.map((actor) => ({ ...actor }))),
    operations: [...ops.values()].map((o) => ({
      operationId: o.operationId,
      ...(o.displayName !== undefined ? { displayName: o.displayName } : {}),
      ...(o.slug !== undefined ? { slug: o.slug } : {}),
      ...(o.bounded !== undefined ? { bounded: o.bounded } : {}),
    })),
    sites: [...op.sites],
    teams: [...op.teams],
    grants: [...op.grants],
    participations: [...op.participations],
  };
};

export const payloadHash = (command: AuthorityCommand): string => {
  const { idempotencyKey: _k, authorization: _a, ...rest } = command;
  return canonicalJson(rest as JsonValue);
};

/** A retry claims its earlier result; the same key with a different payload
 * is a misuse, not a retry. Checking is pure — the claim is committed with
 * the mutation it guards, so a denied command never poisons its key. */
export const checkClaim = (
  claims: Map<IdempotencyKey, Claim>,
  command: AuthorityCommand,
): CommandResult | undefined => {
  const existing = claims.get(command.idempotencyKey);
  if (existing === undefined) return undefined;
  if (existing.payloadHash !== payloadHash(command)) {
    return fail("invalid-command", "idempotency key reused with a different payload");
  }
  return ok(command.idempotencyKey, false);
};

export const commitClaim = (claims: Map<IdempotencyKey, Claim>, command: AuthorityCommand): void => {
  claims.set(command.idempotencyKey, { payloadHash: payloadHash(command), receiptApplied: true });
};

/** Revoke one organization's participation through the state machine.
 *
 * Revoking twice is a safe retry rather than a failure: the state the caller
 * asked for is the state that holds, and a retry under a fresh idempotency
 * key must not read as an error. "Not participating" is a different thing
 * and stays a denial. Whether a repeat is idempotent is the adapter's
 * policy; that `revoked` never moves back is the model's, and
 * `applyParticipationEvent` is what enforces it. */
export const revokeParticipation = (
  op: OpState,
  organizationId: OrganizationId,
  by: "operation" | "organization",
): { ok: true } | { ok: false; problem: string } => {
  const current = op.participations.find(
    (p) => p.organizationId === organizationId && p.operationId === op.operationId,
  );
  if (current === undefined) return { ok: false, problem: "the organization is not participating" };
  if (current.status === "revoked") return { ok: true };
  const revoked = applyParticipationEvent(op.participations, organizationId, op.operationId, {
    kind: "revoke",
    by,
  });
  if (!revoked.ok) return revoked;
  op.participations = [...revoked.participations];
  return { ok: true };
};

export const revokeRefreshRecords = (
  op: OpState,
  organizationId: OrganizationId,
  actorId: ActorId,
): void => {
  for (const record of op.refreshRecords) {
    if (record.organizationId === organizationId && record.actorId === actorId) record.revoked = true;
  }
};
