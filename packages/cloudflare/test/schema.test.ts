// The schema modules own the DDL and the additive migration chain. These
// tests pin the named steps and exercise an old coordinator shape: the base
// tables survive, the missing table/columns are added, and the stored version
// advances to the current one.

import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  initializeOrganizationSchema,
  ORGANIZATION_SCHEMA_VERSION,
  organizationMigrations,
} from "../src/schema/organization";
import {
  initializeOperationSchema,
  OPERATION_SCHEMA_VERSION,
  operationMigrations,
} from "../src/schema/operation";

const columns = (sql: SqlStorage, table: string): Set<string> =>
  new Set(
    sql.exec<{ readonly name: string }>(`PRAGMA table_info(${table})`)
      .toArray()
      .map((row) => String(row.name)),
  );

const version = (sql: SqlStorage): string =>
  String(sql.exec<{ readonly value: string }>("SELECT value FROM meta WHERE key = 'schema_version'")
    .toArray()[0]?.value ?? "");

describe("the schema migration chain", () => {
  it("names every additive step in version order", () => {
    expect(organizationMigrations.map(({ version, name }) => [version, name])).toEqual([
      ["2", "activation-requests"],
      ["3", "display-short-name"],
      ["4", "credentials"],
    ]);
    expect(operationMigrations.map(({ version, name }) => [version, name])).toEqual([
      ["3", "refresh-authentication-facts"],
      ["4", "operation-routing-facts"],
      ["5", "team-status"],
      ["6", "display-short-name"],
      ["7", "team-short-name"],
    ]);
    expect(organizationMigrations.at(-1)?.version).toBe(ORGANIZATION_SCHEMA_VERSION);
    expect(operationMigrations.at(-1)?.version).toBe(OPERATION_SCHEMA_VERSION);
  });

  it("adds the organization table a schema-1 object lacks", async () => {
    const stub = env.ORGANIZATION.get(env.ORGANIZATION.idFromName("org-schema-migrate"));
    const result = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec("DROP TABLE activation_requests");
      sql.exec("UPDATE meta SET value = '1' WHERE key = 'schema_version'");

      initializeOrganizationSchema(sql);
      initializeOrganizationSchema(sql); // constructor reruns are harmless

      return {
        activationRequests: sql.exec<{ readonly name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'activation_requests'",
        ).toArray().length,
        version: version(sql),
      };
    });

    expect(result).toEqual({ activationRequests: 1, version: ORGANIZATION_SCHEMA_VERSION });
  });

  it("fills the operation columns and team status an older object lacks", async () => {
    const stub = env.OPERATION.get(env.OPERATION.idFromName("op-schema-migrate"));
    const result = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql;
      for (const [table, column] of [
        ["operation", "slug"],
        ["sites", "path"],
        ["refresh_records", "amr_json"],
        ["refresh_records", "auth_time"],
        ["teams", "status"],
      ] as const) {
        sql.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      }
      // A team that predates the status column was active by definition.
      sql.exec(
        "INSERT INTO teams (team_id, site_id, organization_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        "team-schema-migrate",
        "site-schema-migrate",
        "org-schema-migrate",
        0,
        0,
      );
      sql.exec("UPDATE meta SET value = '2' WHERE key = 'schema_version'");

      initializeOperationSchema(sql);
      initializeOperationSchema(sql); // constructor reruns are harmless

      const team = sql.exec<{ readonly status: string }>(
        "SELECT status FROM teams WHERE team_id = ?",
        "team-schema-migrate",
      ).toArray()[0];
      return {
        operation: columns(sql, "operation").has("slug"),
        sites: columns(sql, "sites").has("path"),
        amr: columns(sql, "refresh_records").has("amr_json"),
        authTime: columns(sql, "refresh_records").has("auth_time"),
        teamStatus: team?.status,
        version: version(sql),
      };
    });

    expect(result).toEqual({
      operation: true,
      sites: true,
      amr: true,
      authTime: true,
      teamStatus: "active",
      version: OPERATION_SCHEMA_VERSION,
    });
  });
});
