import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ADMIN = "actor-admin";
const MEMBER = "actor-member";
const SITE = "site-test";
const TEAM = "team-test";

interface Envelope<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly failure?: { readonly kind: string; readonly detail?: string };
}

interface World {
  readonly orgId: string;
  readonly opId: string;
  readonly org: DurableObjectStub;
  readonly op: DurableObjectStub;
}

/** The coordinator ids are the addresses: the operation invites
 * `idFromName(organizationId)`, and the organization replies to
 * `idFromName(operationId)`. Each test gets its own pair. */
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

const call = async <T>(
  stub: DurableObjectStub,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Envelope<T> }> => {
  const response = await stub.fetch(`https://authority.internal${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
};

const bootstrapOrganization = async (current: World) =>
  call(current.org, "POST", "/bootstrap", {
    organizationId: current.orgId,
    displayName: "Cedar Works",
    actors: [
      { actorId: ADMIN, displayName: "Nia Fields" },
      { actorId: MEMBER, displayName: "Sam Whitfield" },
    ],
    principalLinks: [
      { provider: "idp", subject: "admin", actorId: ADMIN },
      { provider: "idp", subject: "member", actorId: MEMBER },
    ],
    orgAdmins: [ADMIN],
    sealedIdpConfig: "sealed:test-only",
  });

const bootstrapOperation = async (current: World) =>
  call(current.op, "POST", "/bootstrap", {
    operationId: current.opId,
    displayName: "Test Operation",
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
    sites: [{ siteId: SITE, aliases: ["site"] }],
    teams: [{ teamId: TEAM, siteId: SITE, organizationId: current.orgId }],
    grants: [
      {
        grantId: "g-field",
        organizationId: current.orgId,
        actorId: MEMBER,
        role: "field",
        teamId: TEAM,
        primary: true,
      },
    ],
  });

const invite = async (current: World, key = "invite-1") =>
  call<{ applied: boolean; invitationId?: string }>(current.op, "POST", "/invite", {
    organizationId: current.orgId,
    byActorId: ADMIN,
    idempotencyKey: key,
  });

const accept = async (current: World, key = "accept-1") =>
  call<{ applied: boolean }>(current.org, "POST", "/accept", {
    operationId: current.opId,
    actorId: ADMIN,
    idempotencyKey: key,
  });

const drain = async (stub: DurableObjectStub) =>
  call<{ delivered: number; pending: number }>(stub, "POST", "/drain");

describe("OperationAuthority", () => {
  it("moves an invitation through org authority and back as active participation", async () => {
    const current = world("flow");
    await bootstrapOrganization(current);
    await bootstrapOperation(current);

    const invited = await invite(current);
    expect(invited.body.ok).toBe(true);
    expect(invited.body.value?.invitationId).toBeDefined();
    expect((await drain(current.op)).body.value).toEqual({ delivered: 1, pending: 0 });

    const orgStatus = await call<Record<string, unknown>>(current.org, "GET", "/status");
    expect(orgStatus.body.value?.["invitations"]).toBe(1);

    const accepted = await accept(current);
    expect(accepted.body.ok).toBe(true);
    expect(accepted.body.value?.applied).toBe(true);
    expect((await drain(current.org)).body.value).toEqual({ delivered: 1, pending: 0 });

    const snapshot = await call<Record<string, unknown>>(current.op, "GET", "/snapshot");
    const participations = snapshot.body.value?.["participations"] as { organization_id: string; status: string }[];
    expect(participations.find((p) => p.organization_id === current.orgId)?.status).toBe("active");

    const retry = await accept(current, "accept-1");
    expect(retry.body.ok).toBe(true);
    expect(retry.body.value?.applied).toBe(false);
  });

  it("retries a delivery through the alarm when the organization is not ready", async () => {
    const current = world("retry");
    await bootstrapOperation(current);
    await invite(current, "invite-retry");
    const first = await drain(current.op);
    expect(first.body.value?.pending).toBe(1);

    // The alarm runs while the organization is still absent: still pending.
    await runDurableObjectAlarm(current.op);
    const stillPending = await call<Record<string, unknown>>(current.op, "GET", "/status");
    expect(stillPending.body.value?.["outbox"]).toBe(1);

    await bootstrapOrganization(current);
    await runDurableObjectAlarm(current.op);
    const delivered = await call<Record<string, unknown>>(current.op, "GET", "/status");
    expect(delivered.body.value?.["outbox"]).toBe(0);
    const orgStatus = await call<Record<string, unknown>>(current.org, "GET", "/status");
    expect(orgStatus.body.value?.["invitations"]).toBe(1);
  });

  it("grants, selects, revokes, and revokes refresh records idempotently", async () => {
    const current = world("grants");
    await bootstrapOperation(current);

    const grant = await call<{ applied: boolean; grantId?: string }>(current.op, "POST", "/grant", {
      grantId: "g-new",
      organizationId: current.orgId,
      actorId: MEMBER,
      role: "lead",
      teamId: TEAM,
      byActorId: ADMIN,
      idempotencyKey: "grant-1",
    });
    expect(grant.body.ok).toBe(true);
    expect(grant.body.value?.applied).toBe(true);
    const retry = await call<{ applied: boolean }>(current.op, "POST", "/grant", {
      grantId: "g-new",
      organizationId: current.orgId,
      actorId: MEMBER,
      role: "lead",
      teamId: TEAM,
      byActorId: ADMIN,
      idempotencyKey: "grant-1",
    });
    expect(retry.body.value?.applied).toBe(false);

    const misuse = await call(current.op, "POST", "/grant", {
      grantId: "g-new",
      organizationId: current.orgId,
      actorId: MEMBER,
      role: "field",
      teamId: TEAM,
      byActorId: ADMIN,
      idempotencyKey: "grant-1",
    });
    expect(misuse.body.failure?.kind).toBe("invalid-command");

    const selected = await call(current.op, "POST", "/select-hat", {
      grantId: "g-new",
      actorId: MEMBER,
      byActorId: MEMBER,
      idempotencyKey: "select-1",
    });
    expect(selected.body.ok).toBe(true);
    const recorded = await call(current.op, "POST", "/refresh-record", {
      handleHash: "hash-1",
      organizationId: current.orgId,
      actorId: MEMBER,
    });
    expect(recorded.body.ok).toBe(true);
    const before = await call<Record<string, unknown>>(current.op, "GET", "/snapshot");
    const grants = before.body.value?.["grants"] as { grantId: string; primary: boolean }[];
    expect(grants.find((grant) => grant.grantId === "g-new")?.primary).toBe(true);

    const revoked = await call(current.op, "POST", "/revoke-grant", {
      grantId: "g-new",
      byActorId: ADMIN,
      idempotencyKey: "revoke-1",
    });
    expect(revoked.body.ok).toBe(true);
    const after = await call<Record<string, unknown>>(current.op, "GET", "/snapshot");
    const records = after.body.value?.["refreshRecords"] as { handle_hash: string; revoked: number }[];
    expect(records.find((record) => record.handle_hash === "hash-1")?.revoked).toBe(1);
  });

  it("carries actor-disable from organization authority to operation refresh records", async () => {
    const current = world("disable-flow");
    await bootstrapOrganization(current);
    await bootstrapOperation(current);
    await invite(current, "invite-disable");
    await drain(current.op);
    await accept(current, "accept-disable");
    await drain(current.org);
    await call(current.op, "POST", "/refresh-record", {
      handleHash: "hash-disable",
      organizationId: current.orgId,
      actorId: MEMBER,
    });

    const disabled = await call(current.org, "POST", "/disable", {
      actorId: MEMBER,
      byActorId: ADMIN,
      idempotencyKey: "disable-1",
    });
    expect(disabled.body.ok).toBe(true);
    const delivery = await drain(current.org);
    expect(delivery.body.value?.delivered).toBe(1);

    const snapshot = await call<Record<string, unknown>>(current.op, "GET", "/snapshot");
    const records = snapshot.body.value?.["refreshRecords"] as { handle_hash: string; revoked: number }[];
    expect(records.find((record) => record.handle_hash === "hash-disable")?.revoked).toBe(1);
  });

  it("reconciles an operation-side participation revoke back to the organization", async () => {
    const current = world("revoke-flow");
    await bootstrapOrganization(current);
    await bootstrapOperation(current);
    await invite(current, "invite-revoke");
    await drain(current.op);
    await accept(current, "accept-revoke");
    await drain(current.org);

    const revoked = await call(current.op, "POST", "/revoke-participation", {
      organizationId: current.orgId,
      byActorId: ADMIN,
      idempotencyKey: "revoke-participation-1",
    });
    expect(revoked.body.ok).toBe(true);
    const delivery = await drain(current.op);
    expect(delivery.body.value?.delivered).toBe(1);

    const audit = await call<readonly { fact: string }[]>(current.org, "GET", "/audit");
    expect(audit.body.value?.some((entry) => entry.fact.includes("revoked by operation"))).toBe(true);
  });
});
