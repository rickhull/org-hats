// The operation coordinator's HTTP boundary: routes, body parsing, and reply
// statuses. The coordinator supplies use cases only; this module owns
// everything that reads a request.

import type {
  ActorId,
  AuthenticationFacts,
  OrganizationId,
  PolicyBundle,
} from "org-hats/authority";
import {
  asActorId,
  asArray,
  asGrantTarget,
  asOrganizationId,
  asRecord,
  asString,
  failure,
  json,
  readBody,
  value,
  type Result,
} from "./parse";
import type {
  AccessRequestCommand,
  AdmitCommand,
  BootstrapInput,
  GrantCommand,
  IntakeMessage,
  InviteInput,
  RevokeGrantCommand,
  RoutingFactsInput,
  SelectHatCommand,
  TeamAdmitInput,
  TeamRequestInput,
  TeamRetireInput,
  TeamUpdateInput,
} from "../operation";

export interface OperationRouteHost {
  bootstrap(input: BootstrapInput): Result<unknown>;
  reconcileRosters(force?: boolean): Promise<{ readonly synced: number; readonly organizations: number }>;
  setRoutingFacts(input: RoutingFactsInput): Result<unknown>;
  invite(input: InviteInput): Result<unknown>;
  intake(input: IntakeMessage): Result<unknown>;
  revokeParticipation(organizationId: string, byActorId: string, idempotencyKey: string): Result<unknown>;
  grant(input: GrantCommand): Result<unknown>;
  revokeGrant(input: RevokeGrantCommand): Result<unknown>;
  selectHat(input: SelectHatCommand): Result<unknown>;
  requestAccess(input: AccessRequestCommand): Result<unknown>;
  admit(input: AdmitCommand): Result<unknown>;
  requestTeam(input: TeamRequestInput): Result<unknown>;
  admitTeam(input: TeamAdmitInput): Result<unknown>;
  updateTeam(input: TeamUpdateInput): Result<unknown>;
  retireTeam(input: TeamRetireInput): Result<unknown>;
  recordRefresh(handleHash: string, organizationId: string, actorId: string): Result<unknown>;
  issue(organizationId: OrganizationId, actorId: ActorId, auth?: AuthenticationFacts): Promise<Result<unknown>>;
  refresh(handle: string): Promise<Result<unknown>>;
  reset(): Result<unknown>;
  adminRoles(): readonly string[];
  configureActions(): readonly string[];
  envelopeLifetime(): number;
  context(organizationId: OrganizationId, actorId: ActorId, role: string): Result<unknown>;
  drain(): Promise<{ readonly delivered: number; readonly pending: number }>;
  status(): Record<string, unknown>;
  exportSnapshot(): unknown;
  restoreSnapshot(input: unknown): Result<unknown>;
  snapshot(): Record<string, unknown>;
  auditRows(): readonly Record<string, unknown>[];
  outboxRows(): readonly Record<string, unknown>[];
}

