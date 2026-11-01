// The restore matrix: every
// supported export schema restores into a fresh coordinator, older columns
// read null rather than garbage, teams that predate the status column
// default active, an older team status is genuinely absent (not echoed), and
// a future schema version is refused instead of reinterpreted.
//
// The schema history is the additive migration chain in operation.ts's
// initialize(): schema 3 added refresh_records.amr_json/auth_time, schema 4
// added operation.slug and sites.path, schema 5 added teams.status. The
// organization side accepts schema 1 or the current version; schema-1
// restore is covered in ops.test.ts, and this file adds the future-version
// refusal for both coordinators.

import { SELF, env } from "cloudflare:test";
import { AUTHORITY_INTERFACE_VERSION, isFailed } from "org-hats/authority";
import { CONFORMANCE_PRINCIPALS } from "org-hats/conformance";
import { describe, expect, it } from "vitest";
import { createCloudflareConformanceWorld } from "../src/conformance";
import type { StateRow } from "../src/state";

const OPS = { authorization: "Bearer test-ops-token" };

const ops = async (path: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch(`https://authority.internal${path}`, {
    ...init,
    headers: { ...OPS, ...(init.headers ?? {}) },
  });

interface Snapshot {
  readonly coordinator: string;
  readonly schemaVersion: string;
  readonly tables: Record<string, StateRow[]>;
}

const exportCoordinator = async (coordinator: "operation" | "organization", id: string): Promise<Snapshot> => {
  const response = await ops(`/ops/export?coordinator=${coordinator}&id=${id}`);
  expect(response.status).toBe(200);
  return (await response.json()) as Snapshot;
};

const restore = async (coordinator: "operation" | "organization", id: string, snapshot: unknown) => {
  const response = await ops("/ops/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ coordinator, id, snapshot }),
  });
  return { status: response.status, body: (await response.json()) as { ok?: boolean; failure?: { kind: string } } };
};

/** Columns each older schema did not carry, by table. */
const ABSENT: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  "2": {
    refresh_records: ["amr_json", "auth_time"],
    operation: ["slug"],
    sites: ["path"],
    teams: ["status"],
  },
  "3": { operation: ["slug"], sites: ["path"], teams: ["status"] },
  "4": { teams: ["status"] },
  "5": {},
};

const atSchema = (snapshot: Snapshot, version: string): Snapshot => {
  const tables: Record<string, StateRow[]> = {};
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    const drop = new Set(ABSENT[version]?.[table] ?? []);
    tables[table] = rows.map((row) =>
      Object.fromEntries(Object.entries(row).filter(([column]) => !drop.has(column))),
    ) as StateRow[];
  }
  return { ...snapshot, schemaVersion: version, tables };
};

const asRestored = (snapshot: Snapshot, version: string): Record<string, StateRow[]> => {
  // What the restore must produce from a version-v snapshot: every column
  // that version lacked comes back null; teams default active below 5.
  const tables: Record<string, StateRow[]> = {};
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    const absent = ABSENT[version]?.[table] ?? [];
    tables[table] = rows.map((row) => {
      const filled: Record<string, string | number | null> = { ...row };
      for (const column of absent) filled[column] = null;
      if (table === "teams" && version !== "5") filled.status = "active";
      return filled as StateRow;
    });
  }
  return tables;
};

