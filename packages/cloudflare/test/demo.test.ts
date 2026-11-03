import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker, { demoRoutesEnabled } from "../src/index";
import type { Env } from "../src/env";

// The demo and harness routes refuse to serve unless `DEMO_ROUTES` is
// "1"; the test config sets it, the reference production config does not,
// so a routed deployment — and any service-binding caller — gets 404s
// without ever knowing the flag exists.
describe("the demo gate", () => {
  it("serves only when DEMO_ROUTES is exactly 1", () => {
    expect(demoRoutesEnabled({ DEMO_ROUTES: "1" } as never)).toBe(true);
    for (const unset of [undefined, "", "0", "true", "yes"] as const) {
      expect(demoRoutesEnabled({ DEMO_ROUTES: unset } as never)).toBe(false);
    }
    expect(demoRoutesEnabled({} as never)).toBe(false);
  });

  it("closes every demo and harness route through the real dispatcher", async () => {
    // The predicate test above cannot see the dispatcher, and `SELF` carries
    // `wrangler.jsonc`, which always sets the flag — so the 404 a routed
    // deployment would actually serve had no witness. Overriding the env on
    // the worker's own fetch is what reaches it.
    // An absent var and an empty one are different deployment states: the
    // reference production config omits the key entirely, so `undefined`
    // here means omitted rather than explicitly empty.
    const withFlag = (value: string | undefined): Env => {
      const next = { ...env } as Record<string, unknown>;
      if (value === undefined) delete next["DEMO_ROUTES"];
      else next["DEMO_ROUTES"] = value;
      return next as unknown as Env;
    };
    const routes = ["/", "/demo/bootstrap", "/demo/login", "/demo/access", "/increment"] as const;
    for (const value of [undefined, "", "0", "true", "yes"] as const) {
      for (const path of routes) {
        const response = await worker.fetch(new Request(`https://demo.internal${path}`), withFlag(value));
        expect(response.status, `${path} with DEMO_ROUTES=${String(value)}`).toBe(404);
      }
    }
  });
});

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
      amr: string[] | null;
      authTime: number | null;
      readableOrganizationIds: string[];
      checks: { action: string; target: { kind: string }; allowed: boolean }[];
    };
    expect(access.ok).toBe(true);
    expect(access.actor.organizationId).toBe("org-4c1f9a2e");
    expect(access.amr).toEqual(["pwd"]);
    expect(access.authTime).not.toBeNull();
    expect(access.readableOrganizationIds).toEqual(["org-4c1f9a2e"]);
    expect(access.checks.map((check) => check.allowed)).toEqual([true, false, false, false]);
  }, 30_000);
});
