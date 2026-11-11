// The organization coordinator: actors, verified-principal links,
// org-side participation, invitations, and the organization's audit.
//
// It handles the acts the organization owns — accepting or revoking its
// participation and disabling its own actors — and it resolves a caller's
// evidence or envelope into the durable `(organizationId, actorId)` pair
// plus the administration flags both coordinators gate on.
//
// The coordinator reads the operation map for the participation state a
// revoke must move; that read is the reference world's, not a distributed
// one. The deployed shape projects the facts it needs instead.

import {
  actorId,
  asJson,
  canonicalJson,
  parseAccessEnvelope,
  operationId,
  organizationId,
  type AccessEnvelopeClaimsV1,
  type ActorId,
  type Failure,
  type OperationId,
  type OrganizationId,
  type SignedAccessEnvelope,
} from "../contract.ts";
import type { Clock, Signer } from "./internal.ts";
import { sha256Hex } from "./internal.ts";
import type {
  ActivationAcceptInput,
  ActivationAcceptance,
  ActivationInspectInput,
  ActivationInspection,
  ActivationRequestInput,
  ActivationRequestResult,
  AuthorityCommand,
  CommandResult,
  Failed,
  RosterRead,
  RosterRequest,
} from "./types.ts";
import {
  principalKey,
  revokeParticipation,
  checkClaim,
  commitClaim,
  type OpState,
  type OrgState,
  type OutboxMessage,
  type CommandHandler,
  type Principal,
  type PrincipalLink,
} from "./state.ts";
import { fail, ok } from "./result.ts";
import { displayLabelFailure, identifierFailure } from "./validation.ts";

export interface OrganizationDeps {
  readonly orgs: Map<OrganizationId, OrgState>;
  readonly ops: Map<OperationId, OpState>;
  readonly principalLinks: Map<string, PrincipalLink>;
  readonly outbox: OutboxMessage[];
  readonly clock: Clock;
  readonly signer: Signer;
  readonly nextId: () => number;
  readonly adminRoles: Readonly<Record<OperationId, readonly string[]>>;
  readonly configureActions: readonly string[];
  readonly activationLifetime: number;
  readonly activationSecret: () => string;
}

export interface OrganizationCoordinator {
  resolvePrincipal(
    authorization: AuthorityCommand["authorization"],
    boundTo?: OperationId,
  ): Promise<Principal | Failure>;
  command: CommandHandler;
  activationRequest(input: ActivationRequestInput): Promise<ActivationRequestResult | Failed>;
  activationInspect(input: ActivationInspectInput): Promise<ActivationInspection | Failed>;
  activationAccept(input: ActivationAcceptInput): Promise<ActivationAcceptance | Failed>;
  /** The organization roster read: the gate and the actors are this
   * coordinator's; the teams half reads the operation map, the reference
   * world's local read of a fact the deployed shape projects. */
  roster(input: RosterRequest): Promise<RosterRead | Failed>;
}

