// The portable authority engine, in memory — the reference implementation of
// `AuthorityRuntime` (docs/authority_redesign.md § Authority).
//
// Two coordinators mirror the deployed shape: an organization authority
// (actors, principal links, org-side participation) and an operation
// authority (sites, teams, grants, op-side participation, policy, refresh
// records). Between them is an outbox with visible partial states and
// retryable delivery — never a distributed transaction. The engine owns
// ordering, validation, idempotency, audit, and issuance; callers receive
// use cases, not storage.
//
// Determinism: the clock and signer are injected; a fixed clock plus a
// fresh signer gives reproducible behavior (ids, failure kinds, receipts)
// without pinning signature bytes.

import {
  canonicalJson,
  type AccessEnvelopeClaimsV1,
  type ActorId,
  type AuthorityInterfaceVersion,
  type Failure,
  type IdempotencyKey,
  type JsonValue,
  type OperationId,
  type OrganizationId,
  type RefreshHandle,
  type RefreshHandleOutcome,
  type SiteBinding,
  type SignedAccessEnvelope,
  type SiteId,
  type TeamId,
  ACCESS_ENVELOPE_FORMAT,
  ACCESS_ENVELOPE_VERSION,
  AUTHORITY_INTERFACE_VERSION,
} from "../contract.ts";
import {
  invariantProblems,
  readReach,
  wearableGrants,
  type Grant,
  type Participation,
  type Snapshot,
} from "../model.ts";
import type { PolicyBundle } from "../policy.ts";
import { actionsOf } from "../policy.ts";
import type { TwinFixture } from "./twins.ts";
import type {
  AccessFromEvidenceInput,
  AccessIssue,
  AuthorityCommand,
  AuthorityContext,
  AuthorityRuntime,
  CommandResult,
  ContextRequest,
  Failed,
  PrincipalEvidence,
  RefreshInput,
} from "./types.ts";
import { counter, fixedClock, sha256Hex, webCryptoSigner, type Clock, type Signer } from "./internal.ts";

// --- configuration ---------------------------------------------------------------

export interface SignerLike extends Signer {}
export interface ClockLike extends Clock {}

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
  readonly clock?: ClockLike;
  readonly signer?: SignerLike;
  readonly envelopeLifetimeSeconds?: number;
  /** Actions that confer site-configuration reach (default `["configure"]`). */
  readonly configureActions?: readonly string[];
  readonly adminRoles?: Readonly<Record<OperationId, readonly string[]>>;
  readonly orgAdmins?: Readonly<Record<OrganizationId, readonly ActorId[]>>;
  /** Fault injection: the first N outbox deliveries fail and stay pending. */
  readonly transportFailures?: number;
}

// --- coordinator state ------------------------------------------------------------

interface AuditEvent {
  readonly at: number;
  readonly by: string;
  readonly fact: string;
}

interface Claim {
  readonly payloadHash: string;
  readonly receiptApplied: boolean;
}

interface OrgState {
  readonly organizationId: OrganizationId;
  readonly displayName?: string;
  actors: { organizationId: OrganizationId; actorId: ActorId; displayName?: string; disabled?: boolean }[];
  principalLinks: Map<string, { organizationId: OrganizationId; actorId: ActorId }>;
  /** Org-side invitations received from operations, by invitation id. */
  invitations: Map<string, { operationId: OperationId; status: "pending" | "accepted" | "declined" }>;
  audit: AuditEvent[];
  claims: Map<IdempotencyKey, Claim>;
}

interface RefreshRecord {
  readonly handleHash: string;
  readonly operationId: OperationId;
  readonly organizationId: OrganizationId;
  readonly actorId: ActorId;
  revoked: boolean;
  superseded: boolean;
}

interface OpState {
  readonly operationId: OperationId;
  readonly displayName?: string;
  readonly bounded?: boolean;
  policy: PolicyBundle;
  sites: { siteId: SiteId; operationId: OperationId; displayName?: string; aliases: readonly string[] }[];
  teams: { teamId: TeamId; siteId: SiteId; organizationId: OrganizationId; displayName?: string }[];
  grants: Grant[];
  participations: Participation[];
  /** Op-side invitation records, by invitation id. */
  invitations: Map<string, { organizationId: OrganizationId; status: "invited" | "accepted" | "active" }>;
  refreshRecords: RefreshRecord[];
  accessRequests: { requestId: string; organizationId: OrganizationId; actorId: ActorId; note?: string }[];
  audit: AuditEvent[];
  claims: Map<IdempotencyKey, Claim>;
}

interface OutboxMessage {
  readonly id: string;
  readonly to: "org" | "op";
  readonly target: string;
  readonly kind: "invitation" | "acceptance" | "actor-disabled";
  readonly invitationId?: string;
  readonly operationId?: OperationId;
  readonly organizationId?: OrganizationId;
  readonly actorId?: ActorId;
}

