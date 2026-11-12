import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call, organizationBootstrap } from "./helpers";

const organization = (id: string) => env.ORGANIZATION.get(env.ORGANIZATION.idFromName(id));
const operation = (id: string) => env.OPERATION.get(env.OPERATION.idFromName(id));

const operationBootstrap = (id: string) => ({
  operationId: id,
  slug: "test",
  policy: { format: 1, id: "policy-test", version: "1", actions: ["observe"], roles: [{ title: "field", actions: ["observe"] }], readPolicy: { organizations: "granted-teams" } },
  sites: [{ siteId: "site-test", path: "site", aliases: [] }],
  teams: [{ teamId: "team-test", siteId: "site-test", organizationId: "org-test" }],
  grants: [{ grantId: "grant-test", organizationId: "org-test", actorId: "actor-test", role: "field", target: { kind: "team", teamId: "team-test" } }],
});

describe("bootstrap boolean flags", () => {
  it("refuses a string disabled flag before persisting organization state", async () => {
    const id = "org-flag-red";
    const stub = organization(id);
    const body = organizationBootstrap(id);
    const result = await call(stub, "POST", "/bootstrap", { ...body, actors: [{ ...body.actors[0], disabled: "true" }, body.actors[1]] });
    expect(result.body.failure?.kind).toBe("invalid-command");
    const status = await call<Record<string, unknown>>(stub, "GET", "/status");
    expect(status.body.value?.["organizationId"]).toBe(null);
  });

  it("refuses a string revoked flag before persisting operation state", async () => {
    const id = "op-flag-red";
    const stub = operation(id);
    const body = operationBootstrap(id);
    const result = await call(stub, "POST", "/bootstrap", { ...body, grants: [{ ...body.grants[0], revoked: "true" }] });
    expect(result.body.failure?.kind).toBe("invalid-command");
    const snapshot = await call<{ operationId: string | null }>(stub, "GET", "/snapshot");
    expect(snapshot.body.value?.operationId).toBe(null);
  });

  it("refuses each non-boolean flag on bootstrap and preview without changing exports", async () => {
    const invalid = [null, "false", 0, {}, []];
    for (const [index, value] of invalid.entries()) {
      const orgId = `org-flag-invalid-${index}`;
      const org = organization(orgId);
      const orgBody = organizationBootstrap(orgId);
      const orgBefore = await call(org, "GET", "/export");
      const orgResult = await call(org, "POST", "/bootstrap", {
        ...orgBody, actors: [{ ...orgBody.actors[0], disabled: value }, orgBody.actors[1]],
      });
      expect(orgResult.body.failure?.kind).toBe("invalid-command");
      expect(await call(org, "GET", "/export")).toEqual(orgBefore);

      for (const field of ["bounded", "primary", "revoked"] as const) {
        const id = `op-flag-invalid-${index}-${field}`;
        const stub = operation(id);
        const body = operationBootstrap(id);
        const payload = field === "bounded"
          ? { ...body, bounded: value }
          : { ...body, grants: [{ ...body.grants[0], [field]: value }] };
        const before = await call(stub, "GET", "/export");
        for (const path of ["/bootstrap", "/bootstrap-preview"]) {
          expect((await call(stub, "POST", path, payload)).body.failure?.kind).toBe("invalid-command");
          expect(await call(stub, "GET", "/export")).toEqual(before);
        }
      }
    }
  });

  it("preserves absent, false and true flag values in persisted state", async () => {
    for (const [label, flag] of [["absent", undefined], ["false", false], ["true", true]] as const) {
      const orgId = `org-flag-valid-${label}`;
      const org = organization(orgId);
      const orgBody = organizationBootstrap(orgId);
      const disabled = flag === undefined ? {} : { disabled: flag };
      expect((await call(org, "POST", "/bootstrap", {
        ...orgBody, actors: [{ ...orgBody.actors[0], ...disabled }, orgBody.actors[1]],
      })).body.ok).toBe(true);
      const resolved = await call<{ disabled: boolean }>(org, "GET", "/resolve?provider=idp&subject=lead");
      expect(resolved.body.value?.disabled).toBe(flag === true);

      const id = `op-flag-valid-${label}`;
      const stub = operation(id);
      const body = operationBootstrap(id);
      const flags = flag === undefined ? {} : { bounded: flag };
      const grantFlags = flag === undefined ? {} : { primary: flag, revoked: flag };
      expect((await call(stub, "POST", "/bootstrap", {
        ...body, ...flags, grants: [{ ...body.grants[0], ...grantFlags }],
      })).body.ok).toBe(true);
      const exported = await call<{ tables: Record<string, Record<string, unknown>[]> }>(stub, "GET", "/export");
      expect(exported.body.value?.tables["operation"]?.[0]?.["bounded"]).toBe(flag === true ? 1 : 0);
      expect(exported.body.value?.tables["grants"]?.[0]).toMatchObject({
        is_primary: flag === true ? 1 : 0, revoked: flag === true ? 1 : 0,
      });
    }
  });
});
