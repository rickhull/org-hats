import { SELF, env } from "cloudflare:test";
import { ed25519VerifyKey, parseVerifyKeySet } from "org-hats/access";
import { describe, expect, it } from "vitest";
import { organizationBootstrap } from "./helpers";
import { bindPrincipalLink } from "../src/index";
import type { Env } from "../src/env";

const OPS = { authorization: "Bearer test-ops-token" };
const ORG = "org-ops";
const OP = "op-ops";
const RESTORED_ORG = "org-ops-restored";
const RESTORED_OP = "op-ops-restored";

const ops = async (path: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch(`https://authority.internal${path}`, {
    ...init,
    headers: { ...OPS, ...(init.headers ?? {}) },
  });

const jsonPost = async (path: string, body: unknown): Promise<Response> =>
  ops(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// the ops surface seeds the same Cedar Works actors, links, admins, and
// sealed-config shape, under its own display name and sealed marker
const orgBootstrap = (organizationId: string) =>
  organizationBootstrap(organizationId, { displayName: "Ops Works", sealedIdpConfig: "sealed:ops-test" });

const opBootstrap = (operationId: string, organizationId: string) => ({
  operationId,
  slug: "ops-op",
  displayName: "Ops Operation",
  policy: {
    format: 1,
    id: "policy-ops",
    version: "1",
    actions: ["observe", "review", "configure"],
    roles: [
      { title: "field", actions: ["observe"] },
      { title: "admin", actions: ["observe", "review", "configure"] },
    ],
    readPolicy: { organizations: "granted-teams" },
  },
  configureActions: ["configure"],
  sites: [{ siteId: "site-ops", path: "ops", aliases: ["ops"] }],
  teams: [{ teamId: "team-ops", siteId: "site-ops", organizationId }],
  grants: [
    {
      grantId: "g-ops",
      organizationId,
      actorId: "actor-crew",
      role: "field",
      target: { kind: "team", teamId: "team-ops" },
      primary: true,
    },
  ],
});

describe("typed ops routes", () => {
  it("mints and revokes the first administrator activation through operator routes", async () => {
    const organizationId = "org-ops-first-admin";
    expect((await jsonPost("/ops/organization/bootstrap", {
      ...orgBootstrap(organizationId),
      principalLinks: [],
    })).status).toBe(200);

    const issued = await jsonPost("/ops/organization/activation-request", {
      organizationId,
      actorId: "actor-lead",
    });
    const issuedBody = await issued.json() as {
      ok: boolean;
      value?: { requestId: string; secret: string; expiresAt: number };
    };
    expect(issuedBody.ok).toBe(true);
    expect(issuedBody.value?.secret).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const revoked = await jsonPost("/ops/organization/revoke-activation", {
      organizationId,
      actorId: "actor-lead",
      idempotencyKey: "ops-revoke-first-admin",
    });
    expect((await revoked.json() as { ok: boolean }).ok).toBe(true);

    const exported = await (await ops(`/ops/export?coordinator=organization&id=${organizationId}`)).json() as {
      tables: Record<string, Record<string, unknown>[]>;
    };
    const request = exported.tables["activation_requests"]?.[0];
    expect(request?.["revoked_at"]).not.toBeNull();
    expect(JSON.stringify(request)).not.toContain(issuedBody.value?.secret);
  });

  it("requires the ops token", async () => {
    const denied = await SELF.fetch(`https://authority.internal/ops/schema-status?coordinator=operation&id=${OP}`);
    expect(denied.status).toBe(401);
  });

  it("bootstraps through typed routes and reports schema status", async () => {
    expect((await jsonPost("/ops/organization/bootstrap", orgBootstrap(ORG))).status).toBe(200);
    expect((await jsonPost("/ops/operation/bootstrap", opBootstrap(OP, ORG))).status).toBe(200);

    const orgStatus = await (await ops(`/ops/schema-status?coordinator=organization&id=${ORG}`)).json() as {
      ok: boolean;
      value: Record<string, unknown>;
    };
    expect(orgStatus.ok).toBe(true);
    expect(orgStatus.value["actors"]).toBe(2);

    const opStatus = await (await ops(`/ops/schema-status?coordinator=operation&id=${OP}`)).json() as {
      ok: boolean;
      value: Record<string, unknown>;
    };
    expect(opStatus.ok).toBe(true);
    expect(opStatus.value["grants"]).toBe(1);
  });

  it("[A2] exports canonical state and restores it into fresh coordinators", async () => {
    const operationExport = await ops(`/ops/export?coordinator=operation&id=${OP}`);
    expect(operationExport.status).toBe(200);
    const operationSnapshot = await operationExport.json() as {
      coordinator: string;
      schemaVersion: string;
      tables: Record<string, unknown[]>;
    };
    expect(operationSnapshot.coordinator).toBe("operation");
    expect(operationSnapshot.tables["operation"]).toHaveLength(1);
    expect(operationSnapshot.tables["grants"]).toHaveLength(1);

    const restored = await jsonPost("/ops/restore", {
      coordinator: "operation",
      id: RESTORED_OP,
      snapshot: operationSnapshot,
    });
    expect(restored.status).toBe(200);
    const restoredExport = await (await ops(`/ops/export?coordinator=operation&id=${RESTORED_OP}`)).json();
    expect(restoredExport).toEqual(operationSnapshot);

    const orgExport = await (await ops(`/ops/export?coordinator=organization&id=${ORG}`)).json() as {
      coordinator: string;
      schemaVersion: string;
      tables: Record<string, unknown[]>;
    };
    expect(orgExport.coordinator).toBe("organization");
    expect(orgExport.tables["actors"]).toHaveLength(2);
    const restoredOrg = await jsonPost("/ops/restore", {
      coordinator: "organization",
      id: RESTORED_ORG,
      snapshot: orgExport,
    });
    expect(restoredOrg.status).toBe(200);
    const restoredOrgExport = await (await ops(`/ops/export?coordinator=organization&id=${RESTORED_ORG}`)).json();
    expect(restoredOrgExport).toEqual(orgExport);
  });

  it("restores a schema-1 organization export with an empty activation table", async () => {
    const sourceId = "org-ops-schema-one";
    expect((await jsonPost("/ops/organization/bootstrap", orgBootstrap(sourceId))).status).toBe(200);
    const current = await (await ops(`/ops/export?coordinator=organization&id=${sourceId}`)).json() as {
      coordinator: string;
      schemaVersion: string;
      tables: Record<string, unknown[]>;
    };
    const { activation_requests: _activationRequests, ...oldTables } = current.tables;
    const targetId = "org-ops-schema-one-restored";
    const restored = await jsonPost("/ops/restore", {
      coordinator: "organization",
      id: targetId,
      snapshot: { ...current, schemaVersion: "1", tables: oldTables },
    });
    expect(restored.status).toBe(200);
    expect((await restored.json() as { ok: boolean }).ok).toBe(true);
    const after = await (await ops(`/ops/export?coordinator=organization&id=${targetId}`)).json() as {
      schemaVersion: string;
      tables: Record<string, unknown[]>;
    };
    expect(after.schemaVersion).toBe("2");
    expect(after.tables["actors"]).toHaveLength(2);
    expect(after.tables["activation_requests"]).toEqual([]);
  });

  it("restores a schema-3 export and backfills routing facts", async () => {
    const operationExport = await ops(`/ops/export?coordinator=operation&id=${OP}`);
    const snapshot = await operationExport.json() as {
      coordinator: string;
      schemaVersion: string;
      tables: Record<string, Record<string, unknown>[]>;
    };
    const older = {
      ...snapshot,
      schemaVersion: "3",
      tables: {
        ...snapshot.tables,
        operation: snapshot.tables["operation"]?.map(({ slug: _slug, ...row }) => row) ?? [],
        sites: snapshot.tables["sites"]?.map(({ path: _path, ...row }) => row) ?? [],
      },
    };
    const restoredId = `${RESTORED_OP}-routing`;
    const restored = await jsonPost("/ops/restore", { coordinator: "operation", id: restoredId, snapshot: older });
    expect(restored.status).toBe(200);
    expect((await restored.json() as { ok: boolean }).ok).toBe(true);

    const status = await (await ops(`/ops/schema-status?coordinator=operation&id=${restoredId}`)).json() as {
      value?: Record<string, unknown>;
    };
    expect(status.value?.["operationSlug"]).toBeNull();
    expect(status.value?.["sitesWithPath"]).toBe(0);
    expect(status.value?.["routingFactsComplete"]).toBe(false);

    const facts = await jsonPost("/ops/operation/routing-facts", {
      operationId: restoredId,
      slug: "ops-restored",
      sites: [{ siteId: "site-ops", path: "ops-restored" }],
    });
    expect(facts.status).toBe(200);
    expect((await facts.json() as { ok: boolean }).ok).toBe(true);

    const backfilled = await (await ops(`/ops/export?coordinator=operation&id=${restoredId}`)).json() as {
      tables: Record<string, Record<string, unknown>[]>;
    };
    expect(backfilled.tables["operation"]?.[0]?.["slug"]).toBe("ops-restored");
    expect(backfilled.tables["sites"]?.[0]?.["path"]).toBe("ops-restored");
    const complete = await (await ops(`/ops/schema-status?coordinator=operation&id=${restoredId}`)).json() as {
      value?: Record<string, unknown>;
    };
    expect(complete.value?.["routingFactsComplete"]).toBe(true);
  });

  it("[A10] lists and binds principal links, refusing a conflicting actor", async () => {
    const organizationId = "org-ops-links";
    expect((await jsonPost("/ops/organization/bootstrap", orgBootstrap(organizationId))).status).toBe(200);

    const listed = await (await ops(`/ops/organization/principal-links?organizationId=${organizationId}`)).json() as {
      value?: { links: { provider: string; subject: string; actorId: string }[] };
    };
    expect(listed.value?.links).toHaveLength(2);

    const bind = await jsonPost("/ops/organization/principal-link", {
      organizationId,
      provider: "idp",
      subject: "new-subject",
      actorId: "actor-crew",
    });
    expect(bind.status).toBe(200);
    expect((await bind.json() as { value?: { applied: boolean } }).value?.applied).toBe(true);

    const again = await jsonPost("/ops/organization/principal-link", {
      organizationId,
      provider: "idp",
      subject: "new-subject",
      actorId: "actor-crew",
    });
    expect(again.status).toBe(200);
    expect((await again.json() as { value?: { applied: boolean } }).value?.applied).toBe(false);

    const after = await (await ops(`/ops/organization/principal-links?organizationId=${organizationId}`)).json() as {
      value?: { links: { subject: string; actorId: string }[] };
    };
    expect(after.value?.links).toHaveLength(3);
    expect(after.value?.links.some((link) => link.subject === "new-subject" && link.actorId === "actor-crew")).toBe(true);

    const conflict = await jsonPost("/ops/organization/principal-link", {
      organizationId,
      provider: "idp",
      subject: "new-subject",
      actorId: "actor-lead",
    });
    expect(conflict.status).toBe(400);
    expect((await conflict.json() as { failure?: { kind: string } }).failure?.kind).toBe("invalid-command");

    const unknown = await jsonPost("/ops/organization/principal-link", {
      organizationId,
      provider: "idp",
      subject: "ghost-subject",
      actorId: "actor-nobody",
    });
    expect(unknown.status).toBe(400);
    expect((await unknown.json() as { failure?: { kind: string } }).failure?.kind).toBe("invalid-command");
  });

  it("refuses a bind when the directory already resolves the subject elsewhere", async () => {
    const target = "org-ops-links-target";
    const other = "org-ops-links-other";
    expect((await jsonPost("/ops/organization/bootstrap", {
      ...orgBootstrap(target),
      principalLinks: [],
    })).status).toBe(200);
    expect((await jsonPost("/ops/organization/bootstrap", orgBootstrap(other))).status).toBe(200);

    const result = await bindPrincipalLink(
      { ...env, AUTHORITY_ORGANIZATION_IDS: `${target},${other}` } as Env,
      { organizationId: target, provider: "idp", subject: "lead", actorId: "actor-crew" },
    );
    expect(result.status).toBe(400);
    expect((result.body as { failure?: { kind: string } }).failure?.kind).toBe("invalid-command");
  });

  it("exposes the verification keys without the ops token", async () => {
    const response = await SELF.fetch("https://authority.internal/ops/verification-keys");
    expect(response.status).toBe(200);
    const body = await response.json() as { signingKeyId: string; keySet: string };
    const set = parseVerifyKeySet(body.keySet);
    // nothing is configured here, so the set is exactly the current signer —
    // not "at least contains" it
    expect(set.keys).toHaveLength(1);
    expect(set.keys[0]?.keyId).toBe(body.signingKeyId);
    expect(set.keys[0]?.algorithm).toBe("Ed25519");
    await expect(ed25519VerifyKey(body.signingKeyId, set.keys[0]!.publicKey)).resolves.toBeTruthy();
  });
});