describe("the restore matrix", () => {
  it("restores every supported operation schema, defaulting and nulling honestly", async () => {
    const world = await createCloudflareConformanceWorld(env);
    const OP = "op-9f2e6ad4";

    // A retired team, so a non-active status exists to lose: restoring an
    // export that predates the status column must default it to active,
    // not echo a status the snapshot cannot carry.
    const admin = await world.runtime.accessFromEvidence({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: OP,
      evidence: CONFORMANCE_PRINCIPALS.len.evidence,
    });
    if (isFailed(admin)) throw new Error(`admin issuance failed: ${admin.failure.kind}`);
    const retired = await world.runtime.command({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      idempotencyKey: "restore-matrix-retire",
      authorization: { kind: "access-envelope", envelope: admin.envelope },
      kind: "retire-team",
      operationId: OP,
      teamId: "team-c7d9e2a1",
    } as never);
    expect(retired.ok ?? false).toBe(true);

    // Authentication facts on a refresh record, so the schema-2 strip has
    // non-null values to lose.
    const issued = await world.runtime.accessFromEvidence({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: OP,
      evidence: {
        ...CONFORMANCE_PRINCIPALS.sam.evidence,
        amr: ["pwd", "otp"],
        authTime: 1_700_000_000,
      },
    });
    if (isFailed(issued)) throw new Error(`sam issuance failed: ${issued.failure.kind}`);

    const source = await exportCoordinator("operation", OP);
    expect(source.schemaVersion).toBe("5");
    expect(source.tables["refresh_records"]?.length ?? 0).toBeGreaterThan(0);
    expect(source.tables["teams"]?.some((team) => team.status === "retired")).toBe(true);
    // The refresh table carries records without authentication facts too
    // (the admin issuance above); assert on the one that has them.
    const withAuth = source.tables["refresh_records"]?.find((row) => row.amr_json !== null);
    expect(withAuth).toBeDefined();
    expect(withAuth?.auth_time).not.toBeNull();

    for (const version of ["2", "3", "4", "5"]) {
      const target = `op-restore-matrix-${version}`;
      const restored = await restore("operation", target, atSchema(source, version));
      expect(restored.status).toBe(200);
      expect(restored.body.ok).toBe(true);

      const after = await exportCoordinator("operation", target);
      expect(after.schemaVersion).toBe("5");
      expect(after.tables).toEqual(asRestored(source, version));

      // The named claims, stated once for the record:
      if (version !== "5") {
        const teams = after.tables["teams"] ?? [];
        expect(teams.every((team) => team.status === "active")).toBe(true);
      } else {
        expect(after.tables["teams"]?.some((team) => team.status === "retired")).toBe(true);
      }
      if (version === "2") {
        expect(after.tables["refresh_records"]?.every((row) => row.amr_json === null && row.auth_time === null))
          .toBe(true);
        expect(after.tables["operation"]?.[0]?.slug).toBeNull();
        expect(after.tables["sites"]?.[0]?.path).toBeNull();
      }
      if (version === "3") {
        expect(after.tables["refresh_records"]?.some((row) => row.amr_json !== null)).toBe(true);
        expect(after.tables["operation"]?.[0]?.slug).toBeNull();
      }
      if (version === "4") {
        expect(after.tables["operation"]?.[0]?.slug).not.toBeNull();
      }
    }
  }, 60_000);

  it("round-trips command-built roster and team state", async () => {
    const world = await createCloudflareConformanceWorld(env);
    const OP = "op-9f2e6ad4";
    const HARBOR = "org-4c1f9a2e";
    const FRESH = {
      kind: "fresh-evidence" as const,
      evidence: CONFORMANCE_PRINCIPALS.dana.evidence,
      operationId: OP,
    };
    const run = async (body: Record<string, unknown>, authorization: unknown, key: string) => {
      const result = await world.runtime.command({
        interfaceVersion: AUTHORITY_INTERFACE_VERSION,
        idempotencyKey: key,
        authorization,
        ...body,
      } as never);
      expect(result.ok ?? false).toBe(true);
    };

    const admin = await world.runtime.accessFromEvidence({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: OP,
      evidence: CONFORMANCE_PRINCIPALS.len.evidence,
    });
    if (isFailed(admin)) throw new Error(`admin issuance failed: ${admin.failure.kind}`);
    const ADMIN = { kind: "access-envelope" as const, envelope: admin.envelope };

    await run(
      { kind: "create-actor", organizationId: HARBOR, actorId: "actor-restore-hand", displayName: "Restored Hand" },
      FRESH,
      "roundtrip-create",
    );
    await run(
      { kind: "update-actor", organizationId: HARBOR, actorId: "actor-3a91c4d8", displayName: "Restored Sam" },
      FRESH,
      "roundtrip-update",
    );
    await run(
      { kind: "appoint-administrator", organizationId: HARBOR, actorId: "actor-3a91c4d8" },
      FRESH,
      "roundtrip-appoint",
    );
    await run(
      { kind: "request-team", operationId: OP, organizationId: HARBOR, teamId: "team-restore-roundtrip", siteId: "site-e4a1c9b3" },
      FRESH,
      "roundtrip-request-team",
    );
    await run(
      { kind: "admit-team", operationId: OP, teamId: "team-restore-roundtrip" },
      ADMIN,
      "roundtrip-admit-team",
    );
    await run(
      { kind: "update-team", operationId: OP, teamId: "team-restore-roundtrip", displayName: "Restored Crew" },
      FRESH,
      "roundtrip-update-team",
    );

    const sourceOperation = await exportCoordinator("operation", OP);
    const sourceOrganization = await exportCoordinator("organization", HARBOR);
    expect(sourceOrganization.tables["actors"]?.some((row) => row["actor_id"] === "actor-restore-hand")).toBe(true);
    expect(sourceOperation.tables["teams"]?.some((row) =>
      row["team_id"] === "team-restore-roundtrip" &&
      row["display_name"] === "Restored Crew" &&
      row["status"] === "active",
    )).toBe(true);

    const targetOperation = "op-restore-roundtrip";
    const targetOrganization = "org-restore-roundtrip";
    const restoredOperation = await restore("operation", targetOperation, sourceOperation);
    expect(restoredOperation.status).toBe(200);
    expect(restoredOperation.body.ok).toBe(true);
    const restoredOrganization = await restore("organization", targetOrganization, sourceOrganization);
    expect(restoredOrganization.status).toBe(200);
    expect(restoredOrganization.body.ok).toBe(true);

    expect(await exportCoordinator("operation", targetOperation)).toEqual(sourceOperation);
    expect(await exportCoordinator("organization", targetOrganization)).toEqual(sourceOrganization);
  }, 60_000);

  it("refuses a future schema version for both coordinators", async () => {
    const world = await createCloudflareConformanceWorld(env);
    const operationSnapshot = await exportCoordinator("operation", "op-9f2e6ad4");
    const organizationSnapshot = await exportCoordinator("organization", "org-4c1f9a2e");

    const futureOperation = await restore(
      "operation",
      "op-restore-matrix-future",
      { ...operationSnapshot, schemaVersion: "6" },
    );
    expect(futureOperation.body.failure?.kind).toBe("invalid-command");

    const ancientOperation = await restore(
      "operation",
      "op-restore-matrix-ancient",
      { ...operationSnapshot, schemaVersion: "1" },
    );
    expect(ancientOperation.body.failure?.kind).toBe("invalid-command");

    const futureOrganization = await restore(
      "organization",
      "org-restore-matrix-future",
      { ...organizationSnapshot, schemaVersion: "3" },
    );
    expect(futureOrganization.body.failure?.kind).toBe("invalid-command");
  }, 60_000);
});
