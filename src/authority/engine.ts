// The portable authority engine, in memory — the reference implementation of
// `AuthorityRuntime` (docs/authority_redesign.md § Authority).
//
// Two coordinators mirror the deployed shape: `organization.ts` owns actors,
// principal links, org-side participation, and invitations; `operation.ts`
// owns sites, teams, grants, policy, op-side participation, refresh records,
// and issuance. Between them is an outbox (`outbox.ts`) with visible partial
// states and retryable delivery — never a distributed transaction. This file
// is the wiring: bootstrap, the two coordinators, the version gate, and the
// dispatch that routes each command to the coordinator that owns it.
//
// Determinism: the clock and signer are injected; a fixed clock plus a
// fresh signer gives reproducible behavior (ids, failure kinds, receipts)
// without pinning signature bytes.

import {
  AUTHORITY_INTERFACE_VERSION,
  operationId,
  organizationId,
  type ActorId,
  type AuthorityInterfaceVersion,
  type Failure,
  type OperationId,
  type OrganizationId,
  type VerificationKeyMaterial,
} from "../contract.ts";
import type { Snapshot } from "../model.ts";
import { counter, randomActivationSecret, systemClock, webCryptoSigner, type Clock, type Signer } from "./internal.ts";
import { createOperationCoordinator } from "./operation.ts";
import { createOrganizationCoordinator } from "./organization.ts";
import { deliverPending } from "./outbox.ts";
import { fail, failed } from "./result.ts";
import {
  principalKey,
  snapshotOf as snapshotFrom,
  type OpState,
  type OrgState,
  type OutboxMessage,
  type PrincipalLink,
} from "./state.ts";
import type { WorldFixture } from "./world.ts";
import type {
  AccessFromEvidenceInput,
  AccessIssue,
  ActivationAcceptInput,
  ActivationAcceptance,
  ActivationInspectInput,
  ActivationInspection,
  ActivationRequestInput,
  ActivationRequestResult,
  AuthorityCommand,
  AuthorityContext,
  AuthorityRuntime,
  CommandResult,
  ContextRequest,
  Failed,
  RefreshInput,
} from "./types.ts";

// --- configuration ---------------------------------------------------------------

export type SignerLike = Signer;
export type ClockLike = Clock;

/** Administration is declared policy, never a hardcoded role title. The
 * host states which role titles administer an operation; those titles stay
 * configuration, and an operation with none has no administering role title
 * — administration then rests solely on holding a hat that carries one of
 * `configureActions`. Organization administrator standing is different: the
 * configured `orgAdmins` record seeds it at bootstrap, and the organization
 * then appoints and retires its own administrators through its commands. */
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
  /** Defaults to 24 hours. */
  readonly activationLifetimeSeconds?: number;
  /** Test seam; production defaults to 128 cryptographic random bits. */
  readonly activationSecret?: () => string;
  /** Actions that confer site-configuration reach (default `["configure"]`). */
  readonly configureActions?: readonly string[];
  readonly adminRoles?: Readonly<Record<OperationId, readonly string[]>>;
  /** Seeds organization administrator standing at bootstrap. It names actors
   * the fixtures already declare, and it is not a live writer: the
   * organization's appoint/retire commands own standing afterwards. */
  readonly orgAdmins?: Readonly<Record<OrganizationId, readonly ActorId[]>>;
  /** Fault injection: the first N outbox deliveries fail and stay pending. */
  readonly transportFailures?: number;
}

// --- the engine --------------------------------------------------------------------

export type { VerificationKeyMaterial } from "../contract.ts";

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
  accessRequestsOf(operationId: OperationId): readonly { requestId: string; organizationId: OrganizationId; actorId: ActorId; note?: string }[];
  /** The organization's invitation inbox, by invitation id. */
  invitationsOf(organizationId: OrganizationId): ReadonlyMap<string, { operationId: OperationId; status: string }>;
}

const nextSigningKey = counter();