// --- the engine --------------------------------------------------------------------

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
  invitationsOf(organizationId: OrganizationId): ReadonlyMap<string, { operationId: OperationId; status: string }>;
}

const V = AUTHORITY_INTERFACE_VERSION;
const failed = (failure: Failure): Failed => ({ failure });
const fail = (kind: Failure["kind"], detail?: string): { ok: false; failure: Failure } => ({
  ok: false,
  failure: { kind, ...(detail !== undefined ? { detail } : {}) },
});
const ok = (idempotencyKey: string, applied: boolean): CommandResult => ({
  ok: true,
  receipt: { idempotencyKey, applied },
});

const defaultHat = (grants: readonly Grant[], bundle: PolicyBundle) => {
  const rank = (g: Grant): string =>
    `${g.primary === true ? 0 : 1}|${g.role}|${g.target.kind === "team" ? g.target.teamId : g.target.siteId}|${g.grantId}`;
  const sorted = [...grants].sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0));
  const chosen = sorted[0];
  if (chosen === undefined) return undefined;
  return { grant: chosen, actions: actionsOf(bundle, chosen.role) ?? [] };
};

export const createInMemoryAuthority = async (
  config: InMemoryAuthorityConfig = {},
): Promise<InMemoryAuthorityHandle> => {
  const clock = config.clock ?? fixedClock(1_700_000_000);
  const signer = config.signer ?? (await webCryptoSigner("key-1"));
  const lifetime = config.envelopeLifetimeSeconds ?? 900;
  const configureActions = config.configureActions ?? ["configure"];
  const adminRoles = config.adminRoles ?? {};
  const orgAdmins = config.orgAdmins ?? {};
  let transportFailures = config.transportFailures ?? 0;

  const orgs = new Map<OrganizationId, OrgState>();
  const ops = new Map<OperationId, OpState>();
  const outbox: OutboxMessage[] = [];
  const delivered = new Set<string>();
  const nextId = counter();
  const allOrganizations: { id: OrganizationId; displayName?: string }[] = [];
  const allActors: { organizationId: OrganizationId; actorId: ActorId; displayName?: string; disabled?: boolean }[] = [];

  for (const fixture of config.fixtures ?? []) {
    const op = fixture.snapshot.operations[0];
    if (op === undefined) throw new Error("a twin fixture needs an operation");
    ops.set(op.operationId, {
      operationId: op.operationId,
      ...(op.displayName !== undefined ? { displayName: op.displayName } : {}),
      ...(op.bounded !== undefined ? { bounded: op.bounded } : {}),
      policy: fixture.policy,
      sites: fixture.snapshot.sites.map((s) => ({ ...s })),
      teams: fixture.snapshot.teams.map((t) => ({ ...t })),
      grants: fixture.snapshot.grants.map((g) => ({ ...g })),
      participations: fixture.snapshot.participations.map((p) => ({ ...p })),
      invitations: new Map(),
      refreshRecords: [],
      accessRequests: [],
      audit: [{ at: clock.now(), by: "bootstrap", fact: `fixture ${fixture.snapshot.operations[0]?.operationId} loaded` }],
      claims: new Map(),
    });
    for (const organization of fixture.snapshot.organizations) {
      if (!orgs.has(organization.id)) {
        orgs.set(organization.id, {
          organizationId: organization.id,
          ...(organization.displayName !== undefined ? { displayName: organization.displayName } : {}),
          actors: [],
          principalLinks: new Map(),
          invitations: new Map(),
          audit: [{ at: clock.now(), by: "bootstrap", fact: `organization ${organization.id} created` }],
          claims: new Map(),
        });
        allOrganizations.push({ id: organization.id, ...(organization.displayName !== undefined ? { displayName: organization.displayName } : {}) });
      }
    }
    for (const actor of fixture.snapshot.actors) {
      const org = orgs.get(actor.organizationId);
      if (org !== undefined && !org.actors.some((a) => a.actorId === actor.actorId)) {
        org.actors.push({ ...actor });
        if (!allActors.some((a) => a.organizationId === actor.organizationId && a.actorId === actor.actorId)) {
          allActors.push({ ...actor });
        }
      }
    }
  }
  for (const link of config.principalLinks ?? []) {
    const org = orgs.get(link.organizationId);
    if (org === undefined || !org.actors.some((a) => a.actorId === link.actorId)) {
      throw new Error(`principal link names an unknown actor: ${link.organizationId}/${link.actorId}`);
    }
    org.principalLinks.set(`${link.provider}:${link.subject}`, {
      organizationId: link.organizationId,
      actorId: link.actorId,
    });
  }

  const snapshotOf = (operationId: OperationId): Snapshot | undefined => {
    const op = ops.get(operationId);
    if (op === undefined) return undefined;
    return {
      organizations: allOrganizations,
      actors: allActors,
      operations: [...ops.values()].map((o) => ({
        operationId: o.operationId,
        ...(o.displayName !== undefined ? { displayName: o.displayName } : {}),
        ...(o.bounded !== undefined ? { bounded: o.bounded } : {}),
      })),
      sites: op.sites,
      teams: op.teams,
      grants: op.grants,
      participations: op.participations,
    };
  };

  // --- outbox delivery ------------------------------------------------------------

  const deliverPending = async (): Promise<number> => {
    let count = 0;
    for (const message of [...outbox]) {
      if (transportFailures > 0) {
        transportFailures -= 1;
        continue; // the attempt failed; the message stays pending and retryable
      }
      if (delivered.has(message.id)) continue;
      if (message.kind === "invitation" && message.invitationId !== undefined) {
        const org = orgs.get(message.target);
        if (org !== undefined && !org.invitations.has(message.invitationId)) {
          org.invitations.set(message.invitationId, { operationId: message.operationId ?? "", status: "pending" });
        }
      }
      if (message.kind === "acceptance" && message.invitationId !== undefined) {
        const op = ops.get(message.target);
        const invitation = op?.invitations.get(message.invitationId);
        if (op !== undefined && invitation !== undefined && invitation.status === "invited") {
          invitation.status = "accepted";
          op.participations = op.participations.map((p) =>
            p.organizationId === invitation.organizationId ? { ...p, status: "active" } : p,
          );
          op.audit.push({ at: clock.now(), by: "outbox", fact: `participation ${invitation.organizationId} active (canonical)` });
        }
      }
      if (message.kind === "actor-disabled" && message.operationId !== undefined) {
        const op = ops.get(message.target);
        if (op !== undefined) {
          for (const record of op.refreshRecords) {
            if (record.organizationId === message.organizationId && record.actorId === message.actorId) {
              record.revoked = true;
            }
          }
        }
      }
      delivered.add(message.id);
      outbox.splice(outbox.indexOf(message), 1);
      count += 1;
    }
    return count;
  };

  // --- helpers ----------------------------------------------------------------------

  const checkVersion = (v: AuthorityInterfaceVersion): Failure | undefined =>
    v !== V ? { kind: "wrong-interface-version" } : undefined;

  const payloadHash = (command: AuthorityCommand): string => {
    const { idempotencyKey: _k, authorization: _a, ...rest } = command;
    return canonicalJson(rest as JsonValue);
  };

  /** A retry claims its earlier result; the same key with a different
   * payload is a misuse, not a retry. Checking is pure — the claim is
   * committed with the mutation it guards, so a denied command never
   * poisons its key. */
  const checkClaim = (
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
  const commitClaim = (claims: Map<IdempotencyKey, Claim>, command: AuthorityCommand): void => {
    claims.set(command.idempotencyKey, { payloadHash: payloadHash(command), receiptApplied: true });
  };

  interface Principal {
    readonly organizationId: OrganizationId;
    readonly actorId: ActorId;
    readonly adminOfOperation: boolean;
    readonly adminOfOrganization: boolean;
  }

  const resolvePrincipal = async (authorization: AuthorityCommand["authorization"], operationId?: OperationId): Promise<Principal | Failure> => {
    if (authorization.kind === "fresh-evidence") {
      const link = [...orgs.values()]
        .flatMap((o) => [...o.principalLinks.entries()].map(([k, v]) => ({ k, v })))
        .find(({ k }) => k === `${authorization.evidence.provider}:${authorization.evidence.subject}`);
      if (link === undefined) return { kind: "unauthenticated", detail: "no principal link for this evidence" };
      const org = orgs.get(link.v.organizationId);
      const actor = org?.actors.find((a) => a.actorId === link.v.actorId);
      if (org === undefined || actor === undefined) return { kind: "unauthenticated" };
      if (actor.disabled) return { kind: "not-admitted", detail: "actor disabled" };
      return {
        organizationId: link.v.organizationId,
        actorId: link.v.actorId,
        adminOfOperation: false,
        adminOfOrganization: (orgAdmins[link.v.organizationId] ?? []).includes(link.v.actorId),
      };
    }
    const claims = authorization.envelope.claims;
    if (authorization.envelope.format !== ACCESS_ENVELOPE_FORMAT) return { kind: "invalid-signature" };
    if (!(await signer.verify(canonicalJson(claims as unknown as JsonValue), authorization.envelope.signature))) {
      return { kind: "invalid-signature" };
    }
    if (clock.now() >= claims.exp) return { kind: "expired" };
    if (operationId !== undefined && claims.operationId !== operationId) return { kind: "wrong-binding" };
    const roles = adminRoles[claims.operationId] ?? ["admin"];
    const adminHat = claims.hat.actions.some((a) => configureActions.includes(a)) || roles.includes(claims.hat.role);
    return {
      organizationId: claims.actor.organizationId,
      actorId: claims.actor.actorId,
      adminOfOperation: adminHat,
      adminOfOrganization: (orgAdmins[claims.actor.organizationId] ?? []).includes(claims.actor.actorId),
    };
  };

  const revokeRefreshRecords = (op: OpState, organizationId: OrganizationId, actorId: ActorId): void => {
    for (const record of op.refreshRecords) {
      if (record.organizationId === organizationId && record.actorId === actorId) record.revoked = true;
    }
  };

  // --- issuance -----------------------------------------------------------------------

  const buildEnvelope = (
    op: OpState,
    organizationId: OrganizationId,
    actorId: ActorId,
  ): AccessEnvelopeClaimsV1 | Failure => {
    const org = orgs.get(organizationId);
    const actor = org?.actors.find((a) => a.actorId === actorId);
    if (org === undefined || actor === undefined) return { kind: "unauthenticated" };
    if (actor.disabled) return { kind: "not-admitted", detail: "actor disabled" };
    const snapshot = snapshotOf(op.operationId);
    if (snapshot === undefined) return { kind: "wrong-binding" };
    const wearable = wearableGrants(snapshot, organizationId, actorId, op.operationId);
    if (wearable.length === 0) return { kind: "not-admitted" };
    const hat = defaultHat(wearable, op.policy);
    if (hat === undefined) return { kind: "not-admitted" };
    const hatTeamIds = new Set<TeamId>();
    const hatSiteIds = new Set<SiteId>();
    if (hat.grant.target.kind === "site") {
      hatSiteIds.add(hat.grant.target.siteId);
      for (const team of op.teams) if (team.siteId === hat.grant.target.siteId) hatTeamIds.add(team.teamId);
    } else {
      hatTeamIds.add(hat.grant.target.teamId);
    }
    const siteIds = new Set<SiteId>();
    const memberTeams = new Set<TeamId>();
    for (const grant of wearable) {
      if (grant.target.kind === "site") {
        siteIds.add(grant.target.siteId);
        for (const team of op.teams) if (team.siteId === grant.target.siteId) memberTeams.add(team.teamId);
      } else {
        const teamId = grant.target.teamId;
        memberTeams.add(teamId);
        const siteId = op.teams.find((t) => t.teamId === teamId)?.siteId;
        if (siteId !== undefined) siteIds.add(siteId);
      }
    }
    const sites: SiteBinding[] = op.sites
      .filter((s) => siteIds.has(s.siteId))
      .map((s) => ({ siteId: s.siteId, aliases: [...s.aliases] }));
    const reach = readReach(snapshot, op.policy, organizationId, actorId, op.operationId);
    const carriesConfigure = (g: Grant): boolean =>
      (actionsOf(op.policy, g.role) ?? []).some((a) => configureActions.includes(a));
    const siteIdOfGrant = (g: Grant): SiteId | undefined => {
      if (g.target.kind === "site") return g.target.siteId;
      const teamId = g.target.teamId;
      return op.teams.find((t) => t.teamId === teamId)?.siteId;
    };
    const configurableSiteIds = op.sites
      .filter((site) => wearable.some((g) => carriesConfigure(g) && siteIdOfGrant(g) === site.siteId))
      .map((s) => s.siteId);
    const iat = clock.now();
    return {
      v: ACCESS_ENVELOPE_VERSION,
      interfaceVersion: V,
      operationId: op.operationId,
      actor: { organizationId, actorId },
      hat: {
        role: hat.grant.role,
        actions: [...hat.actions],
        teamIds: [...hatTeamIds],
        siteIds: [...hatSiteIds],
      },
      memberTeamIds: [...memberTeams],
      sites,
      readableOrganizationIds: reach.readableOrganizationIds,
      readableTeamIds: reach.readableTeamIds,
      configurableSiteIds,
      iat,
      exp: iat + lifetime,
    };
  };

  const issue = async (
    op: OpState,
    organizationId: OrganizationId,
    actorId: ActorId,
  ): Promise<AccessIssue | { ok: false; failure: Failure }> => {
    const claims = buildEnvelope(op, organizationId, actorId);
    if ("kind" in claims) return { ok: false, failure: claims };
    const signature = await signer.sign(canonicalJson(claims as unknown as JsonValue));
    const envelope: SignedAccessEnvelope = {
      format: ACCESS_ENVELOPE_FORMAT,
      v: ACCESS_ENVELOPE_VERSION,
      keyId: signer.keyId,
      claims,
      signature,
    };
    const handle: RefreshHandle = `rh-${nextId()}`;
    op.refreshRecords.push({
      handleHash: await sha256Hex(handle),
      operationId: op.operationId,
      organizationId,
      actorId,
      revoked: false,
      superseded: false,
    });
    const refresh: RefreshHandleOutcome = { kind: "rotated", handle };
    return { envelope, refresh };
  };

  // --- the runtime ----------------------------------------------------------------------

  const runtime: AuthorityRuntime = {
    async accessFromEvidence(input: AccessFromEvidenceInput): Promise<AccessIssue | Failed> {
      await deliverPending();
      const versionFail = checkVersion(input.interfaceVersion);
      if (versionFail !== undefined) return failed(versionFail);
      const op = ops.get(input.operationId);
      if (op === undefined) return failed({ kind: "wrong-binding", detail: "unknown operation" });
      const link = [...orgs.values()]
        .flatMap((o) => [...o.principalLinks.entries()].map(([k, v]) => ({ k, v })))
        .find(({ k }) => k === `${input.evidence.provider}:${input.evidence.subject}`);
      if (link === undefined) return failed({ kind: "unauthenticated", detail: "no principal link for this evidence" });
      const result = await issue(op, link.v.organizationId, link.v.actorId);
      if ("failure" in result) return failed(result.failure);
      return result;
    },

    async refresh(input: RefreshInput): Promise<AccessIssue | Failed> {
      await deliverPending();
      const versionFail = checkVersion(input.interfaceVersion);
      if (versionFail !== undefined) return failed(versionFail);
      const op = ops.get(input.operationId);
      if (op === undefined) return failed({ kind: "wrong-binding", detail: "unknown operation" });
      const hash = await sha256Hex(input.handle);
      const record = op.refreshRecords.find((r) => r.handleHash === hash);
      if (record === undefined) return failed({ kind: "unauthenticated", detail: "unknown refresh handle" });
      if (record.revoked) return failed({ kind: "unauthenticated", detail: "refresh handle revoked" });
      if (record.superseded) return failed({ kind: "unauthenticated", detail: "refresh handle superseded" });
      record.superseded = true;
      const result = await issue(op, record.organizationId, record.actorId);
      if ("failure" in result) return failed(result.failure);
      return result;
    },

    async context(input: ContextRequest): Promise<AuthorityContext | Failed> {
      await deliverPending();
      const versionFail = checkVersion(input.interfaceVersion);
      if (versionFail !== undefined) return failed(versionFail);
      const { envelope } = input;
      if (envelope.format !== ACCESS_ENVELOPE_FORMAT) return failed({ kind: "invalid-signature" });
      if (!(await signer.verify(canonicalJson(envelope.claims as unknown as JsonValue), envelope.signature))) {
        return failed({ kind: "invalid-signature" });
      }
      if (clock.now() >= envelope.claims.exp) return failed({ kind: "expired" });
      const op = ops.get(envelope.claims.operationId);
      const snapshot = op !== undefined ? snapshotOf(op.operationId) : undefined;
      if (op === undefined || snapshot === undefined) return failed({ kind: "wrong-binding" });
      const { organizationId, actorId } = envelope.claims.actor;
      const wearable = wearableGrants(snapshot, organizationId, actorId, op.operationId);
      const actor = orgs.get(organizationId)?.actors.find((a) => a.actorId === actorId);
      const orgName = orgs.get(organizationId)?.displayName;
      const participation = snapshot.participations.find((p) => p.organizationId === organizationId);
      const selectedPrimary = wearable.find((g) => g.role === envelope.claims.hat.role)?.primary === true;
      return {
        actor: { organizationId, actorId, ...(actor?.displayName !== undefined ? { displayName: actor.displayName } : {}) },
        ...(orgName !== undefined ? { organizationDisplayName: orgName } : {}),
        operationId: op.operationId,
        ...(op.displayName !== undefined ? { operationDisplayName: op.displayName } : {}),
        participation: participation?.status ?? "revoked",
        wearableHats: wearable.map((g) => ({
          role: g.role,
          actions: actionsOf(op.policy, g.role) ?? [],
          ...(g.target.kind === "team" ? { teamId: g.target.teamId } : { siteId: g.target.siteId }),
          primary: g.primary === true,
        })),
        selectedHat: {
          role: envelope.claims.hat.role,
          actions: [...envelope.claims.hat.actions],
          primary: selectedPrimary,
        },
        sites: [...envelope.claims.sites],
      };
    },

    async command(inputCommand: AuthorityCommand): Promise<CommandResult> {
      await deliverPending();
      const versionFail = checkVersion(inputCommand.interfaceVersion);
      if (versionFail !== undefined) return fail(versionFail.kind);

      // request-access needs no administrator: the evidence is the request
      if (inputCommand.kind === "request-access") {
        const op = ops.get(inputCommand.operationId);
        if (op === undefined) return fail("wrong-binding", "unknown operation");
        const replay = checkClaim(op.claims, inputCommand);
        if (replay !== undefined) return replay;
        const link = [...orgs.values()]
          .flatMap((o) => [...o.principalLinks.entries()].map(([k, v]) => ({ k, v })))
          .find(({ k }) => k === `${inputCommand.evidence.provider}:${inputCommand.evidence.subject}`);
        if (link === undefined) return fail("unauthenticated", "no principal link for this evidence");
        commitClaim(op.claims, inputCommand);
        const requestId = `ar-${nextId()}`;
        op.accessRequests.push({ requestId, organizationId: link.v.organizationId, actorId: link.v.actorId });
        op.audit.push({ at: clock.now(), by: `${link.v.organizationId}/${link.v.actorId}`, fact: `access request ${requestId}` });
        return ok(inputCommand.idempotencyKey, true);
      }

      const operationId =
        inputCommand.kind === "disable-actor"
          ? undefined
          : "operationId" in inputCommand
            ? inputCommand.operationId
            : undefined;
      const principalOrFailure = await resolvePrincipal(inputCommand.authorization, operationId);
      if ("kind" in principalOrFailure) return fail(principalOrFailure.kind, principalOrFailure.detail);

      switch (inputCommand.kind) {
        case "participation-invite": {
          const op = ops.get(inputCommand.operationId);
          const org = orgs.get(inputCommand.organizationId);
          if (op === undefined) return fail("wrong-binding", "unknown operation");
          if (org === undefined) return fail("wrong-binding", "unknown organization");
          if (!principalOrFailure.adminOfOperation) return fail("denied", "the caller does not administer this operation");
          const replay = checkClaim(op.claims, inputCommand);
          if (replay !== undefined) return replay;
          if (op.participations.some((p) => p.organizationId === inputCommand.organizationId)) {
            return fail("denied", "the organization is already participating");
          }
          commitClaim(op.claims, inputCommand);
          const invitationId = `inv-${nextId()}`;
          op.invitations.set(invitationId, { organizationId: inputCommand.organizationId, status: "invited" });
          op.participations.push({ organizationId: inputCommand.organizationId, operationId: inputCommand.operationId, status: "invited" });
          outbox.push({
            id: `ob-${nextId()}`, to: "org", target: inputCommand.organizationId,
            kind: "invitation", invitationId, operationId: inputCommand.operationId,
            organizationId: inputCommand.organizationId,
          });
          op.audit.push({ at: clock.now(), by: `${principalOrFailure.organizationId}/${principalOrFailure.actorId}`, fact: `invitation ${invitationId} to ${inputCommand.organizationId}` });
          return ok(inputCommand.idempotencyKey, true);
        }
        case "participation-accept": {
          const org = orgs.get(principalOrFailure.organizationId);
          if (org === undefined) return fail("wrong-binding");
          if (!principalOrFailure.adminOfOrganization) return fail("denied", "the caller does not administer this organization");
          const replay = checkClaim(org.claims, inputCommand);
          if (replay !== undefined) return replay;
          const byId = "invitationId" in inputCommand ? org.invitations.get(inputCommand.invitationId) : undefined;
          const byOperation = "operationId" in inputCommand
            ? [...org.invitations.entries()].find(([, invitation]) => invitation.operationId === inputCommand.operationId)
            : undefined;
          const invitationId = byId !== undefined && "invitationId" in inputCommand
            ? inputCommand.invitationId
            : byOperation?.[0];
          const invitation = byId ?? byOperation?.[1];
          if (invitationId === undefined || invitation === undefined) return fail("denied", "no such invitation");
          if (invitation.status !== "pending") return fail("denied", `invitation already ${invitation.status}`);
          commitClaim(org.claims, inputCommand);
          invitation.status = "accepted";
          const op = ops.get(invitation.operationId);
          if (op !== undefined) {
            outbox.push({
              id: `ob-${nextId()}`, to: "op", target: invitation.operationId,
              kind: "acceptance", invitationId,
              operationId: invitation.operationId, organizationId: org.organizationId,
            });
          }
          org.audit.push({ at: clock.now(), by: `${org.organizationId}/${principalOrFailure.actorId}`, fact: `invitation ${invitationId} accepted` });
          return ok(inputCommand.idempotencyKey, true);
        }
        case "participation-revoke": {
          if (inputCommand.by === "operation") {
            const op = ops.get(inputCommand.operationId);
            if (op === undefined) return fail("wrong-binding", "unknown operation");
            if (!principalOrFailure.adminOfOperation) return fail("denied", "the caller does not administer this operation");
            const replay = checkClaim(op.claims, inputCommand);
            if (replay !== undefined) return replay;
            commitClaim(op.claims, inputCommand);
            op.participations = op.participations.map((p) =>
              p.organizationId === inputCommand.organizationId ? { ...p, status: "revoked" } : p,
            );
            for (const record of op.refreshRecords) {
              if (record.organizationId === inputCommand.organizationId) record.revoked = true;
            }
            op.audit.push({ at: clock.now(), by: `${principalOrFailure.organizationId}/${principalOrFailure.actorId}`, fact: `participation ${inputCommand.organizationId} revoked` });
            return ok(inputCommand.idempotencyKey, true);
          }
          const org = orgs.get(inputCommand.organizationId);
          if (org === undefined) return fail("wrong-binding", "unknown organization");
          if (!principalOrFailure.adminOfOrganization) return fail("denied", "the caller does not administer this organization");
          const replay = checkClaim(org.claims, inputCommand);
          if (replay !== undefined) return replay;
          const op = ops.get(inputCommand.operationId);
          if (op === undefined) return fail("wrong-binding", "unknown operation");
          commitClaim(org.claims, inputCommand);
          op.participations = op.participations.map((p) =>
            p.organizationId === inputCommand.organizationId ? { ...p, status: "revoked" } : p,
          );
          for (const record of op.refreshRecords) {
            if (record.organizationId === inputCommand.organizationId) record.revoked = true;
          }
          org.audit.push({ at: clock.now(), by: `${org.organizationId}/${principalOrFailure.actorId}`, fact: `participation in ${inputCommand.operationId} revoked` });
          return ok(inputCommand.idempotencyKey, true);
        }
        case "admit": {
          const op = ops.get(inputCommand.operationId);
          if (op === undefined) return fail("wrong-binding", "unknown operation");
          if (!principalOrFailure.adminOfOperation) return fail("denied", "the caller does not administer this operation");
          const replay = checkClaim(op.claims, inputCommand);
          if (replay !== undefined) return replay;
          const actor = orgs.get(inputCommand.organizationId)?.actors.find((a) => a.actorId === inputCommand.actorId);
          if (actor === undefined) return fail("invalid-command", "unknown actor");
          commitClaim(op.claims, inputCommand);
          op.accessRequests = op.accessRequests.filter(
            (r) => !(r.organizationId === inputCommand.organizationId && r.actorId === inputCommand.actorId),
          );
          op.audit.push({ at: clock.now(), by: `${principalOrFailure.organizationId}/${principalOrFailure.actorId}`, fact: `admitted ${inputCommand.organizationId}/${inputCommand.actorId}` });
          return ok(inputCommand.idempotencyKey, true);
        }
        case "grant-hat": {
          const op = ops.get(inputCommand.operationId);
          if (op === undefined) return fail("wrong-binding", "unknown operation");
          if (!principalOrFailure.adminOfOperation) return fail("denied", "the caller does not administer this operation");
          const replay = checkClaim(op.claims, inputCommand);
          if (replay !== undefined) return replay;
          if (actionsOf(op.policy, inputCommand.role) === undefined) return fail("invalid-command", `unknown role "${inputCommand.role}"`);
          if (inputCommand.teamId !== undefined && !op.teams.some((t) => t.teamId === inputCommand.teamId)) {
            return fail("invalid-command", "unknown team");
          }
          if (inputCommand.siteId !== undefined && !op.sites.some((s) => s.siteId === inputCommand.siteId)) {
            return fail("invalid-command", "unknown site");
          }
          if (inputCommand.teamId !== undefined && inputCommand.siteId !== undefined) {
            return fail("invalid-command", "a grant reaches one target");
          }
          if (inputCommand.teamId === undefined && inputCommand.siteId === undefined) {
            return fail("invalid-command", "a grant needs a target");
          }
          commitClaim(op.claims, inputCommand);
          const grantId = `g-${nextId()}`;
          const grant: Grant = {
            grantId,
            operationId: inputCommand.operationId,
            organizationId: inputCommand.organizationId,
            actorId: inputCommand.actorId,
            role: inputCommand.role,
            target: inputCommand.teamId !== undefined
              ? { kind: "team", teamId: inputCommand.teamId }
              : { kind: "site", siteId: inputCommand.siteId ?? "" },
            ...(inputCommand.primary === true ? { primary: true } : {}),
          };
          if (inputCommand.primary === true) {
            op.grants = op.grants.map((g) => {
              if (g.organizationId !== inputCommand.organizationId || g.actorId !== inputCommand.actorId) return g;
              const { primary: _dropped, ...rest } = g;
              return rest;
            });
          }
          op.grants.push(grant);
          op.audit.push({ at: clock.now(), by: `${principalOrFailure.organizationId}/${principalOrFailure.actorId}`, fact: `grant ${grantId} (${inputCommand.role}) to ${inputCommand.organizationId}/${inputCommand.actorId}` });
          return ok(inputCommand.idempotencyKey, true);
        }
        case "revoke-grant": {
          const op = ops.get(inputCommand.operationId);
          if (op === undefined) return fail("wrong-binding", "unknown operation");
          if (!principalOrFailure.adminOfOperation) return fail("denied", "the caller does not administer this operation");
          const replay = checkClaim(op.claims, inputCommand);
          if (replay !== undefined) return replay;
          const grant = op.grants.find((g) => g.grantId === inputCommand.grantId);
          if (grant === undefined) return fail("invalid-command", "unknown grant");
          commitClaim(op.claims, inputCommand);
          op.grants = op.grants.map((g) => (g.grantId === inputCommand.grantId ? { ...g, revoked: true } : g));
          revokeRefreshRecords(op, grant.organizationId, grant.actorId);
          op.audit.push({ at: clock.now(), by: `${principalOrFailure.organizationId}/${principalOrFailure.actorId}`, fact: `grant ${inputCommand.grantId} revoked; refresh records revoked` });
          return ok(inputCommand.idempotencyKey, true);
        }
        case "select-hat": {
          const op = ops.get(inputCommand.operationId);
          if (op === undefined) return fail("wrong-binding", "unknown operation");
          if (!principalOrFailure.adminOfOperation && !(
            principalOrFailure.organizationId !== undefined &&
            principalOrFailure.actorId !== undefined &&
            op.grants.some((g) => g.grantId === inputCommand.grantId && g.organizationId === principalOrFailure.organizationId && g.actorId === principalOrFailure.actorId)
          )) {
            return fail("denied", "an actor selects their own hat or an administrator does");
          }
          const replay = checkClaim(op.claims, inputCommand);
          if (replay !== undefined) return replay;
          const grant = op.grants.find((g) => g.grantId === inputCommand.grantId);
          if (grant === undefined) return fail("invalid-command", "unknown grant");
          commitClaim(op.claims, inputCommand);
          op.grants = op.grants.map((g) => {
            if (g.grantId === inputCommand.grantId) return { ...g, primary: true };
            if (g.organizationId === grant.organizationId && g.actorId === grant.actorId) {
              const { primary: _dropped, ...rest } = g;
              return rest;
            }
            return g;
          });
          op.audit.push({ at: clock.now(), by: `${principalOrFailure.organizationId}/${principalOrFailure.actorId}`, fact: `primary hat set to grant ${inputCommand.grantId}` });
          return ok(inputCommand.idempotencyKey, true);
        }
        case "disable-actor": {
          const org = orgs.get(inputCommand.organizationId);
          if (org === undefined) return fail("wrong-binding", "unknown organization");
          if (!principalOrFailure.adminOfOrganization) return fail("denied", "the caller does not administer this organization");
          const replay = checkClaim(org.claims, inputCommand);
          if (replay !== undefined) return replay;
          const actor = org.actors.find((a) => a.actorId === inputCommand.actorId);
          if (actor === undefined) return fail("invalid-command", "unknown actor");
          commitClaim(org.claims, inputCommand);
          actor.disabled = true;
          for (const op of ops.values()) {
            outbox.push({
              id: `ob-${nextId()}`, to: "op", target: op.operationId, operationId: op.operationId,
              kind: "actor-disabled", organizationId: inputCommand.organizationId, actorId: inputCommand.actorId,
            });
          }
          org.audit.push({ at: clock.now(), by: `${org.organizationId}/${principalOrFailure.actorId}`, fact: `actor ${inputCommand.actorId} disabled` });
          return ok(inputCommand.idempotencyKey, true);
        }
        default:
          return fail("invalid-command", "unknown command kind");
      }
    },
  };

  return {
    runtime,
    verificationKey: async () => ({
      keyId: signer.keyId,
      algorithm: signer.algorithm,
      publicKey: await signer.publicKey(),
    }),
    drainOutbox: deliverPending,
    pendingOutbox: () => outbox.length,
    snapshotOf,
    invitationsOf: (organizationId) =>
      new Map(
        [...(orgs.get(organizationId)?.invitations.entries() ?? [])].map(
          ([invitationId, invitation]) => [invitationId, { operationId: invitation.operationId, status: invitation.status }],
        ),
      ),
  };
};
