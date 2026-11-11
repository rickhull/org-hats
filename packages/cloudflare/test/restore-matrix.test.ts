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
import { call, organizationBootstrap, restoreAuditOf, withoutRestoreAudit } from "./helpers";
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
    operation: ["slug", "short_name"],
    sites: ["path", "short_name"],
    teams: ["status", "short_name"],
  },
  "3": { operation: ["slug", "short_name"], sites: ["path", "short_name"], teams: ["status", "short_name"] },
  "4": { operation: ["short_name"], sites: ["short_name"], teams: ["status", "short_name"] },
  "5": { operation: ["short_name"], sites: ["short_name"], teams: ["short_name"] },
  "6": { teams: ["short_name"] },
  "7": {},
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
  // that version lacked comes back null; teams default active below 5, the
  // schema that added the status column.
  const tables: Record<string, StateRow[]> = {};
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    const absent = ABSENT[version]?.[table] ?? [];
    tables[table] = rows.map((row) => {
      const filled: Record<string, string | number | null> = { ...row };
      for (const column of absent) filled[column] = null;
      if (table === "teams" && Number(version) < 5) filled.status = "active";
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
    expect(source.schemaVersion).toBe("7");
    expect(source.tables["refresh_records"]?.length ?? 0).toBeGreaterThan(0);
    expect(source.tables["teams"]?.some((team) => team.status === "retired")).toBe(true);
    // The refresh table carries records without authentication facts too
    // (the admin issuance above); assert on the one that has them.
    const withAuth = source.tables["refresh_records"]?.find((row) => row.amr_json !== null);
    expect(withAuth).toBeDefined();
    expect(withAuth?.auth_time).not.toBeNull();

    for (const version of ["2", "3", "4", "5", "6", "7"]) {
      const target = `op-restore-matrix-${version}`;
      const restored = await restore("operation", target, atSchema(source, version));
      expect(restored.status).toBe(200);
      expect(restored.body.ok).toBe(true);

      const after = await exportCoordinator("operation", target);
      expect(after.schemaVersion).toBe("7");
      expect(withoutRestoreAudit(after).tables).toEqual(asRestored(source, version));

      // The named claims, stated once for the record. Schema 5 added the
      // team status column, so only an export older than 5 loses a retired
      // team to the active default.
      if (Number(version) < 5) {
        const teams = after.tables["teams"] ?? [];
        expect(teams.every((team) => team.status === "active")).toBe(true);
      } else {
        expect(after.tables["teams"]?.some((team) => team.status === "retired")).toBe(true);
      }
      // Schema 6 added the short display label; an older export restores it
      // as null rather than inventing one.
      if (Number(version) < 6) {
        expect(after.tables["operation"]?.[0]?.short_name).toBeNull();
        expect(after.tables["sites"]?.every((site) => site.short_name === null)).toBe(true);
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
      {
        kind: "update-team",
        operationId: OP,
        teamId: "team-restore-roundtrip",
        longName: "Restored Crew",
        shortName: "RC",
      },
      FRESH,
      "roundtrip-update-team",
    );

    const sourceOperation = await exportCoordinator("operation", OP);
    const sourceOrganization = await exportCoordinator("organization", HARBOR);
    expect(sourceOrganization.tables["actors"]?.some((row) => row["actor_id"] === "actor-restore-hand")).toBe(true);
    expect(sourceOperation.tables["teams"]?.some((row) =>
      row["team_id"] === "team-restore-roundtrip" &&
      row["display_name"] === "Restored Crew" &&
      row["short_name"] === "RC" &&
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

    expect(withoutRestoreAudit(await exportCoordinator("operation", targetOperation))).toEqual(sourceOperation);
    expect(withoutRestoreAudit(await exportCoordinator("organization", targetOrganization))).toEqual(sourceOrganization);
  }, 60_000);

  it("refuses a future schema version for both coordinators", async () => {
    const world = await createCloudflareConformanceWorld(env);
    const operationSnapshot = await exportCoordinator("operation", "op-9f2e6ad4");
    const organizationSnapshot = await exportCoordinator("organization", "org-4c1f9a2e");

    const futureOperation = await restore(
      "operation",
      "op-restore-matrix-future",
      { ...operationSnapshot, schemaVersion: "8" },
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
      { ...organizationSnapshot, schemaVersion: "4" },
    );
    expect(futureOrganization.body.failure?.kind).toBe("invalid-command");
  }, 60_000);
});

describe("a crafted snapshot's undelivered outbox rows", () => {
  // The threat model records this as residual risk: "a crafted snapshot's
  // undelivered outbox rows are re-delivered as if fresh." It is the one
  // accepted behaviour in the model with no test behind it, which is exactly
  // the kind of claim that drifts. Both halves are pinned here — the
  // redelivery happens, and the receiving coordinator absorbs it, because
  // the organization drains with `messageId` set to the outbox row's id and
  // the operation's intake is claim-deduped on `intake:<messageId>`. The row
  // id survives a restore, so the replay is recognised.
  //
  // That dedupe does more than stop a double application. Remove it and the
  // replayed messages no longer apply, so they are never marked delivered
  // and the outbox retries them forever: the second drain reports zero
  // delivered and the rows stay pending. Recognising the replay is what lets
  // a redelivered message be accepted and retired.
  const LEAD = "actor-lead";

  it("are redelivered, and the receiving intake applies them only once", async () => {
    const suffix = "replay-outbox";
    const orgId = `org-${suffix}`;
    const opId = `op-${suffix}`;
    const org = env.ORGANIZATION.get(env.ORGANIZATION.idFromName(orgId));
    const op = env.OPERATION.get(env.OPERATION.idFromName(opId));

    expect((await call(org, "POST", "/bootstrap", organizationBootstrap(orgId))).body.ok).toBe(true);
    expect((await call(op, "POST", "/bootstrap", {
      operationId: opId,
      slug: "replay-op",
      longName: "Replay Operation",
      policy: {
        format: 1,
        id: "policy-replay",
        version: "1",
        actions: ["observe", "review", "configure"],
        roles: [
          { title: "field", actions: ["observe"] },
          { title: "admin", actions: ["observe", "review", "configure"] },
        ],
        readPolicy: { organizations: "granted-teams" },
      },
      adminRoles: ["admin"],
      configureActions: ["configure"],
      sites: [{ siteId: "site-replay", path: "site", aliases: ["site"] }],
      teams: [],
      grants: [],
      participations: [],
    })).body.ok).toBe(true);

    // walk the real workflow so the outbox row is a genuine delivered message
    const invited = await call<{ invitationId?: string }>(op, "POST", "/invite", {
      organizationId: orgId,
      byActorId: LEAD,
      idempotencyKey: "replay-invite",
    });
    expect(invited.body.ok).toBe(true);
    expect((await call(op, "POST", "/drain")).body.ok).toBe(true);
    expect((await call(org, "POST", "/accept", {
      operationId: opId,
      actorId: LEAD,
      idempotencyKey: "replay-accept",
    })).body.ok).toBe(true);

    // bootstrap's roster pull queues its own messages alongside the
    // acceptance, so the count is discovered rather than assumed
    const firstDrain = await call<{ delivered: number; pending: number }>(org, "POST", "/drain");
    expect(firstDrain.body.value?.pending).toBe(0);
    const deliveredCount = firstDrain.body.value?.delivered ?? 0;
    expect(deliveredCount).toBeGreaterThan(0);

    const activations = async (): Promise<number> => {
      const trail = await call<readonly { fact: string }[]>(op, "GET", "/audit");
      return (trail.body.value ?? []).filter((entry) => entry.fact.includes("active (canonical)")).length;
    };
    expect(await activations()).toBe(1);

    // craft the snapshot: the delivered acceptance becomes undelivered again,
    // which is precisely what the model says an operator can hand back
    const snapshot = await exportCoordinator("organization", orgId);
    const outbox = snapshot.tables["outbox"] ?? [];
    expect(outbox.length).toBe(deliveredCount);
    for (const row of outbox) expect(row["delivered_at"]).not.toBeNull();
    const crafted = {
      ...snapshot,
      tables: {
        ...snapshot.tables,
        outbox: outbox.map((row) => ({ ...row, delivered_at: null })),
      },
    };
    expect((await restore("organization", orgId, crafted)).status).toBe(200);

    // the redelivery is real — the model's claim stands, for every row
    const second = await call<{ delivered: number; pending: number }>(org, "POST", "/drain");
    expect(second.body.value?.delivered).toBe(deliveredCount);

    // and it is absorbed: the consequence is narrower than "as if fresh"
    expect(await activations()).toBe(1);
    const participations = await call<Record<string, unknown>>(op, "GET", "/snapshot");
    const rows = participations.body.value?.["participations"] as { organization_id: string; status: string }[];
    expect(rows.find((row) => row.organization_id === orgId)?.status).toBe("active");
  });
});

describe("a crafted snapshot and an actor's standing", () => {
  // The threat model says a restore reinstates `revoked`/`superseded` as the
  // snapshot states them, and that A13's live organization read still gates
  // the next refresh. That was a reading, not a test, and a residual-risk
  // statement with no witness is the claim most likely to drift.
  //
  // Writing it showed the sentence names the wrong field. A disable does not
  // revoke the handle at all: the handle stays live and *issuance* refuses,
  // because the operation's `org_actors` projection says the actor is
  // disabled. And that projection is deliberately absent from the export
  // (`state.ts`: "a snapshot that carried it would restore a stale roster as
  // authority"), so a crafted snapshot has no field in which to express an
  // actor's standing. Un-revoking every refresh record is a no-op against a
  // gate that never consulted them.
  const LEAD = "actor-lead";
  const CREW = "actor-crew";

  it("cannot resurrect the handle of an actor the organization disabled", async () => {
    const orgId = "org-restore-unrevoke";
    const opId = "op-restore-unrevoke";
    const org = env.ORGANIZATION.get(env.ORGANIZATION.idFromName(orgId));
    const op = env.OPERATION.get(env.OPERATION.idFromName(opId));

    expect((await call(org, "POST", "/bootstrap", organizationBootstrap(orgId))).body.ok).toBe(true);
    expect((await call(op, "POST", "/bootstrap", {
      operationId: opId,
      slug: "unrevoke-op",
      policy: {
        format: 1,
        id: "policy-unrevoke",
        version: "1",
        actions: ["observe"],
        roles: [{ title: "field", actions: ["observe"] }],
        readPolicy: { organizations: "granted-teams" },
      },
      adminRoles: ["admin"],
      configureActions: ["configure"],
      sites: [{ siteId: "site-unrevoke", path: "s", aliases: [] }],
      teams: [{ teamId: "team-unrevoke", siteId: "site-unrevoke", organizationId: orgId }],
      grants: [{
        grantId: "g-unrevoke",
        organizationId: orgId,
        actorId: CREW,
        role: "field",
        target: { kind: "team", teamId: "team-unrevoke" },
        primary: true,
      }],
      participations: [{ organizationId: orgId, status: "active" }],
    })).body.ok).toBe(true);

    const issued = await call<{ refresh: { handle: string } }>(op, "POST", "/issue", {
      organizationId: orgId,
      actorId: CREW,
    });
    expect(issued.body.ok).toBe(true);
    const handle = issued.body.value?.refresh.handle ?? "";
    expect(handle).toBeTruthy();

    expect((await call(org, "POST", "/disable", {
      actorId: CREW,
      byActorId: LEAD,
      idempotencyKey: "unrevoke-disable",
    })).body.ok).toBe(true);
    expect((await call(org, "POST", "/drain")).body.ok).toBe(true);

    // the gate is the projection, not the record
    const afterDisable = await call(op, "POST", "/refresh", { handle });
    expect(afterDisable.body.ok).toBe(false);
    expect(afterDisable.body.failure?.kind).toBe("not-admitted");
    expect(afterDisable.body.failure?.detail).toBe("actor disabled");

    const snapshot = await exportCoordinator("operation", opId);
    // the structural defence, which nothing asserted before: standing is not
    // a field a snapshot can carry
    expect(Object.keys(snapshot.tables)).not.toContain("org_actors");
    // and the records a snapshot *can* carry were never the gate
    const records = snapshot.tables["refresh_records"] ?? [];
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((row) => Number(row["revoked"]) === 0)).toBe(true);

    const crafted = {
      ...snapshot,
      tables: {
        ...snapshot.tables,
        refresh_records: records.map((row) => ({ ...row, revoked: 0, superseded: 0 })),
        // an attacker's best attempt at standing: a table the restore ignores
        org_actors: [{ organization_id: orgId, actor_id: CREW, disabled: 0 }],
      },
    };
    expect((await restore("operation", opId, crafted)).status).toBe(200);

    // the handle still buys nothing: the projection rebuilt by pulling the
    // organization's current state, where the actor is disabled
    const afterRestore = await call(op, "POST", "/refresh", { handle });
    expect(afterRestore.body.ok).toBe(false);
    expect(afterRestore.body.failure?.kind).toBe("not-admitted");
  }, 30_000);
});