export const createInMemoryAuthority = async (
  config: InMemoryAuthorityConfig = {},
): Promise<InMemoryAuthorityHandle> => {
  const clock = config.clock ?? systemClock();
  const signer = config.signer ?? (await webCryptoSigner(`key-${nextSigningKey()}`));
  const lifetime = config.envelopeLifetimeSeconds ?? 900;
  const activationLifetime = config.activationLifetimeSeconds ?? 86_400;
  const activationSecret = config.activationSecret ?? randomActivationSecret;
  const configureActions = config.configureActions ?? ["configure"];
  const adminRoles = config.adminRoles ?? {};
  const orgAdmins = config.orgAdmins ?? {};
  let transportFailures = config.transportFailures ?? 0;

  const orgs = new Map<OrganizationId, OrgState>();
  const ops = new Map<OperationId, OpState>();
  /** Verified-principal links, one engine-wide map keyed by the encoded
   * (provider, subject) pair: "a:b"/"c" and "a"/"b:c" are different links,
   * and one identity is never two actors — the guard must hold across
   * organizations, not just within one. */
  const principalLinks = new Map<string, PrincipalLink>();
  const outbox: OutboxMessage[] = [];
  const delivered = new Set<string>();
  const nextId = counter();

  for (const fixture of config.fixtures ?? []) {
    const op = fixture.snapshot.operations[0];
    if (op === undefined) throw new Error("a fixture needs an operation");
    ops.set(op.operationId, {
      operationId: op.operationId,
      ...(op.displayName !== undefined ? { displayName: op.displayName } : {}),
      ...(op.slug !== undefined ? { slug: op.slug } : {}),
      ...(op.bounded !== undefined ? { bounded: op.bounded } : {}),
      policy: fixture.policy,
      sites: fixture.snapshot.sites.map((s) => ({ ...s })),
      teams: fixture.snapshot.teams.map((t) => ({ ...t, status: "active" as const })),
      grants: fixture.snapshot.grants.map((g) => ({ ...g })),
      participations: fixture.snapshot.participations.map((p) => ({ ...p })),
      invitations: new Map(),
      refreshRecords: [],
      accessRequests: [],
      audit: [{ at: clock.now(), by: "bootstrap", fact: `fixture ${fixture.snapshot.operations[0]?.operationId} loaded` }],
      claims: new Map(),
    });
    for (const organization of fixture.snapshot.organizations) {
      if (!orgs.has(organization.organizationId)) {
        orgs.set(organization.organizationId, {
          organizationId: organization.organizationId,
          ...(organization.displayName !== undefined ? { displayName: organization.displayName } : {}),
          actors: [],
          admins: [],
          invitations: new Map(),
          audit: [{ at: clock.now(), by: "bootstrap", fact: `organization ${organization.organizationId} created` }],
          claims: new Map(),
          activationRequests: [],
        });
      }
    }
    for (const actor of fixture.snapshot.actors) {
      const org = orgs.get(actor.organizationId);
      if (org !== undefined && !org.actors.some((a) => a.actorId === actor.actorId)) {
        org.actors.push({ ...actor });
      }
    }
  }
  for (const link of config.principalLinks ?? []) {
    const org = orgs.get(link.organizationId);
    if (org === undefined || !org.actors.some((a) => a.actorId === link.actorId)) {
      throw new Error(`principal link names an unknown actor: ${link.organizationId}/${link.actorId}`);
    }
    // one identity is never two actors: a (provider, subject) may re-link
    // its own actor, never a different one — engine-wide, across
    // organizations
    const key = principalKey(link.provider, link.subject);
    const existing = principalLinks.get(key);
    if (
      existing !== undefined &&
      (existing.organizationId !== link.organizationId || existing.actorId !== link.actorId)
    ) {
      throw new Error(
        `principal link ${key} already resolves to ${existing.organizationId}/${existing.actorId}, not ${link.organizationId}/${link.actorId}`,
      );
    }
    principalLinks.set(key, {
      organizationId: link.organizationId,
      actorId: link.actorId,
    });
  }

  // Administrator standing is organization data from here on. The configured
  // record is a bootstrap seed, not a live writer: an organization appoints
  // and retires its own administrators through the typed commands.
  for (const [key, admins] of Object.entries(orgAdmins)) {
    const org = orgs.get(organizationId(key));
    if (org === undefined) throw new Error(`orgAdmins names an unknown organization: ${key}`);
    for (const admin of admins) {
      if (!org.actors.some((actor) => actor.actorId === admin)) {
        throw new Error(`orgAdmins names an unknown actor: ${key}/${admin}`);
      }
    }
    org.admins = [...admins];
  }

  const snapshotOf = (operationOf: OperationId): Snapshot | undefined =>
    snapshotFrom(ops, orgs, operationOf);

  const operations = createOperationCoordinator({
    orgs,
    ops,
    principalLinks,
    outbox,
    clock,
    signer,
    nextId,
    lifetime,
    configureActions,
    snapshotOf,
  });
  const organizations = createOrganizationCoordinator({
    orgs,
    ops,
    principalLinks,
    outbox,
    clock,
    signer,
    nextId,
    adminRoles,
    configureActions,
    activationLifetime,
    activationSecret,
  });

  // The outbox drain. `failTransport` consumes the injected failures, so a
  // message whose attempt failed stays in the outbox for the next call.
  const deliver = (): Promise<number> =>
    deliverPending({
      orgs,
      ops,
      outbox,
      delivered,
      failTransport: () => {
        if (transportFailures > 0) {
          transportFailures -= 1;
          return true;
        }
        return false;
      },
      now: () => clock.now(),
    });

  const checkVersion = (v: AuthorityInterfaceVersion): Failure | undefined =>
    v !== AUTHORITY_INTERFACE_VERSION ? { kind: "wrong-interface-version" } : undefined;

  // --- the runtime ----------------------------------------------------------------------
  //
  // The version gate precedes the drain in every method: a call the runtime
  // refuses must not even deliver pending coordinator messages — a rejected
  // caller causes no side effects, and delivery is one.

  const runtime: AuthorityRuntime = {
    async activationRequest(input: ActivationRequestInput): Promise<ActivationRequestResult | Failed> {
      const versionFail = checkVersion(input.interfaceVersion);
      if (versionFail !== undefined) return failed(versionFail);
      await deliver();
      return organizations.activationRequest(input);
    },

    async activationInspect(input: ActivationInspectInput): Promise<ActivationInspection | Failed> {
      const versionFail = checkVersion(input.interfaceVersion);
      if (versionFail !== undefined) return failed(versionFail);
      await deliver();
      return organizations.activationInspect(input);
    },

    async activationAccept(input: ActivationAcceptInput): Promise<ActivationAcceptance | Failed> {
      const versionFail = checkVersion(input.interfaceVersion);
      if (versionFail !== undefined) return failed(versionFail);
      await deliver();
      return organizations.activationAccept(input);
    },

    async accessFromEvidence(input: AccessFromEvidenceInput): Promise<AccessIssue | Failed> {
      const versionFail = checkVersion(input.interfaceVersion);
      if (versionFail !== undefined) return failed(versionFail);
      await deliver();
      return operations.accessFromEvidence(input);
    },

    async refresh(input: RefreshInput): Promise<AccessIssue | Failed> {
      const versionFail = checkVersion(input.interfaceVersion);
      if (versionFail !== undefined) return failed(versionFail);
      await deliver();
      return operations.refresh(input);
    },

    async context(input: ContextRequest): Promise<AuthorityContext | Failed> {
      const versionFail = checkVersion(input.interfaceVersion);
      if (versionFail !== undefined) return failed(versionFail);
      await deliver();
      return operations.context(input);
    },

    async command(inputCommand: AuthorityCommand): Promise<CommandResult> {
      const versionFail = checkVersion(inputCommand.interfaceVersion);
      if (versionFail !== undefined) return fail(versionFail.kind);
      await deliver();

      // request-access needs no administrator: the evidence is the request
      if (inputCommand.kind === "request-access") return operations.requestAccess(inputCommand);

      // which operation this command binds to, if any: `disable-actor` is
      // organization-scoped and binds to none
      const boundOperation = inputCommand.kind === "disable-actor" ||
        inputCommand.kind === "unlink-principal" ||
        inputCommand.kind === "revoke-activation" ||
        inputCommand.kind === "create-actor" ||
        inputCommand.kind === "update-actor" ||
        inputCommand.kind === "appoint-administrator" ||
        inputCommand.kind === "retire-administrator"
        ? undefined
        : "operationId" in inputCommand
          ? operationId(inputCommand.operationId)
          : undefined;
      const principalOrFailure = await organizations.resolvePrincipal(inputCommand.authorization, boundOperation);
      if ("kind" in principalOrFailure) return fail(principalOrFailure.kind, principalOrFailure.detail);

      switch (inputCommand.kind) {
        case "participation-accept":
        case "disable-actor":
        case "unlink-principal":
        case "revoke-activation":
        case "create-actor":
        case "update-actor":
        case "appoint-administrator":
        case "retire-administrator":
          return organizations.command(inputCommand, principalOrFailure);
        case "participation-revoke":
          return inputCommand.by === "operation"
            ? operations.command(inputCommand, principalOrFailure)
            : organizations.command(inputCommand, principalOrFailure);
        case "participation-invite":
        case "admit":
        case "grant-hat":
        case "revoke-grant":
        case "select-hat":
        case "request-team":
        case "admit-team":
        case "update-team":
        case "retire-team":
          return operations.command(inputCommand, principalOrFailure);
        default: {
          // The exhaustiveness witness: this arm is `never` when every
          // command kind has a case, so adding one fails the build here
          // instead of silently routing to invalid-command. The failure —
          // not a throw — stays: a caller that bypasses the types (an
          // untyped host, a structurally stale version) still gets the
          // closed taxonomy, never an exception.
          inputCommand satisfies never;
          return fail("invalid-command", "unknown command kind");
        }
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
    drainOutbox: deliver,
    pendingOutbox: () => outbox.length,
    snapshotOf,
    invitationsOf: (organizationOf) =>
      new Map(
        [...(orgs.get(organizationOf)?.invitations.entries() ?? [])].map(
          ([invitationId, invitation]) => [invitationId, { operationId: invitation.operationId, status: invitation.status }],
        ),
      ),
    accessRequestsOf: (operationOf) =>
      (ops.get(operationOf)?.accessRequests ?? []).map((request) => ({ ...request })),
  };
};
