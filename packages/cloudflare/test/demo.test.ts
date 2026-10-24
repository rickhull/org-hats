import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("the self-contained demo", () => {
  it("serves the page, signs in with dev evidence, and verifies neutral access", async () => {
    const page = await SELF.fetch("https://demo.internal/");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("org-hats demo");

    const bootstrap = await (await SELF.fetch("https://demo.internal/demo/bootstrap")).json() as {
      ok: boolean;
      operationId: string;
    };
    expect(bootstrap.ok).toBe(true);
    expect(bootstrap.operationId).toBe("op-9f2e6ad4");

    const login = await (await SELF.fetch("https://demo.internal/demo/login", { method: "POST" })).json() as {
      ok: boolean;
      envelope: unknown;
    };
    expect(login.ok).toBe(true);
    expect(login.envelope).toBeDefined();

    const accessResponse = await SELF.fetch("https://demo.internal/demo/access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envelope: login.envelope }),
    });
    expect(accessResponse.status).toBe(200);
    const access = await accessResponse.json() as {
      ok: boolean;
      actor: { organizationId: string; actorId: string };
      readableOrganizationIds: string[];
      checks: { action: string; target: { kind: string }; allowed: boolean }[];
    };
    expect(access.ok).toBe(true);
    expect(access.actor.organizationId).toBe("org-4c1f9a2e");
    expect(access.readableOrganizationIds).toEqual(["org-4c1f9a2e"]);
    expect(access.checks.map((check) => check.allowed)).toEqual([true, false, false, false]);
  }, 30_000);
});
