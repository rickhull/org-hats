/** Typed reads of a SQLite row.
 *
 * The coordinators' rows arrive as `Record<string, string | number | null>`,
 * and every value was converted by hand at its use site — seventy-odd
 * `String(row["organization_id"])` calls with no shared decoder. Two things
 * go wrong that way: a column name is spelled out once per read, and an id
 * leaving storage enters the domain with nothing marking the conversion.
 *
 * These readers hold each column name once and brand on the way out, so a
 * row value becomes a domain value in exactly one place per kind.
 */

import {
  actorId,
  operationId,
  organizationId,
  siteId,
  teamId,
  type ActorId,
  type OperationId,
  type OrganizationId,
  type SiteId,
  type TeamId,
} from "org-hats/authority";

export type Row = Record<string, string | number | null>;

export const rowText = (row: Row, column: string): string => String(row[column]);

/** `undefined` for SQL NULL, so an absent column stays absent rather than
 * becoming the string "null". */
export const rowTextOrUndefined = (row: Row, column: string): string | undefined =>
  row[column] === null || row[column] === undefined ? undefined : String(row[column]);

export const rowFlag = (row: Row, column: string): boolean => Number(row[column]) === 1;

export const rowNumber = (row: Row, column: string): number => Number(row[column]);

export const rowOrganizationId = (row: Row, column = "organization_id"): OrganizationId =>
  organizationId(rowText(row, column));

export const rowActorId = (row: Row, column = "actor_id"): ActorId => actorId(rowText(row, column));

export const rowOperationId = (row: Row, column = "operation_id"): OperationId =>
  operationId(rowText(row, column));

export const rowSiteId = (row: Row, column = "site_id"): SiteId => siteId(rowText(row, column));

export const rowTeamId = (row: Row, column = "team_id"): TeamId => teamId(rowText(row, column));
