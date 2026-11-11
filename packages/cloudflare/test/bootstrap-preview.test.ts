import { SELF, env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call, organizationBootstrap, type Envelope } from "./helpers";

const OPS = { authorization: "Bearer test-ops-token", "content-type": "application/json" };
type Row = Record<string, string | number | null>;
interface Change {
  readonly table: string;
  readonly key: Row;
  readonly before: Row | null;
  readonly after: Row;
}
interface Preview { readonly coordinator: "operation"; readonly changes: readonly Change[] }

const input = (operationId: string) => ({
  operationId, slug: "preview", longName: "Preview operation",
  policy: {
    format: 1, id: "preview", version: "1", actions: ["observe"],
    roles: [{ title: "field", actions: ["observe"] }],
    readPolicy: { organizations: "granted-teams" },
  },
  sites: [{ siteId: "site-preview", path: "yard", aliases: [] }],
  teams: [{ teamId: "team-preview", siteId: "site-preview", organizationId: "org-preview", displayName: "Original team" }],
  grants: [{ grantId: "grant-preview", organizationId: "org-preview", actorId: "actor-preview", role: "field", target: { kind: "team", teamId: "team-preview" }, primary: true }],
  participations: [],
});

const preview = (body: unknown, authorized = true) => SELF.fetch("https://authority.internal/ops/operation/bootstrap-preview", {
  method: "POST", headers: authorized ? OPS : { "content-type": "application/json" }, body: JSON.stringify(body),
});
const stub = (id: string) => env.OPERATION.get(env.OPERATION.idFromName(id));
const exported = async (id: string) => (await call<{ tables: Record<string, Row[]> }>(stub(id), "GET", "/export")).body;

describe("operation bootstrap preview", () => {
  it("previews a fresh operation without committing any state, then matches apply", async () => {
    const id = "op-preview-new";
    const org = env.ORGANIZATION.get(env.ORGANIZATION.idFromName("org-preview"));
    expect((await call(org, "POST", "/bootstrap", organizationBootstrap("org-preview"))).body.ok).toBe(true);
    const body = { ...input(id), participations: [{ organizationId: "org-preview", status: "active" }] };
    const before = await exported(id);
    const response = await preview(body);
    expect(response.status).toBe(200);
    const result = await response.json() as Envelope<Preview>;
    expect(result.ok).toBe(true);
    expect(result.value?.coordinator).toBe("operation");
    expect(result.value?.changes.map((change) => change.table)).toEqual(["operation", "sites", "teams", "participations", "grants"]);
    expect(result.value?.changes.every((change) => change.before === null)).toBe(true);
    expect(await exported(id)).toEqual(before);
    // No projected actors or SQLite sequence increments escape the rollback.
    await runInDurableObject(stub(id), async (_instance, state) => {
      expect(state.storage.sql.exec("SELECT * FROM org_actors").toArray()).toEqual([]);
      expect(state.storage.sql.exec("SELECT * FROM sqlite_sequence").toArray()).toEqual([]);
      expect(await state.storage.getAlarm()).toBeNull();
    });
    expect((await call(stub(id), "POST", "/bootstrap", body)).body.ok).toBe(true);
    await runInDurableObject(stub(id), async (_instance, state) => {
      expect(state.storage.sql.exec("SELECT * FROM org_actors").toArray().length).toBeGreaterThan(0);
    });
    const after = await exported(id);
    for (const change of result.value?.changes ?? []) {
      const row = after.value?.tables[change.table]?.find((candidate) =>
        Object.entries(change.key).every(([key, value]) => candidate[key] === value));
      expect(row).toMatchObject(change.after);
      expect(change.after).not.toHaveProperty("created_at");
      expect(change.after).not.toHaveProperty("updated_at");
    }
  });

  it("uses the actual conflict rules and leaves all exported state unchanged", async () => {
    const id = "op-preview-existing";
    const original = input(id);
    expect((await call(stub(id), "POST", "/bootstrap", original)).body.ok).toBe(true);
    const changed = {
      ...original, longName: "Updated operation",
      teams: original.teams.map((team) => ({ ...team, displayName: "Ignored rename" })),
      grants: original.grants.map((grant) => ({ ...grant, primary: false, revoked: true })),
      sites: original.sites.map((site) => ({ ...site, longName: "Updated site" })),
    };
    const before = await exported(id);
    const result = await (await preview(changed)).json() as Envelope<Preview>;
    expect(result.ok).toBe(true);
    expect(result.value?.changes.map((change) => change.table)).toEqual(["operation", "sites"]);
    expect(result.value?.changes[0]?.before?.["display_name"]).toBe("Preview operation");
    expect(result.value?.changes[0]?.after["display_name"]).toBe("Updated operation");
    expect(await exported(id)).toEqual(before);
    expect((await call(stub(id), "POST", "/bootstrap", changed)).body.ok).toBe(true);
    const after = await exported(id);
    expect(after.value?.tables["teams"]).toEqual(before.value?.tables["teams"]);
    expect(after.value?.tables["grants"]).toEqual(before.value?.tables["grants"]);
    const unchanged = await (await preview(changed)).json() as Envelope<Preview>;
    expect(unchanged.value?.changes).toEqual([]);
  });

  it("refuses invalid and malformed input without writes", async () => {
    const id = "op-preview-invalid";
    const before = await exported(id);
    for (const body of [{ ...input(id), slug: "invalid.slug" }, { operationId: id }, null]) {
      const response = await preview(body);
      const result = await response.json() as Envelope<Preview>;
      expect(result.ok).toBe(false);
      expect(result.failure?.kind).toBe("invalid-command");
      expect(await exported(id)).toEqual(before);
    }
  });

  it("requires the existing ops token", async () => {
    expect((await preview(input("op-preview-gated"), false)).status).toBe(401);
  });
});