export const createOrganizationCoordinator = (deps: OrganizationDeps): OrganizationCoordinator => {
  const {
    orgs, ops, principalLinks, outbox, clock, signer, nextId, adminRoles,
    configureActions, activationLifetime, activationSecret,
  } = deps;

  const unusableActivation = (): Failed => ({
    failure: { kind: "unauthenticated", detail: "activation is not usable" },
  });

  const linksTo = (organization: OrganizationId, actor: ActorId): string[] =>
    [...principalLinks.entries()]
      .filter(([, link]) => link.organizationId === organization && link.actorId === actor)
      .map(([key]) => key);

  const revokeActiveRequests = (org: OrgState, target: ActorId): void => {
    const at = clock.now();
    for (const request of org.activationRequests) {
      if (
        request.actorId === target && request.consumedAt === undefined &&
        request.revokedAt === undefined && clock.now() < request.expiresAt
      ) request.revokedAt = at;
    }
  };

  // The one envelope gate. Every envelope-authorized path — command
  // authorization and the roster read — verifies signature and expiry in
  // this one place: a control shared is a control that cannot drift between
  // callers (the reverse defect — a read sitting above the gate — is the one
  // this file already recorded above).
  const envelopeGate = async (
    envelope: SignedAccessEnvelope,
    boundTo?: OperationId,
  ): Promise<{ readonly claims: AccessEnvelopeClaimsV1 } | Failure> => {
    const parsed = parseAccessEnvelope(envelope);
    if ("kind" in parsed) return parsed;
    const { signature, claims } = parsed;
    if (!(await signer.verify(canonicalJson(asJson(claims)), signature))) {
      return { kind: "invalid-signature" };
    }
    if (clock.now() >= claims.exp) return { kind: "expired" };
    if (boundTo !== undefined && claims.operationId !== boundTo) return { kind: "wrong-binding" };
    return { claims };
  };

  const resolvePrincipal = async (
    authorization: AuthorityCommand["authorization"],
    boundTo?: OperationId,
  ): Promise<Principal | Failure> => {
    if (authorization.kind === "fresh-evidence") {
      const link = principalLinks.get(principalKey(authorization.evidence.provider, authorization.evidence.subject));
      if (link === undefined) return { kind: "unauthenticated", detail: "no principal link for this evidence" };
      const org = orgs.get(link.organizationId);
      const actor = org?.actors.find((a) => a.actorId === link.actorId);
      if (org === undefined || actor === undefined) return { kind: "unauthenticated" };
      if (actor.disabled) return { kind: "not-admitted", detail: "actor disabled" };
      return {
        organizationId: link.organizationId,
        actorId: link.actorId,
        adminOfOperation: false,
        adminOfOrganization: org.admins.includes(link.actorId),
      };
    }
    // The claims come from the gate, not from the input beside it. This read
    // used to sit one statement above the gate, which is how a shared control
    // became a defect in one caller and not the others.
    const gated = await envelopeGate(authorization.envelope, boundTo);
    if ("kind" in gated) return gated;
    const { claims } = gated;
    // No declared admin role means no role administers this operation —
    // a visible denial. Falling back to a hardcoded `["admin"]` applied a
    // title this file's own charter says is configuration, and silently
    // granted administration to whoever happened to hold it. Cloudflare's
    // coordinator already reads an undeclared set as empty; this matches it.
    // The command-handler seam: envelope claims carry plain strings, and
    // this is where they become domain ids.
    const claimedOperation = operationId(claims.operationId);
    const claimedOrganization = organizationId(claims.actor.organizationId);
    const claimedActor = actorId(claims.actor.actorId);
    const roles = adminRoles[claimedOperation] ?? [];
    const adminHat = claims.hat.actions.some((a) => configureActions.includes(a)) || roles.includes(claims.hat.role);
    return {
      organizationId: claimedOrganization,
      actorId: claimedActor,
      adminOfOperation: adminHat,
      adminOfOrganization: orgs.get(claimedOrganization)?.admins.includes(claimedActor) ?? false,
    };
  };

  /** The organization-scoped authority preamble. The three modes are
   * deliberately distinct: an envelope may carry disable, recovery and
   * roster writes require fresh evidence, and a same-organization check is
   * part of the recovery/roster modes but not disable's. */
  const organizationAuthority = (
    authorization: AuthorityCommand["authorization"],
    principal: Principal,
    organization: string,
    options: {
      readonly mode: "either" | "fresh";
      readonly sameOrganization: boolean;
      readonly freshDetail?: string;
      readonly unknownDetail?: string;
    },
  ): OrgState | Failed => {
    const org = orgs.get(organizationId(organization));
    if (org === undefined) {
      return {
        failure: {
          kind: "wrong-binding",
          ...(options.unknownDetail !== undefined ? { detail: options.unknownDetail } : {}),
        },
      };
    }
    if (options.mode === "fresh" && authorization.kind !== "fresh-evidence") {
      return { failure: { kind: "denied", detail: options.freshDetail ?? "fresh evidence is required" } };
    }
    if (options.sameOrganization && principal.organizationId !== org.organizationId) {
      return { failure: { kind: "wrong-binding" } };
    }
    if (!principal.adminOfOrganization) {
      return { failure: { kind: "denied", detail: "the caller does not administer this organization" } };
    }
    return org;
  };

  const acceptParticipation = (input: AuthorityCommand, principal: Principal): CommandResult => {
    if (input.kind !== "participation-accept") return fail("invalid-command", "wrong coordinator");
    const org = organizationAuthority(input.authorization, principal, principal.organizationId, {
      mode: "either",
      sameOrganization: false,
    });
    if ("failure" in org) return { ok: false, failure: org.failure };
    const replay = checkClaim(org.claims, input);
    if (replay !== undefined) return replay;
    const found = [...org.invitations.entries()].find(
      ([, invitation]) => invitation.operationId === input.operationId,
    );
    const invitationId = found?.[0];
    const invitation = found?.[1];
    if (invitationId === undefined || invitation === undefined) return fail("denied", "no such invitation");
    if (invitation.status !== "pending") return fail("denied", `invitation already ${invitation.status}`);
    commitClaim(org.claims, input);
    invitation.status = "accepted";
    const op = ops.get(invitation.operationId);
    if (op !== undefined) {
      outbox.push({
        id: `ob-${nextId()}`, target: invitation.operationId,
        kind: "acceptance", invitationId,
        operationId: invitation.operationId, organizationId: org.organizationId,
      });
    }
    org.audit.push({ at: clock.now(), by: `${org.organizationId}/${principal.actorId}`, fact: `invitation ${invitationId} accepted` });
    return ok(input.idempotencyKey, true);
  };

  const revokeOrganizationParticipation = (input: AuthorityCommand, principal: Principal): CommandResult => {
    if (input.kind !== "participation-revoke") return fail("invalid-command", "wrong coordinator");
    if (input.by !== "organization") return fail("invalid-command", "wrong coordinator");
    const org = organizationAuthority(input.authorization, principal, input.organizationId, {
      mode: "either",
      sameOrganization: false,
      unknownDetail: "unknown organization",
    });
    if ("failure" in org) return { ok: false, failure: org.failure };
    const replay = checkClaim(org.claims, input);
    if (replay !== undefined) return replay;
    const op = ops.get(operationId(input.operationId));
    if (op === undefined) return fail("wrong-binding", "unknown operation");
    const revoked = revokeParticipation(op, organizationId(input.organizationId), "organization");
    if (!revoked.ok) return fail("denied", revoked.problem);
    commitClaim(org.claims, input);
    for (const record of op.refreshRecords) {
      if (record.organizationId === input.organizationId) record.revoked = true;
    }
    org.audit.push({ at: clock.now(), by: `${org.organizationId}/${principal.actorId}`, fact: `participation in ${input.operationId} revoked` });
    return ok(input.idempotencyKey, true);
  };

  const disableActor = (input: AuthorityCommand, principal: Principal): CommandResult => {
    if (input.kind !== "disable-actor") return fail("invalid-command", "wrong coordinator");
    const org = organizationAuthority(input.authorization, principal, input.organizationId, {
      mode: "either",
      sameOrganization: false,
      unknownDetail: "unknown organization",
    });
    if ("failure" in org) return { ok: false, failure: org.failure };
    const replay = checkClaim(org.claims, input);
    if (replay !== undefined) return replay;
    const actor = org.actors.find((a) => a.actorId === input.actorId);
    if (actor === undefined) return fail("invalid-command", "unknown actor");
    commitClaim(org.claims, input);
    actor.disabled = true;
    revokeActiveRequests(org, actor.actorId);
    for (const op of ops.values()) {
      outbox.push({
        id: `ob-${nextId()}`, target: op.operationId, operationId: op.operationId,
        kind: "actor-disabled", organizationId: org.organizationId, actorId: actorId(input.actorId),
      });
    }
    org.audit.push({ at: clock.now(), by: `${org.organizationId}/${principal.actorId}`, fact: `actor ${input.actorId} disabled` });
    return ok(input.idempotencyKey, true);
  };

  const revokeActivation = (input: AuthorityCommand, principal: Principal): CommandResult => {
    if (input.kind !== "revoke-activation") return fail("invalid-command", "wrong coordinator");
    const org = organizationAuthority(input.authorization, principal, input.organizationId, {
      mode: "fresh",
      sameOrganization: true,
      freshDetail: "activation recovery requires fresh evidence",
      unknownDetail: "unknown organization",
    });
    if ("failure" in org) return { ok: false, failure: org.failure };
    const replay = checkClaim(org.claims, input);
    if (replay !== undefined) return replay;
    const target = org.actors.find((candidate) => candidate.actorId === input.actorId);
    if (target === undefined) return fail("invalid-command", "unknown actor");
    revokeActiveRequests(org, target.actorId);
    commitClaim(org.claims, input);
    org.audit.push({
      at: clock.now(),
      by: `${org.organizationId}/${principal.actorId}`,
      fact: `activation for actor ${target.actorId} revoked`,
    });
    return ok(input.idempotencyKey, true);
  };

  const unlinkPrincipal = (input: AuthorityCommand, principal: Principal): CommandResult => {
    if (input.kind !== "unlink-principal") return fail("invalid-command", "wrong coordinator");
    const org = organizationAuthority(input.authorization, principal, input.organizationId, {
      mode: "fresh",
      sameOrganization: true,
      freshDetail: "principal recovery requires fresh evidence",
      unknownDetail: "unknown organization",
    });
    if ("failure" in org) return { ok: false, failure: org.failure };
    const replay = checkClaim(org.claims, input);
    if (replay !== undefined) return replay;
    const target = org.actors.find((candidate) => candidate.actorId === input.actorId);
    if (target === undefined) return fail("invalid-command", "unknown actor");
    for (const key of linksTo(org.organizationId, target.actorId)) principalLinks.delete(key);
    revokeActiveRequests(org, target.actorId);
    for (const op of ops.values()) {
      outbox.push({
        id: `ob-${nextId()}`,
        target: op.operationId,
        operationId: op.operationId,
        kind: "actor-unlinked",
        organizationId: org.organizationId,
        actorId: target.actorId,
      });
    }
    commitClaim(org.claims, input);
    org.audit.push({
      at: clock.now(),
      by: `${org.organizationId}/${principal.actorId}`,
      fact: `principal links for actor ${target.actorId} removed`,
    });
    return ok(input.idempotencyKey, true);
  };

  // A roster or standing command is an organization-scoped write authorized
  // by fresh evidence from one of that organization's administrators. An
  // access envelope belongs to an operation and cannot carry it.
  const rosterAuthority = (
    authorization: AuthorityCommand["authorization"],
    organization: string,
    principal: Principal,
  ): OrgState | Failed => organizationAuthority(authorization, principal, organization, {
    mode: "fresh",
    sameOrganization: true,
    freshDetail: "roster changes require fresh evidence",
    unknownDetail: "unknown organization",
  });

  const createActor = (input: AuthorityCommand, principal: Principal): CommandResult => {
    if (input.kind !== "create-actor") return fail("invalid-command", "wrong coordinator");
    const org = rosterAuthority(input.authorization, input.organizationId, principal);
    if ("failure" in org) return { ok: false, failure: org.failure };
    const replay = checkClaim(org.claims, input);
    if (replay !== undefined) return replay;
    const idFailure = identifierFailure(input.actorId, "actor id");
    if (idFailure !== undefined) return { ok: false, failure: idFailure };
    if (input.displayName !== undefined) {
      const nameFailure = displayLabelFailure(input.displayName, "display name");
      if (nameFailure !== undefined) return { ok: false, failure: nameFailure };
    }
    if (org.actors.some((actor) => actor.actorId === input.actorId)) {
      return fail("invalid-command", "actor already exists");
    }
    org.actors.push({
      organizationId: org.organizationId,
      actorId: actorId(input.actorId),
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    });
    commitClaim(org.claims, input);
    org.audit.push({
      at: clock.now(),
      by: `${org.organizationId}/${principal.actorId}`,
      fact: `actor ${input.actorId} created`,
    });
    return ok(input.idempotencyKey, true);
  };

  const updateActor = (input: AuthorityCommand, principal: Principal): CommandResult => {
    if (input.kind !== "update-actor") return fail("invalid-command", "wrong coordinator");
    const org = rosterAuthority(input.authorization, input.organizationId, principal);
    if ("failure" in org) return { ok: false, failure: org.failure };
    const replay = checkClaim(org.claims, input);
    if (replay !== undefined) return replay;
    const nameFailure = displayLabelFailure(input.displayName, "display name");
    if (nameFailure !== undefined) return { ok: false, failure: nameFailure };
    const target = org.actors.find((candidate) => candidate.actorId === input.actorId);
    if (target === undefined) return fail("invalid-command", "unknown actor");
    const changed = (target.displayName ?? null) !== input.displayName;
    if (changed) {
      if (input.displayName === null) delete target.displayName;
      else target.displayName = input.displayName;
    }
    commitClaim(org.claims, input);
    if (changed) {
      org.audit.push({
        at: clock.now(),
        by: `${org.organizationId}/${principal.actorId}`,
        fact: `actor ${input.actorId} display name updated`,
      });
    }
    return ok(input.idempotencyKey, true);
  };

  const appointAdministrator = (input: AuthorityCommand, principal: Principal): CommandResult => {
    if (input.kind !== "appoint-administrator") return fail("invalid-command", "wrong coordinator");
    const org = rosterAuthority(input.authorization, input.organizationId, principal);
    if ("failure" in org) return { ok: false, failure: org.failure };
    const replay = checkClaim(org.claims, input);
    if (replay !== undefined) return replay;
    const target = org.actors.find((candidate) => candidate.actorId === input.actorId);
    if (target === undefined) return fail("invalid-command", "unknown actor");
    if (target.disabled) return fail("not-admitted", "actor disabled");
    if (!org.admins.includes(target.actorId)) {
      org.admins.push(target.actorId);
      org.audit.push({
        at: clock.now(),
        by: `${org.organizationId}/${principal.actorId}`,
        fact: `actor ${target.actorId} appointed administrator`,
      });
    }
    commitClaim(org.claims, input);
    return ok(input.idempotencyKey, true);
  };

  const retireAdministrator = (input: AuthorityCommand, principal: Principal): CommandResult => {
    if (input.kind !== "retire-administrator") return fail("invalid-command", "wrong coordinator");
    const org = rosterAuthority(input.authorization, input.organizationId, principal);
    if ("failure" in org) return { ok: false, failure: org.failure };
    const replay = checkClaim(org.claims, input);
    if (replay !== undefined) return replay;
    const target = org.actors.find((candidate) => candidate.actorId === input.actorId);
    if (target === undefined) return fail("invalid-command", "unknown actor");
    if (!org.admins.includes(target.actorId)) {
      commitClaim(org.claims, input);
      return ok(input.idempotencyKey, true);
    }
    const remaining = org.admins.filter((id) => id !== target.actorId);
    const usable = remaining.some((id) => {
      const actor = org.actors.find((candidate) => candidate.actorId === id);
      return actor !== undefined && !actor.disabled && linksTo(org.organizationId, id).length > 0;
    });
    if (!usable) return fail("denied", "no other usable administrator remains");
    org.admins = remaining;
    commitClaim(org.claims, input);
    org.audit.push({
      at: clock.now(),
      by: `${org.organizationId}/${principal.actorId}`,
      fact: `actor ${target.actorId} retired as administrator`,
    });
    return ok(input.idempotencyKey, true);
  };

  const activationRequest = async (
    input: ActivationRequestInput,
  ): Promise<ActivationRequestResult | Failed> => {
    const principal = await resolvePrincipal({ kind: "fresh-evidence", evidence: input.evidence, operationId: "" });
    if ("kind" in principal) return { failure: principal };
    const org = orgs.get(organizationId(input.organizationId));
    if (org === undefined || principal.organizationId !== org.organizationId) {
      return { failure: { kind: "wrong-binding" } };
    }
    if (!principal.adminOfOrganization) {
      return { failure: { kind: "denied", detail: "the caller does not administer this organization" } };
    }
    const target = org.actors.find((candidate) => candidate.actorId === input.actorId);
    if (target === undefined) return { failure: { kind: "invalid-command", detail: "unknown actor" } };
    if (target.disabled) return { failure: { kind: "not-admitted", detail: "actor disabled" } };
    if (linksTo(org.organizationId, target.actorId).length > 0) {
      return { failure: { kind: "denied", detail: "actor already has a principal link" } };
    }
    const secret = activationSecret();
    const secretHash = await sha256Hex(secret);
    revokeActiveRequests(org, target.actorId);
    const issuedAt = clock.now();
    const request = {
      requestId: `activation-${nextId()}`,
      organizationId: org.organizationId,
      actorId: target.actorId,
      secretHash,
      issuedAt,
      expiresAt: (issuedAt + activationLifetime) as typeof issuedAt,
    };
    org.activationRequests.push(request);
    org.audit.push({ at: issuedAt, by: `${org.organizationId}/${principal.actorId}`, fact: `activation for actor ${target.actorId} issued` });
    return { requestId: request.requestId, secret, expiresAt: request.expiresAt };
  };

  const requestForSecret = async (secret: string) => {
    const secretHash = await sha256Hex(secret);
    for (const org of orgs.values()) {
      const request = org.activationRequests.find((candidate) => candidate.secretHash === secretHash);
      if (request !== undefined) return { org, request };
    }
    return undefined;
  };

  const activationInspect = async (
    input: ActivationInspectInput,
  ): Promise<ActivationInspection | Failed> => {
    const found = await requestForSecret(input.secret);
    if (
      found === undefined || found.request.consumedAt !== undefined ||
      found.request.revokedAt !== undefined || clock.now() >= found.request.expiresAt
    ) return unusableActivation();
    return { usable: true };
  };

  const activationAccept = async (
    input: ActivationAcceptInput,
  ): Promise<ActivationAcceptance | Failed> => {
    const found = await requestForSecret(input.secret);
    if (found === undefined) return unusableActivation();
    const { org, request } = found;
    const key = principalKey(input.evidence.provider, input.evidence.subject);
    const existing = principalLinks.get(key);
    if (request.consumedAt !== undefined) {
      return existing?.organizationId === org.organizationId && existing.actorId === request.actorId
        ? { applied: false, actor: { organizationId: org.organizationId, actorId: request.actorId } }
        : unusableActivation();
    }
    if (request.revokedAt !== undefined || clock.now() >= request.expiresAt) return unusableActivation();
    const target = org.actors.find((candidate) => candidate.actorId === request.actorId);
    if (target === undefined || target.disabled) return unusableActivation();
    if (existing !== undefined && (existing.organizationId !== org.organizationId || existing.actorId !== target.actorId)) {
      return { failure: { kind: "denied", detail: "the principal is already linked to another actor" } };
    }
    const targetLinks = linksTo(org.organizationId, target.actorId);
    if (targetLinks.length > 0) return unusableActivation();
    principalLinks.set(key, { organizationId: org.organizationId, actorId: target.actorId });
    request.consumedAt = clock.now();
    org.audit.push({ at: request.consumedAt, by: "activation", fact: `activation for actor ${target.actorId} accepted` });
    return { applied: true, actor: { organizationId: org.organizationId, actorId: target.actorId } };
  };

  // The roster read. An envelope proves the caller; standing — not the
  // envelope, which carries no standing claim — decides who reads. The
  // actor list is organization-wide: an actor with no participation in the
  // envelope's operation is still on the roster the administrator
  // administers. The teams half is scoped the other way: only the teams
  // the organization fields in the operation the envelope binds to.
  const roster = async (input: RosterRequest): Promise<RosterRead | Failed> => {
    const gated = await envelopeGate(input.envelope);
    if ("kind" in gated) return { failure: gated };
    const { claims } = gated;
    const organization = organizationId(claims.actor.organizationId);
    const org = orgs.get(organization);
    if (org === undefined) return { failure: { kind: "wrong-binding", detail: "unknown organization" } };
    const reader = actorId(claims.actor.actorId);
    if (!org.admins.includes(reader)) {
      return { failure: { kind: "denied", detail: "the caller does not administer this organization" } };
    }
    const operation = ops.get(operationId(claims.operationId));
    if (operation === undefined) return { failure: { kind: "wrong-binding", detail: "unknown operation" } };
    const actors = [...org.actors]
      .sort((left, right) => (left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0))
      .map((actor) => ({
        actorId: actor.actorId,
        ...(actor.displayName !== undefined ? { displayName: actor.displayName } : {}),
        disabled: actor.disabled === true,
      }));
    const teams = operation.teams
      .filter((team) => team.organizationId === organization)
      .sort((left, right) => (left.teamId < right.teamId ? -1 : left.teamId > right.teamId ? 1 : 0))
      .map((team) => ({
        teamId: team.teamId,
        ...(team.displayName !== undefined ? { displayName: team.displayName } : {}),
        status: team.status,
      }));
    return { organizationId: organization, actors, teams };
  };

  return {
    resolvePrincipal,
    activationRequest,
    activationInspect,
    activationAccept,
    roster,
    command(input, principal) {
      switch (input.kind) {
        case "participation-accept": return acceptParticipation(input, principal);
        case "participation-revoke": return revokeOrganizationParticipation(input, principal);
        case "disable-actor": return disableActor(input, principal);
        case "unlink-principal": return unlinkPrincipal(input, principal);
        case "revoke-activation": return revokeActivation(input, principal);
        case "create-actor": return createActor(input, principal);
        case "update-actor": return updateActor(input, principal);
        case "appoint-administrator": return appointAdministrator(input, principal);
        case "retire-administrator": return retireAdministrator(input, principal);
        default: return fail("invalid-command", "not an organization command");
      }
    },
  };
};
