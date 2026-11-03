// The organization coordinator's HTTP boundary: routes, body parsing, and
// reply statuses. The coordinator supplies use cases only; this module owns
// everything that reads a request.

import {
  asArray,
  asRecord,
  asString,
  failure,
  json,
  readBody,
  value,
  type Result,
  operatorIdOf,
} from "./parse";
import type {
  AcceptInput,
  ActivationAcceptInput,
  ActivationRequestInput,
  AdministratorInput,
  BootstrapInput,
  CreateActorInput,
  DisableInput,
  RecoveryInput,
  RevokeInput,
  UpdateActorInput,
} from "../organization";

export interface OrganizationRouteHost {
  bootstrap(input: BootstrapInput): Result<unknown>;
  resolve(provider: string, subject: string): Result<unknown>;
  principalLinks(): readonly { readonly provider: string; readonly subject: string; readonly actorId: string }[];
  linkPrincipal(input: { readonly provider: string; readonly subject: string; readonly actorId: string }): Result<unknown>;
  activationRequest(input: ActivationRequestInput): Result<unknown>;
  activationInspect(secretHash: string): Result<unknown>;
  activationPreflight(input: ActivationAcceptInput): Result<unknown>;
  activationAccept(input: ActivationAcceptInput): Result<unknown>;
  revokeActivation(input: RecoveryInput): Result<unknown>;
  unlinkPrincipal(input: RecoveryInput): Result<unknown>;
  invite(invitationId: string, operationId: string): Result<unknown>;
  intakeParticipationRevoked(operationId: string): Result<unknown>;
  drain(): Promise<{ readonly delivered: number; readonly pending: number }>;
  accept(input: AcceptInput): Result<unknown>;
  revoke(input: RevokeInput): Result<unknown>;
  disable(input: DisableInput): Result<unknown>;
  createActor(input: CreateActorInput): Result<unknown>;
  updateActor(input: UpdateActorInput): Result<unknown>;
  appointAdministrator(input: AdministratorInput): Result<unknown>;
  retireAdministrator(input: AdministratorInput): Result<unknown>;
  isAdmin(actorId: string): boolean;
  actorView(actorId: string): {
    readonly actorId: string;
    readonly displayName?: string;
    readonly disabled: boolean;
    readonly linked: boolean;
  } | undefined;
  rosterView(): {
    readonly organizationId: string | null;
    readonly actors: readonly { readonly actorId: string; readonly disabled: boolean }[];
  };
  idpConfig(): { readonly present: boolean; readonly config?: string };
  organizationSummary(): { readonly organizationId: string | null; readonly displayName: string | null };
  reset(): Result<unknown>;
  status(): Record<string, unknown>;
  exportSnapshot(): unknown;
  restoreSnapshot(input: unknown, operatorId?: string): Result<unknown>;
  auditRows(): readonly Record<string, unknown>[];
  outboxRows(): readonly Record<string, unknown>[];
  markDelivered(id: string): Result<unknown>;
}

