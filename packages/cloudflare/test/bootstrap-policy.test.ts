import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call } from "./helpers";

const validPolicy = {
  format: 1,
  id: "policy",
  version: "1",
  actions: ["observe"],
  roles: [{ title: "field", actions: ["observe"] }],
  readPolicy: { organizations: "granted-teams" },
};

const malformedPolicies = [
  { field: "id", policy: { ...validPolicy, id: 123 } },
  { field: "version", policy: { ...validPolicy, version: 123 } },
  { field: "role title", policy: { ...validPolicy, roles: [{ title: 123, actions: ["observe"] }] } },
  { field: "actions", policy: { ...validPolicy, actions: [123], roles: [{ title: "field", actions: [123] }] } },
];

describe("operation bootstrap policy boundary", () => {
  it.each(malformedPolicies.flatMap(({ field, policy }) =>
    ["/bootstrap", "/bootstrap-preview"].map((path) => ({ field, policy, path })),
  ))("refuses numeric $field at $path without writing", async ({ field, policy, path }) => {
    const id = `op-policy-${field.replaceAll(" ", "-")}-${path.slice(1)}`;
    const stub = env.OPERATION.get(env.OPERATION.idFromName(id));
    const before = await call(stub, "GET", "/export");
    const result = await call(stub, "POST", path, {
      operationId: id,
      slug: "policy",
      policy,
      sites: [],
      teams: [],
    });
    expect(result.body.ok).toBe(false);
    expect(result.body.failure?.kind).toBe("invalid-command");
    expect(await call(stub, "GET", "/export")).toEqual(before);
    const snapshot = await call<{ operationId: string | null }>(stub, "GET", "/snapshot");
    expect(snapshot.body.value?.operationId).toBeNull();
  });
});