export const handleOperationRequest = async (
  request: Request,
  host: OperationRouteHost,
): Promise<Response> => {
  const url = new URL(request.url);

  try {
    if (request.method === "POST" && url.pathname === "/bootstrap") {
      const body = await readBody(request);
      const policy = asRecord(body["policy"]) as unknown as PolicyBundle;
      const input: BootstrapInput = {
        operationId: asString(body["operationId"], "operationId"),
        slug: asString(body["slug"], "slug"),
        ...(body["displayName"] === undefined ? {} : { displayName: asString(body["displayName"], "displayName") }),
        ...(body["bounded"] === true ? { bounded: true } : {}),
        policy,
        ...(body["adminRoles"] === undefined ? {} : { adminRoles: asArray(body["adminRoles"], "adminRoles").map((entry) => asString(entry, "adminRoles entry")) }),
        ...(body["configureActions"] === undefined ? {} : { configureActions: asArray(body["configureActions"], "configureActions").map((entry) => asString(entry, "configureActions entry")) }),
        ...(body["envelopeLifetimeSeconds"] === undefined ? {} : { envelopeLifetimeSeconds: Number(body["envelopeLifetimeSeconds"]) }),
        sites: asArray(body["sites"], "sites").map((entry) => {
          const site = asRecord(entry);
          return {
            siteId: asString(site["siteId"], "siteId"),
            path: asString(site["path"], "path"),
            ...(site["displayName"] === undefined ? {} : { displayName: asString(site["displayName"], "displayName") }),
            aliases: asArray(site["aliases"] ?? [], "aliases").map((alias) => asString(alias, "alias")),
          };
        }),
        teams: asArray(body["teams"], "teams").map((entry) => {
          const team = asRecord(entry);
          return {
            teamId: asString(team["teamId"], "teamId"),
            siteId: asString(team["siteId"], "siteId"),
            organizationId: asString(team["organizationId"], "organizationId"),
            ...(team["displayName"] === undefined ? {} : { displayName: asString(team["displayName"], "displayName") }),
          };
        }),
        grants: asArray(body["grants"] ?? [], "grants").map((entry) => {
          const grant = asRecord(entry);
          return {
            grantId: asString(grant["grantId"], "grantId"),
            organizationId: asString(grant["organizationId"], "organizationId"),
            actorId: asString(grant["actorId"], "actorId"),
            role: asString(grant["role"], "role"),
            target: asGrantTarget(grant["target"], "target"),
            ...(grant["primary"] === true ? { primary: true } : {}),
            ...(grant["revoked"] === true ? { revoked: true } : {}),
          };
        }),
        participations: asArray(body["participations"] ?? [], "participations").map((entry) => {
          const participation = asRecord(entry);
          const status = asString(participation["status"], "status");
          if (!["invited", "accepted", "active", "revoked"].includes(status)) throw new Error("invalid participation status");
          return {
            organizationId: asString(participation["organizationId"], "organizationId"),
            status: status as "invited" | "accepted" | "active" | "revoked",
          };
        }),
      };
      const bootstrapped = host.bootstrap(input);
      // Populate the projection before anything reads it. A bootstrap that
      // declares active participations and grants must be able to issue on
      // the next request, and the push channel carries only changes made
      // after the relationship exists — so the first image has to be
      // pulled here.
      if (bootstrapped.ok) await host.reconcileRosters(true);
      return json(bootstrapped);
    }

    if (request.method === "POST" && url.pathname === "/routing-facts") {
      const body = await readBody(request);
      return json(host.setRoutingFacts({
        slug: asString(body["slug"], "slug"),
        sites: asArray(body["sites"], "sites").map((entry) => {
          const site = asRecord(entry);
          return { siteId: asString(site["siteId"], "siteId"), path: asString(site["path"], "path") };
        }),
      }));
    }

    if (request.method === "POST" && url.pathname === "/invite") {
      const body = await readBody(request);
      return json(host.invite({
        ...(body["invitationId"] === undefined ? {} : { invitationId: asString(body["invitationId"], "invitationId") }),
        organizationId: asString(body["organizationId"], "organizationId"),
        byActorId: asString(body["byActorId"], "byActorId"),
        idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
      }));
    }

    if (request.method === "POST" && url.pathname === "/intake") {
      const body = await readBody(request);
      const result = host.intake({
        messageId: asString(body["messageId"], "messageId"),
        kind: asString(body["kind"], "kind"),
        ...(body["invitationId"] === undefined ? {} : { invitationId: asString(body["invitationId"], "invitationId") }),
        ...(body["organizationId"] === undefined ? {} : { organizationId: asString(body["organizationId"], "organizationId") }),
        ...(body["operationId"] === undefined ? {} : { operationId: asString(body["operationId"], "operationId") }),
        ...(body["actorId"] === undefined ? {} : { actorId: asString(body["actorId"], "actorId") }),
        ...(typeof body["at"] === "number" ? { at: body["at"] } : {}),
        ...(body["actors"] === undefined ? {} : {
          actors: asArray(body["actors"], "actors").map((entry) => {
            const actor = asRecord(entry);
            return {
              actorId: asString(actor["actorId"], "actorId"),
              disabled: actor["disabled"] === true,
            };
          }),
        }),
      });
      return json(result, result.ok ? 200 : 503);
    }

    if (request.method === "POST" && url.pathname === "/revoke-participation") {
      const body = await readBody(request);
      return json(host.revokeParticipation(
        asString(body["organizationId"], "organizationId"),
        asString(body["byActorId"], "byActorId"),
        asString(body["idempotencyKey"], "idempotencyKey"),
      ));
    }

    if (request.method === "POST" && url.pathname === "/grant") {
      const body = await readBody(request);
      return json(host.grant({
        ...(body["grantId"] === undefined ? {} : { grantId: asString(body["grantId"], "grantId") }),
        organizationId: asString(body["organizationId"], "organizationId"),
        actorId: asString(body["actorId"], "actorId"),
        role: asString(body["role"], "role"),
        target: asGrantTarget(body["target"], "target"),
        ...(body["primary"] === true ? { primary: true } : {}),
        byActorId: asString(body["byActorId"], "byActorId"),
        idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
      }));
    }

    if (request.method === "POST" && url.pathname === "/revoke-grant") {
      const body = await readBody(request);
      return json(host.revokeGrant({
        grantId: asString(body["grantId"], "grantId"),
        byActorId: asString(body["byActorId"], "byActorId"),
        idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
      }));
    }

    if (request.method === "POST" && url.pathname === "/select-hat") {
      const body = await readBody(request);
      return json(host.selectHat({
        grantId: asString(body["grantId"], "grantId"),
        actorId: asString(body["actorId"], "actorId"),
        byActorId: asString(body["byActorId"], "byActorId"),
        idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
      }));
    }

    if (request.method === "POST" && url.pathname === "/request-access") {
      const body = await readBody(request);
      return json(host.requestAccess({
        ...(body["requestId"] === undefined ? {} : { requestId: asString(body["requestId"], "requestId") }),
        organizationId: asString(body["organizationId"], "organizationId"),
        actorId: asString(body["actorId"], "actorId"),
        ...(body["note"] === undefined ? {} : { note: asString(body["note"], "note") }),
        idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
      }));
    }

    if (request.method === "POST" && url.pathname === "/admit") {
      const body = await readBody(request);
      return json(host.admit({
        organizationId: asString(body["organizationId"], "organizationId"),
        actorId: asString(body["actorId"], "actorId"),
        byActorId: asString(body["byActorId"], "byActorId"),
        idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
      }));
    }

    if (request.method === "POST" && url.pathname === "/request-team") {
      const body = await readBody(request);
      return json(host.requestTeam({
        teamId: asString(body["teamId"], "teamId"),
        siteId: asString(body["siteId"], "siteId"),
        organizationId: asString(body["organizationId"], "organizationId"),
        ...(body["displayName"] === undefined ? {} : { displayName: asString(body["displayName"], "displayName") }),
        byActorId: asString(body["byActorId"], "byActorId"),
        byOrganizationId: asString(body["byOrganizationId"], "byOrganizationId"),
        idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
      }));
    }

    if (request.method === "POST" && url.pathname === "/admit-team") {
      const body = await readBody(request);
      return json(host.admitTeam({
        teamId: asString(body["teamId"], "teamId"),
        byActorId: asString(body["byActorId"], "byActorId"),
        idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
      }));
    }

    if (request.method === "POST" && url.pathname === "/update-team") {
      const body = await readBody(request);
      return json(host.updateTeam({
        teamId: asString(body["teamId"], "teamId"),
        displayName: body["displayName"] === null ? null : asString(body["displayName"], "displayName"),
        byActorId: asString(body["byActorId"], "byActorId"),
        byOrganizationId: asString(body["byOrganizationId"], "byOrganizationId"),
        idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
      }));
    }

    if (request.method === "POST" && url.pathname === "/retire-team") {
      const body = await readBody(request);
      return json(host.retireTeam({
        teamId: asString(body["teamId"], "teamId"),
        byActorId: asString(body["byActorId"], "byActorId"),
        byOrganizationId: asString(body["byOrganizationId"], "byOrganizationId"),
        asOperationAdmin: body["asOperationAdmin"] === true,
        idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
      }));
    }

    if (request.method === "POST" && url.pathname === "/refresh-record") {
      const body = await readBody(request);
      return json(host.recordRefresh(
        asString(body["handleHash"], "handleHash"),
        asString(body["organizationId"], "organizationId"),
        asString(body["actorId"], "actorId"),
      ));
    }

    if (request.method === "POST" && url.pathname === "/issue") {
      const body = await readBody(request);
      const auth: AuthenticationFacts | undefined =
        body["amr"] === undefined && body["authTime"] === undefined
          ? undefined
          : {
              ...(body["amr"] === undefined ? {} : { amr: asArray(body["amr"], "amr").map((entry) => asString(entry, "amr entry")) }),
              ...(body["authTime"] === undefined ? {} : { authTime: Number(body["authTime"]) }),
            };
      const result = await host.issue(
        asOrganizationId(body["organizationId"], "organizationId"),
        asActorId(body["actorId"], "actorId"),
        auth,
      );
      return json(result, result.ok ? 200 : 400);
    }

    if (request.method === "POST" && url.pathname === "/refresh") {
      const body = await readBody(request);
      const result = await host.refresh(asString(body["handle"], "handle"));
      return json(result, result.ok ? 200 : 400);
    }

    if (request.method === "POST" && url.pathname === "/reset") {
      return json(host.reset());
    }

    if (request.method === "GET" && url.pathname === "/config") {
      return json(value({
        adminRoles: host.adminRoles(),
        configureActions: host.configureActions(),
        envelopeLifetimeSeconds: host.envelopeLifetime(),
      }));
    }

    if (request.method === "POST" && url.pathname === "/context") {
      const body = await readBody(request);
      return json(host.context(
        asOrganizationId(body["organizationId"], "organizationId"),
        asActorId(body["actorId"], "actorId"),
        asString(body["role"], "role"),
      ));
    }

    if (request.method === "POST" && url.pathname === "/reconcile-rosters") {
      // forced reconciliation, for an operator repairing a stale projection
      // and for tests that must not wait out the cadence
      return json(value(await host.reconcileRosters(true)));
    }

    if (request.method === "POST" && url.pathname === "/drain") {
      return json(value(await host.drain()));
    }

    if (request.method === "GET" && url.pathname === "/status") return json(value(host.status()));
    if (request.method === "GET" && url.pathname === "/export") return json(value(host.exportSnapshot()));
    if (request.method === "POST" && url.pathname === "/restore") {
      const restored = host.restoreSnapshot(await request.json());
      // rebuild the derived projection, so a restored operation can decide
      // again without waiting for the reconciliation interval
      if (restored.ok) await host.reconcileRosters(true);
      return json(restored);
    }
    if (request.method === "GET" && url.pathname === "/snapshot") return json(value(host.snapshot()));
    if (request.method === "GET" && url.pathname === "/audit") return json(value(host.auditRows()));
    if (request.method === "GET" && url.pathname === "/outbox") {
      return json(value(host.outboxRows().map((row) => ({
        id: String(row["id"]),
        kind: String(row["kind"]),
        target: String(row["target"]),
        payload: JSON.parse(String(row["payload"])) as unknown,
      }))));
    }

    return json(failure("wrong-binding", "unknown operation route"), 404);
  } catch (error) {
    return json(failure("invalid-command", error instanceof Error ? error.message : "invalid request"), 400);
  }
};