export const handleOrganizationRequest = async (
  request: Request,
  host: OrganizationRouteHost,
): Promise<Response> => {
  const url = new URL(request.url);

  try {
    if (request.method === "POST" && url.pathname === "/bootstrap") {
      const body = await readBody(request);
      return json(host.bootstrap({
        organizationId: asString(body["organizationId"], "organizationId"),
        ...(body["displayName"] === undefined ? {} : { displayName: asString(body["displayName"], "displayName") }),
        actors: asArray(body["actors"], "actors").map((entry) => {
          const actor = asRecord(entry);
          return {
            actorId: asString(actor["actorId"], "actorId"),
            ...(actor["displayName"] === undefined ? {} : { displayName: asString(actor["displayName"], "displayName") }),
            ...(actor["disabled"] === true ? { disabled: true } : {}),
          };
        }),
        principalLinks: asArray(body["principalLinks"], "principalLinks").map((entry) => {
          const link = asRecord(entry);
          return {
            provider: asString(link["provider"], "provider"),
            subject: asString(link["subject"], "subject"),
            actorId: asString(link["actorId"], "actorId"),
          };
        }),
        orgAdmins: asArray(body["orgAdmins"], "orgAdmins").map((entry) => asString(entry, "orgAdmins entry")),
        ...(body["sealedIdpConfig"] === undefined ? {} : { sealedIdpConfig: asString(body["sealedIdpConfig"], "sealedIdpConfig") }),
      }));
    }

    if (request.method === "GET" && url.pathname === "/resolve") {
      return json(host.resolve(
        asString(url.searchParams.get("provider"), "provider"),
        asString(url.searchParams.get("subject"), "subject"),
      ));
    }

    if (request.method === "GET" && url.pathname === "/principal-links") {
      return json(value({ links: host.principalLinks() }));
    }

    if (request.method === "POST" && url.pathname === "/principal-link") {
      const body = await readBody(request);
      const result = host.linkPrincipal({
        provider: asString(body["provider"], "provider"),
        subject: asString(body["subject"], "subject"),
        actorId: asString(body["actorId"], "actorId"),
      });
      return json(result, result.ok ? 200 : result.failure.kind === "unavailable" ? 503 : 400);
    }

    if (request.method === "POST" && url.pathname === "/activation-request") {
      const input = await readBody(request);
      return json(host.activationRequest({
        actorId: asString(input["actorId"], "actorId"),
        byActorId: asString(input["byActorId"], "byActorId"),
        secretHash: asString(input["secretHash"], "secretHash"),
        ...(input["operator"] === true ? { operator: true } : {}),
        ...operatorIdOf(request),
      }));
    }

    if (request.method === "POST" && url.pathname === "/activation-inspect") {
      const body = await readBody(request);
      return json(host.activationInspect(asString(body["secretHash"], "secretHash")));
    }

    if (request.method === "POST" && (url.pathname === "/activation-preflight" || url.pathname === "/activation-accept")) {
      const body = await readBody(request);
      const input: ActivationAcceptInput = {
        secretHash: asString(body["secretHash"], "secretHash"),
        provider: asString(body["provider"], "provider"),
        subject: asString(body["subject"], "subject"),
      };
      return json(url.pathname === "/activation-preflight"
        ? host.activationPreflight(input)
        : host.activationAccept(input));
    }

    if (request.method === "POST" && (url.pathname === "/revoke-activation" || url.pathname === "/unlink-principal")) {
      const body = await readBody(request);
      const input: RecoveryInput = {
        actorId: asString(body["actorId"], "actorId"),
        byActorId: asString(body["byActorId"], "byActorId"),
        idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
        ...(body["operator"] === true ? { operator: true } : {}),
        ...operatorIdOf(request),
      };
      return json(url.pathname === "/revoke-activation"
        ? host.revokeActivation(input)
        : host.unlinkPrincipal(input));
    }

    if (request.method === "POST" && url.pathname === "/invite") {
      const body = await readBody(request);
      return json(host.invite(
        asString(body["invitationId"], "invitationId"),
        asString(body["operationId"], "operationId"),
      ));
    }

    if (request.method === "POST" && url.pathname === "/intake") {
      const body = await readBody(request);
      const kind = asString(body["kind"], "kind");
      if (kind === "invitation") {
        const result = host.invite(
          asString(body["invitationId"], "invitationId"),
          asString(body["operationId"], "operationId"),
        );
        return json(result, result.ok ? 200 : 503);
      }
      if (kind === "participation-revoked") {
        return json(host.intakeParticipationRevoked(asString(body["operationId"], "operationId")));
      }
      return json(failure("invalid-command", `unknown intake kind ${kind}`), 400);
    }

    if (request.method === "POST" && url.pathname === "/drain") {
      return json(value(await host.drain()));
    }

    if (request.method === "POST" && url.pathname === "/accept") {
      const body = await readBody(request);
      return json(host.accept({
        operationId: asString(body["operationId"], "operationId"),
        actorId: asString(body["actorId"], "actorId"),
        idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
      }));
    }

    if (request.method === "POST" && url.pathname === "/revoke") {
      const body = await readBody(request);
      return json(host.revoke({
        operationId: asString(body["operationId"], "operationId"),
        actorId: asString(body["actorId"], "actorId"),
        idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
      }));
    }

    if (request.method === "POST" && url.pathname === "/disable") {
      const body = await readBody(request);
      return json(host.disable({
        actorId: asString(body["actorId"], "actorId"),
        byActorId: asString(body["byActorId"], "byActorId"),
        idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
      }));
    }

    if (request.method === "POST" && url.pathname === "/create-actor") {
      const body = await readBody(request);
      return json(host.createActor({
        actorId: asString(body["actorId"], "actorId"),
        ...(body["displayName"] === undefined ? {} : { displayName: asString(body["displayName"], "displayName") }),
        byActorId: asString(body["byActorId"], "byActorId"),
        idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
      }));
    }

    if (request.method === "POST" && url.pathname === "/update-actor") {
      const body = await readBody(request);
      return json(host.updateActor({
        actorId: asString(body["actorId"], "actorId"),
        displayName: body["displayName"] === null ? null : asString(body["displayName"], "displayName"),
        byActorId: asString(body["byActorId"], "byActorId"),
        idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
      }));
    }

    if (request.method === "POST" && (url.pathname === "/appoint-administrator" || url.pathname === "/retire-administrator")) {
      const body = await readBody(request);
      const input: AdministratorInput = {
        actorId: asString(body["actorId"], "actorId"),
        byActorId: asString(body["byActorId"], "byActorId"),
        idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
      };
      return json(url.pathname === "/appoint-administrator"
        ? host.appointAdministrator(input)
        : host.retireAdministrator(input));
    }

    if (request.method === "GET" && url.pathname === "/admin") {
      return json(value({ admin: host.isAdmin(asString(url.searchParams.get("actorId"), "actorId")) }));
    }

    if (request.method === "GET" && url.pathname === "/actor") {
      const actor = host.actorView(asString(url.searchParams.get("actorId"), "actorId"));
      return actor === undefined
        ? json(failure("unauthenticated", "unknown actor"), 404)
        : json(value(actor));
    }

    if (request.method === "GET" && url.pathname === "/roster") {
      // the reconciliation direction: an operation pulls this to repair a
      // roster push that never arrived
      return json(value(host.rosterView()));
    }

    if (request.method === "GET" && url.pathname === "/idp-config") {
      return json(value(host.idpConfig()));
    }

    if (request.method === "GET" && url.pathname === "/organization") {
      return json(value(host.organizationSummary()));
    }

    if (request.method === "POST" && url.pathname === "/reset") {
      return json(host.reset());
    }

    if (request.method === "GET" && url.pathname === "/status") {
      return json(value(host.status()));
    }

    if (request.method === "GET" && url.pathname === "/export") {
      return json(value(host.exportSnapshot()));
    }

    if (request.method === "POST" && url.pathname === "/restore") {
      // The identity rides the header, not the body: the body is the snapshot
      // itself, and wrapping it would change the export/restore contract.
      return json(host.restoreSnapshot(await request.json(), operatorIdOf(request).operatorId));
    }

    if (request.method === "GET" && url.pathname === "/audit") {
      return json(value(host.auditRows()));
    }

    if (request.method === "GET" && url.pathname === "/outbox") {
      return json(value(host.outboxRows()));
    }

    const delivered = /^\/outbox\/([^/]+)\/delivered$/.exec(url.pathname);
    if (request.method === "POST" && delivered !== null) {
      return json(host.markDelivered(decodeURIComponent(delivered[1] ?? "")));
    }

    return json(failure("wrong-binding", "unknown organization route"), 404);
  } catch (error) {
    return json(failure("invalid-command", error instanceof Error ? error.message : "invalid request"), 400);
  }
};
