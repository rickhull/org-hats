import { SELF } from "cloudflare:test";
import { ed25519VerifyKey, parseVerifyKeySet } from "org-hats/access";
import { describe, expect, it } from "vitest";
import { organizationBootstrap } from "./helpers";

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
  sites: [{ siteId: "site-ops", aliases: ["ops"] }],
  teams: [{ teamId: "team-ops", siteId: "site-ops", organizationId }],
  grants: [
    {
      grantId: "g-ops",
      organizationId,
      actorId: "actor-member",
      role: "field",
      teamId: "team-ops",
      primary: true,
    },
  ],
});

describe("typed ops routes", () => {
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

  it("exports canonical state and restores it into fresh coordinators", async () => {
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
