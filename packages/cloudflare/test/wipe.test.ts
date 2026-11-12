// The wipe suite: true operation deletion through the operator surface.
// Delete clears every operation-owned fact — audit, replay claims, and the
// outbox included — leaves the coordinator uninitialized, refuses a
// mismatched target before any mutation, is idempotent without writing an
// audit row, and export answers absence explicitly. Late roster and
// acceptance pushes must not repopulate a wiped coordinator. The
// organization side gains a scoped forget-operation act that removes one
// operation's invitation, outbox, claim, and audit facts while every other
// fact survives.

import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call, organizationBootstrap } from "./helpers";

const LEAD = "actor-lead";
const SITE = "site-test";
const TEAM = "team-test";

const OPS = { authorization: "Bearer test-ops-token" };

const ops = async (path: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch(`https://authority.internal${path}`, {
    ...init,
    headers: { ...OPS, ...(init.headers ?? {}) },
  });

interface World {
  readonly orgId: string;
  readonly opId: string;
  readonly org: DurableObjectStub;
  readonly op: DurableObjectStub;
}

const world = (suffix: string): World => {
  const orgId = `org-${suffix}`;
  const opId = `op-${suffix}`;
  return {
    orgId,
    opId,
    org: env.ORGANIZATION.get(env.ORGANIZATION.idFromName(orgId)),
    op: env.OPERATION.get(env.OPERATION.idFromName(opId)),
  };
};

const bootstrapOrganization = async (current: World) =>
  call(current.org, "POST", "/bootstrap", organizationBootstrap(current.orgId));

const operationBootstrap = (opId: string, orgId: string) => ({
  operationId: opId,
  slug: "test-op",
  longName: "Test Operation",
  participations: [{ organizationId: orgId, status: "active" }],
  policy: {
    format: 1,
    id: "policy-test",
    version: "1",
    actions: ["observe", "review", "configure"],
    roles: [
      { title: "field", actions: ["observe"] },
      { title: "lead", actions: ["observe", "review"] },
      { title: "admin", actions: ["observe", "review", "configure"] },
    ],
    readPolicy: { organizations: "granted-teams" },
  },
  adminRoles: ["admin"],
  configureActions: ["configure"],
  sites: [{ siteId: SITE, path: "site", aliases: ["site"] }],
  teams: [{ teamId: TEAM, siteId: SITE, organizationId: orgId }],
  grants: [],
});

/** A bootstrapped operation with a live roster projection, audit rows, and
 * replay claims — a tree that has decided things, so the wipe has something
 * to retain-nothing over. */
const bootstrapped = async (current: World): Promise<void> => {
  await bootstrapOrganization(current);
  const bootstrappedOperation = await call(
    current.op,
    "POST",
    "/bootstrap",
    operationBootstrap(current.opId, current.orgId),
  );
  expect(bootstrappedOperation.body.ok).toBe(true);
};

const statusOf = async (current: World): Promise<Record<string, unknown>> => {
  const status = await call<Record<string, unknown>>(current.op, "GET", "/status");
  expect(status.body.ok).toBe(true);
  return status.body.value ?? {};
};

const auditOf = async (stub: DurableObjectStub): Promise<readonly { readonly fact: string }[]> => {
  const audit = await call<readonly { readonly fact: string }[]>(stub, "GET", "/audit");
  expect(audit.body.ok).toBe(true);
  return audit.body.value ?? [];
};

const exportOf = async (current: World): Promise<Record<string, unknown>> => {
  const exported = await call<Record<string, unknown>>(current.op, "GET", "/export");
  expect(exported.body.ok).toBe(true);
  return exported.body.value ?? {};
};

describe("operation delete", () => {
  it("refuses a mismatched target before any mutation", async () => {
    const current = world("mismatch");
    await bootstrapped(current);
    const before = await statusOf(current);

    const refused = await call(current.op, "POST", "/delete", { operationId: "op-someone-else" });

    expect(refused.body.ok).toBe(false);
    expect(refused.body.failure?.kind).toBe("wrong-binding");
    // nothing changed: the tree still reads as the bootstrapped operation
    expect(await statusOf(current)).toEqual(before);
  });

  it("wipes every operation-owned fact, keeps the schema, and reports absence", async () => {
    const current = world("wipe");
    await bootstrapped(current);
    const schemaBefore = (await statusOf(current))["schemaVersion"];
    expect(schemaBefore).not.toBe("0");

    const wiped = await call<{ readonly deleted: boolean }>(current.op, "POST", "/delete", { operationId: current.opId });
    expect(wiped.body.ok).toBe(true);
    expect(wiped.body.value?.deleted).toBe(true);

    // absence, not a snapshot of empty tables
    const exported = await exportOf(current);
    expect(exported["absent"]).toBe(true);
    expect(exported["coordinator"]).toBe("operation");

    const status = await statusOf(current);
    expect(status["operationId"]).toBeNull();
    for (const field of ["teams", "grants", "participations", "invitations", "refreshRecords", "accessRequests", "outbox", "audit", "orgActors"]) {
      expect(status[field], field).toBe(0);
    }
    expect(await auditOf(current.op)).toEqual([]);
    // migration state is not operation fact
    expect(status["schemaVersion"]).toBe(schemaBefore);
  });

  it("is idempotent and writes no audit row on retry", async () => {
    const current = world("retry");
    await bootstrapped(current);
    await call(current.op, "POST", "/delete", { operationId: current.opId });

    const again = await call<{ readonly deleted: boolean }>(current.op, "POST", "/delete", { operationId: current.opId });
    expect(again.body.ok).toBe(true);
    expect(again.body.value?.deleted).toBe(true);
    expect(await auditOf(current.op)).toEqual([]);
  });

  it("delivers late roster and acceptance pushes without repopulating", async () => {
    const current = world("late");
    await bootstrapped(current);
    await call(current.op, "POST", "/delete", { operationId: current.opId });

    // delivered, not applied — the organization's drain must not wedge on a
    // coordinator that no longer decides anything
    const roster = await call<{ readonly applied: boolean }>(current.op, "POST", "/intake", {
      messageId: "late-roster",
      kind: "roster",
      organizationId: current.orgId,
      actors: [{ actorId: LEAD, disabled: false }],
      at: 4102444800,
    });
    expect(roster.body.ok).toBe(true);
    expect(roster.body.value?.applied).toBe(false);

    const acceptance = await call<{ readonly applied: boolean }>(current.op, "POST", "/intake", {
      messageId: "late-acceptance",
      kind: "acceptance",
      invitationId: "inv-late",
    });
    expect(acceptance.body.ok).toBe(true);
    expect(acceptance.body.value?.applied).toBe(false);

    // explicit absence must not hide a partly repopulated coordinator
    const status = await statusOf(current);
    expect(status["orgActors"]).toBe(0);
    expect(status["audit"]).toBe(0);
    const exported = await exportOf(current);
    expect(exported["absent"]).toBe(true);
  });

  it("bootstraps again after a wipe", async () => {
    const current = world("rebootstrap");
    await bootstrapped(current);
    await call(current.op, "POST", "/delete", { operationId: current.opId });

    const again = await call(current.op, "POST", "/bootstrap", operationBootstrap(current.opId, current.orgId));
    expect(again.body.ok).toBe(true);

    const exported = await exportOf(current);
    expect(exported["absent"]).toBeUndefined();
    expect(exported["tables"]).toBeDefined();
  });

  it("routes through the worker and export carries the requested id", async () => {
    const current = world("worker");
    await bootstrapped(current);

    const wiped = await ops("/ops/operation/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operationId: current.opId }),
    });
    expect(wiped.status).toBe(200);
    expect(((await wiped.json()) as { ok: boolean; value?: { deleted: boolean } }).value?.deleted).toBe(true);

    const response = await ops(`/ops/export?coordinator=operation&id=${current.opId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { absent: boolean; coordinator: string; operationId: string };
    expect(body.absent).toBe(true);
    expect(body.coordinator).toBe("operation");
    expect(body.operationId).toBe(current.opId);
  });
});

describe("organization forget-operation", () => {
  /** An organization holding accepted participation in one operation and a
   * pending invitation from another, so scoping is observable. */
  const participating = async (suffix: string): Promise<World> => {
    const current = world(suffix);
    await bootstrapOrganization(current);
    await call(current.org, "POST", "/invite", { invitationId: "inv-a", operationId: current.opId });
    const accepted = await call(current.org, "POST", "/accept", {
      operationId: current.opId,
      actorId: LEAD,
      idempotencyKey: "accept-1",
    });
    expect(accepted.body.ok).toBe(true);
    await call(current.org, "POST", "/invite", { invitationId: "inv-b", operationId: `op-${suffix}-other` });
    const otherAccepted = await call(current.org, "POST", "/accept", {
      operationId: `op-${suffix}-other`,
      actorId: LEAD,
      idempotencyKey: "accept-other",
    });
    expect(otherAccepted.body.ok).toBe(true);
    return current;
  };

  it("removes the operation's facts and preserves everything else", async () => {
    const current = await participating("scope");
    const before = await auditOf(current.org);
    expect(before.some((row) => new RegExp(`${current.opId}(?![\\w-])`).test(row.fact))).toBe(true);
    expect(before.some((row) => row.fact.includes("inv-a"))).toBe(true);

    const forgotten = await call<{ readonly forgotten: boolean }>(current.org, "POST", "/forget-operation", { operationId: current.opId });
    expect(forgotten.body.ok).toBe(true);
    expect(forgotten.body.value?.forgotten).toBe(true);

    // the operation's audit facts are gone, the other operation's remain
    // (boundary-aware: one operation id is not a substring match on another)
    const names = (id: string): RegExp => new RegExp(`${id}(?![\\w-])`);
    const after = await auditOf(current.org);
    expect(after.some((row) => names(current.opId).test(row.fact))).toBe(false);
    expect(after.some((row) => row.fact.includes("inv-a"))).toBe(false);
    expect(after.some((row) => names("op-scope-other").test(row.fact))).toBe(true);

    // organization-owned facts survive: this is not an organization wipe
    const directory = await call<{ readonly actors: readonly unknown[] }>(current.org, "GET", "/actor-directory");
    expect((directory.body.value?.actors ?? []).length).toBe(2);
    const links = await call<{ readonly links: readonly unknown[] }>(current.org, "GET", "/principal-links");
    expect((links.body.value?.links ?? []).length).toBe(2);
    const admin = await call<{ readonly admin: boolean }>(current.org, "GET", "/admin?actorId=actor-lead");
    expect(admin.body.value?.admin).toBe(true);

    // outbox rows targeting the operation are gone; the other's remain
    const outbox = await call<readonly { readonly target: string }[]>(current.org, "GET", "/outbox");
    const rows = outbox.body.value ?? [];
    expect(rows.some((row) => row.target === current.opId)).toBe(false);
    expect(rows.some((row) => row.target === `op-scope-other`)).toBe(true);
  });

  it("is idempotent and leaves no new audit row", async () => {
    const current = await participating("idem");
    await call(current.org, "POST", "/forget-operation", { operationId: current.opId });
    const afterFirst = await auditOf(current.org);

    const again = await call<{ readonly forgotten: boolean }>(current.org, "POST", "/forget-operation", { operationId: current.opId });
    expect(again.body.ok).toBe(true);
    expect(again.body.value?.forgotten).toBe(true);

    expect(await auditOf(current.org)).toEqual(afterFirst);
  });

  it("routes through the worker", async () => {
    const current = await participating("worker");
    const response = await ops("/ops/organization/forget-operation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: current.orgId, operationId: current.opId }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; value?: { forgotten: boolean } };
    expect(body.ok).toBe(true);
    expect(body.value?.forgotten).toBe(true);
  });
});
