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

/** The operator identity the ops surface forwarded on `x-ops-operator`, as a
 * spreadable fragment so an absent header stays an absent property rather
 * than an explicit `undefined`.
 *
 * The edge validated and bounded the value; a coordinator is reached only
 * through a binding, so there is nothing further to check here. It is an
 * attribution aid, never an authorization input: no handler may branch on it. */
export const operatorIdOf = (request: Request): { readonly operatorId?: string } => {
  const given = request.headers.get("x-ops-operator");
  return given === null || given.length === 0 ? {} : { operatorId: given };
};

/** A finite whole number, refused rather than coerced.
 *
 * `Number(...)` is not a parser: it turns `"abc"` into `NaN`, `null` into `0`,
 * and the JSON literal `1e999` into `Infinity`, and each of those then travels
 * as if it were the number the caller meant. Where the value bounds a security
 * control — an envelope lifetime bounds replay — a silently coerced one is the
 * control failing open, so this refuses at the boundary. */
export const asWholeNumber = (input: unknown, field: string): number => {
  if (typeof input !== "number" || !Number.isInteger(input)) {
    throw new Error(`${field} must be a whole number`);
  }
  return input;
};

/** A duration or count: whole and above zero. Separate from `asWholeNumber`
 * because positivity is the field's constraint rather than the type's — an
 * epoch second passes the first and a lifetime must pass this one. */
export const asPositiveWholeNumber = (input: unknown, field: string): number => {
  const parsed = asWholeNumber(input, field);
  if (parsed <= 0) throw new Error(`${field} must be greater than zero`);
  return parsed;
};

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

export const asBoolean = (input: unknown, field: string): boolean => {
  if (typeof input !== "boolean") throw new Error(`${field} must be a boolean`);
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
