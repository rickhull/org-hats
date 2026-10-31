// The request boundary: body parsing, domain-id conversions, and the two
// response shapes the coordinators return. Kept outside the coordinator
// classes so a route change never reaches into storage.

import {
  actorId,
  operationId,
  organizationId,
  siteId,
  teamId,
  type ActorId,
  type Failure,
  type GrantTarget,
  type OperationId,
  type OrganizationId,
  type SiteId,
  type TeamId,
  type Unbranded,
} from "org-hats/authority";

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: Failure };

export const failure = (kind: Failure["kind"], detail?: string): { readonly ok: false; readonly failure: Failure } => ({
  ok: false,
  failure: { kind, ...(detail !== undefined ? { detail } : {}) },
});

export const value = <T>(input: T): { readonly ok: true; readonly value: T } => ({ ok: true, value: input });

export const asRecord = (input: unknown): Record<string, unknown> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("the request body must be a JSON object");
  }
  return input as Record<string, unknown>;
};

export const asString = (input: unknown, field: string): string => {
  if (typeof input !== "string" || input.length === 0) throw new Error(`${field} must be a non-empty string`);
  return input;
};

export const asArray = (input: unknown, field: string): unknown[] => {
  if (!Array.isArray(input)) throw new Error(`${field} must be an array`);
  return input;
};

// The command-handler seam: a request body carries opaque strings, and these
// are where one becomes a domain id. Declared outside the coordinators so a
// method parameter cannot shadow them.
export const asOrganizationId = (input: unknown, field: string): OrganizationId =>
  organizationId(asString(input, field));
export const asActorId = (input: unknown, field: string): ActorId => actorId(asString(input, field));
export const asOperationId = (input: unknown, field: string): OperationId =>
  operationId(asString(input, field));
export const asSiteId = (input: unknown, field: string): SiteId => siteId(asString(input, field));
export const asTeamId = (input: unknown, field: string): TeamId => teamId(asString(input, field));

/** A grant target, from a request body. The union is what makes "exactly
 * one target" a parse concern rather than a validation concern: the body
 * either names a team or a site, and anything else never becomes a
 * `GrantTarget` at all. */
export const asGrantTarget = (input: unknown, field: string): Unbranded<GrantTarget> => {
  const target = asRecord(input);
  const kind = asString(target["kind"], `${field}.kind`);
  if (kind === "team") return { kind: "team", teamId: asString(target["teamId"], `${field}.teamId`) };
  if (kind === "site") return { kind: "site", siteId: asString(target["siteId"], `${field}.siteId`) };
  throw new Error(`${field}.kind must be "team" or "site"`);
};

export const json = (body: unknown, status = 200): Response => Response.json(body, { status });

export const readBody = async (request: Request): Promise<Record<string, unknown>> =>
  asRecord(await request.json());
