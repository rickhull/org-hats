import { SELF, env } from "cloudflare:test";
import { ed25519VerifyKey, parseVerifyKeySet } from "org-hats/access";
import { describe, expect, it } from "vitest";
import { organizationBootstrap, restoreAuditOf, withoutRestoreAudit, type Envelope } from "./helpers";
import worker, { bindPrincipalLink } from "../src/index";
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
  organizationBootstrap(organizationId, { longName: "Ops Works", sealedIdpConfig: "sealed:ops-test" });

const opBootstrap = (operationId: string, organizationId: string) => ({
  operationId,
  slug: "ops-op",
  longName: "Ops Operation",
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

describe("the ops token gate when the deployment sets no token", () => {
  // `wrangler.jsonc` always sets OPS_TOKEN, so a deployment that forgot it —
  // a configuration mistake rather than an attacker, against the
  // highest-authority surface in the system — had no witness. Overriding the
  // env on the worker's own fetch is what reaches it. What this pins is the
  // externally visible claim: no token, no ops route, whatever the caller
  // sends.
  const gated = "/ops/export?coordinator=organization&id=org-ops";

  // An absent binding and an empty string are different deployment states, so
  // the absent case omits the key rather than setting it to `undefined` —
  // which `exactOptionalPropertyTypes` would reject, and which would not model
  // a missing var anyway.
  const withToken = (token: string | undefined): Env => {
    const next = { ...env } as Record<string, unknown>;
    if (token === undefined) delete next["OPS_TOKEN"];
    else next["OPS_TOKEN"] = token;
    return next as unknown as Env;
  };

  // The empty-token branch is unreachable defence in depth rather than a
  // hole it closes, and the reason is worth writing down: with an empty
  // token the expected value is `"Bearer "`, seven characters, and header
  // values are trimmed on the way in — `new Request(url, { headers: {
  // authorization: "Bearer " } })` arrives as `"Bearer"`, six. No caller can
  // express the string that would match, so the length check already refuses
  // it. Keep the branch; do not claim a test can witness its absence.
  it("refuses an absent or empty token for every header a caller can send", async () => {
    const cases: readonly (readonly [string, string | undefined, string | undefined])[] = [
      ["absent binding, no header", undefined, undefined],
      ["absent binding, bare scheme", undefined, "Bearer"],
      ["absent binding, the real token", undefined, "Bearer test-ops-token"],
      ["absent binding, arbitrary value", undefined, "Bearer anything"],
      ["empty token, no header", "", undefined],
      ["empty token, bare scheme", "", "Bearer"],
      ["empty token, the real token", "", "Bearer test-ops-token"],
    ];
    for (const [label, token, authorization] of cases) {
      const response = await worker.fetch(
        new Request(`https://authority.internal${gated}`, {
          ...(authorization === undefined ? {} : { headers: { authorization } }),
        }),
        withToken(token),
      );
      expect(response.status, label).toBe(401);
      expect((await response.json() as Envelope<unknown>).failure?.kind, label).toBe("unauthenticated");
    }
  });

  it("still serves the public verification keys, which are secret-free by design", async () => {
    // The public route sits before the gate, so losing the token must not
    // take key distribution down with it.
    const response = await worker.fetch(
      new Request("https://authority.internal/ops/verification-keys"),
      withToken(undefined),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { signingKeyId?: string; keySet?: string };
    expect(body.signingKeyId).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("test-ops-token");
  });
});

describe("the ops surface is a closed allowlist over the coordinators", () => {
  // The coordinators carry internal paths the ops surface deliberately does
  // not expose — `/idp-config` above all, which resolves the sealed provider
  // secret. Today that is true by construction: `index.ts` has no route for
  // it, and an unmatched `/ops/` path is a 404. "No such route today" is
  // exactly the property a future route addition breaks silently, so it is
  // worth a test rather than a reading.
  // Coordinator paths with no ops route. `/principal-links`, `/bootstrap`,
  // `/activation-request`, `/routing-facts`, `/audit`, and the status/export
  // pair are deliberately exposed and are not listed here.
  const internalOnly = [
    "/idp-config",
    "/resolve",
    "/activation-inspect",
    "/activation-preflight",
    "/activation-accept",
    "/intake",
    "/drain",
    "/accept",
    "/revoke",
    "/disable",
    "/invite",
    "/create-actor",
    "/appoint-administrator",
  ] as const;

  it("does not relay an internal coordinator path, even with a valid token", async () => {
    expect((await jsonPost("/ops/organization/bootstrap", {
      ...orgBootstrap("org-ops-allowlist"),
      principalLinks: [],
    })).status).toBe(200);

    for (const path of internalOnly) {
      for (const prefix of ["/ops", "/ops/organization", "/ops/operation"] as const) {
        const got = await ops(`${prefix}${path}?coordinator=organization&id=org-ops-allowlist`);
        expect(got.status, `GET ${prefix}${path}`).toBe(404);
        const posted = await jsonPost(`${prefix}${path}`, { organizationId: "org-ops-allowlist" });
        expect(posted.status, `POST ${prefix}${path}`).toBe(404);
        expect(await posted.text(), `POST ${prefix}${path}`).not.toContain("sealed:");
      }
    }
  });

  it("an absent or wrong coordinator id reaches no other tenant's state", async () => {
    // `coordinator()` takes `id ?? ""`, so a missing id names a real but
    // uninitialized Durable Object rather than failing. That is bounded —
    // the route is behind the ops token, and the ops token already permits
    // export of any id — but the claim worth pinning is isolation by name: a
    // typo must never return another coordinator's rows.
    const organizationId = "org-ops-isolation";
    expect((await jsonPost("/ops/organization/bootstrap", {
      ...orgBootstrap(organizationId),
      principalLinks: [],
    })).status).toBe(200);
    const real = await (await ops(`/ops/export?coordinator=organization&id=${organizationId}`)).json() as {
      tables: Record<string, unknown[]>;
    };
    expect(real.tables["actors"]?.length).toBeGreaterThan(0);

    for (const query of [
      "coordinator=organization",
      "coordinator=organization&id=",
      "coordinator=organization&id=org-ops-isolation-typo",
    ] as const) {
      const response = await ops(`/ops/export?${query}`);
      expect(response.status, query).toBe(200);
      const body = await response.json() as { tables?: Record<string, unknown[]> };
      expect(body.tables?.["actors"] ?? [], query).toEqual([]);
      expect(body.tables?.["organization"] ?? [], query).toEqual([]);
      expect(JSON.stringify(body), query).not.toContain("sealed:ops-test");
      expect(JSON.stringify(body), query).not.toContain("actor-lead");
    }

    // an unrecognized coordinator name still fails closed
    expect((await ops("/ops/export?coordinator=elsewhere&id=whatever")).status).toBe(400);
  });

  it("refuses a bootstrap whose envelope lifetime is not a whole number", async () => {
    // `Number(...)` coerced this field, so the JSON literal 1e999 became
    // Infinity and bootstrap accepted it. The runtime then survived only
    // because SQLite refuses to bind a non-finite number and JSON cannot
    // carry Infinity, which laundered the value into immediate expiry — two
    // serialization accidents rather than a control. The boundary now refuses
    // it, and `assembleAccessClaims` refuses it for every other runtime.
    const organizationId = "org-ops-lifetime";
    expect((await jsonPost("/ops/organization/bootstrap", {
      ...orgBootstrap(organizationId),
      principalLinks: [],
    })).status).toBe(200);

    for (const bad of [1e999, "900", null, 900.5, -900, 0] as const) {
      const response = await jsonPost("/ops/operation/bootstrap", {
        ...opBootstrap(`op-ops-lifetime-${String(bad)}`, organizationId),
        envelopeLifetimeSeconds: bad,
      });
      expect(response.status, `lifetime ${String(bad)}`).toBe(400);
      expect((await response.json() as Envelope<unknown>).failure?.kind, `lifetime ${String(bad)}`)
        .toBe("invalid-command");
    }

    // the field remains optional, and a sane value is still accepted
    expect((await jsonPost("/ops/operation/bootstrap", {
      ...opBootstrap("op-ops-lifetime-ok", organizationId),
      envelopeLifetimeSeconds: 600,
    })).status).toBe(200);
    expect((await jsonPost("/ops/operation/bootstrap", opBootstrap("op-ops-lifetime-absent", organizationId))).status)
      .toBe(200);
  });

  it("records the operator identity a caller claims, and refuses a malformed one", async () => {
    // The ops token is all-or-nothing, so this is attribution and not proof:
    // anyone holding the token can claim any identity. What it buys is a trail
    // that names a person instead of the bare literal `operator`.
    const organizationId = "org-ops-attribution";
    const as = (operator: string) => ({ "x-ops-operator": operator });

    expect((await ops("/ops/organization/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json", ...as("nia@cedar.example") },
      body: JSON.stringify({ ...orgBootstrap(organizationId), principalLinks: [] }),
    })).status).toBe(200);

    expect((await ops("/ops/organization/activation-request", {
      method: "POST",
      headers: { "content-type": "application/json", ...as("nia@cedar.example") },
      body: JSON.stringify({ organizationId, actorId: "actor-lead" }),
    })).status).toBe(200);

    const trail = await (await ops(`/ops/audit?coordinator=organization&id=${organizationId}`)).json() as
      Envelope<readonly { actor: string; fact: string }[]>;
    const issued = (trail.value ?? []).find((row) => row.fact.includes("activation for actor actor-lead issued"));
    expect(issued?.actor).toBe("nia@cedar.example");

    // absent header keeps the previous behaviour exactly
    expect((await jsonPost("/ops/organization/activation-request", {
      organizationId,
      actorId: "actor-crew",
    })).status).toBe(200);
    const after = await (await ops(`/ops/audit?coordinator=organization&id=${organizationId}`)).json() as
      Envelope<readonly { actor: string; fact: string }[]>;
    expect((after.value ?? []).find((row) => row.fact.includes("actor-crew issued"))?.actor).toBe("operator");

    // The value lands verbatim in a row people read, so it is bounded and
    // charset-checked, and a bad value is refused rather than silently
    // dropped. A newline is not in this list because it cannot be: the fetch
    // API refuses to construct the header at all, so log injection by that
    // route is unexpressible rather than merely validated.
    for (const bad of ["a".repeat(65), "has space", "semi;colon", "quote\"d", "comma,separated"]) {
      const refused = await ops(`/ops/audit?coordinator=organization&id=${organizationId}`, {
        headers: as(bad),
      });
      expect(refused.status, JSON.stringify(bad)).toBe(400);
      expect((await refused.json() as Envelope<unknown>).failure?.kind, JSON.stringify(bad)).toBe("invalid-command");
    }
  });

  it("records who restored a coordinator, in a row the snapshot cannot overwrite", async () => {
    // Restore replaces every table, the audit table included, so a row
    // written before the tables would be erased by the act it records. This
    // is the only trace that the most destructive privileged action happened.
    const sourceId = "org-ops-restore-trace";
    expect((await jsonPost("/ops/organization/bootstrap", {
      ...orgBootstrap(sourceId),
      principalLinks: [],
    })).status).toBe(200);
    const snapshot = await (await ops(`/ops/export?coordinator=organization&id=${sourceId}`)).json() as {
      tables: Record<string, unknown[]>;
    };
    expect(restoreAuditOf(snapshot.tables)).toBeUndefined();

    const targetId = "org-ops-restore-trace-target";
    expect((await ops("/ops/restore", {
      method: "POST",
      headers: { "content-type": "application/json", ...{ "x-ops-operator": "sam:oncall" } },
      body: JSON.stringify({ coordinator: "organization", id: targetId, snapshot }),
    })).status).toBe(200);

    const trail = await (await ops(`/ops/audit?coordinator=organization&id=${targetId}`)).json() as
      Envelope<readonly { actor: string; fact: string }[]>;
    const row = (trail.value ?? []).at(-1);
    expect(row?.fact).toContain("state restored from a snapshot");
    expect(row?.actor).toBe("sam:oncall");
  });

  it("produces the audit trail without the sealed configuration beside it", async () => {
    // An operator under assessment has to hand over audit rows. Before this
    // route the only path was `/ops/export`, which carries the provider
    // client secret in the same response.
    const organizationId = "org-ops-audit";
    expect((await jsonPost("/ops/organization/bootstrap", {
      ...orgBootstrap(organizationId),
      principalLinks: [],
    })).status).toBe(200);

    const response = await ops(`/ops/audit?coordinator=organization&id=${organizationId}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("sealed:ops-test");
    const body = JSON.parse(text) as Envelope<readonly { seq: number; at: number; actor: string; fact: string }[]>;
    expect(body.ok).toBe(true);
    const rows = body.value ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["actor", "at", "fact", "seq"]);
    expect(rows.some((row) => row.fact.includes("bootstrapped"))).toBe(true);

    // and it is gated like every other ops route
    const denied = await SELF.fetch(`https://authority.internal/ops/audit?coordinator=organization&id=${organizationId}`);
    expect(denied.status).toBe(401);
  });

  it("never returns the sealed provider configuration from a relayed ops route", async () => {
    // Export is the one ops route that legitimately carries the sealed value,
    // which the threat model records as residual. Every other relayed route
    // must not, so a leak through a new route is visible here.
    const organizationId = "org-ops-sealed";
    expect((await jsonPost("/ops/organization/bootstrap", {
      ...orgBootstrap(organizationId),
      principalLinks: [],
    })).status).toBe(200);

    const status = await ops(`/ops/schema-status?coordinator=organization&id=${organizationId}`);
    expect(await status.text()).not.toContain("sealed:ops-test");

    const links = await ops(`/ops/organization/principal-links?organizationId=${organizationId}`);
    expect(await links.text()).not.toContain("sealed:ops-test");

    // and the documented exception, stated rather than assumed
    const exported = await ops(`/ops/export?coordinator=organization&id=${organizationId}`);
    expect(await exported.text()).toContain("sealed:ops-test");
  });
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
    // The compare is timing-safe; a wrong length and a wrong value at the
    // right length both fail closed.
    const wrongLength = await SELF.fetch(
      `https://authority.internal/ops/schema-status?coordinator=operation&id=${OP}`,
      { headers: { authorization: "Bearer nope" } },
    );
    expect(wrongLength.status).toBe(401);
    const wrongValue = await SELF.fetch(
      `https://authority.internal/ops/schema-status?coordinator=operation&id=${OP}`,
      { headers: { authorization: `Bearer ${"x".repeat("test-ops-token".length)}` } },
    );
    expect(wrongValue.status).toBe(401);
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
    const restoredExport = await (await ops(`/ops/export?coordinator=operation&id=${RESTORED_OP}`)).json() as {
      tables: Record<string, unknown[]>;
    };
    // Faithful in every fact the snapshot carried, plus the one row the
    // snapshot could not carry: the record that it was restored.
    expect(withoutRestoreAudit(restoredExport)).toEqual(operationSnapshot);
    expect(restoreAuditOf(restoredExport.tables)?.actor).toBe("operator");

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
    const restoredOrgExport = await (await ops(`/ops/export?coordinator=organization&id=${RESTORED_ORG}`)).json() as {
      tables: Record<string, unknown[]>;
    };
    expect(withoutRestoreAudit(restoredOrgExport)).toEqual(orgExport);
    expect(restoreAuditOf(restoredOrgExport.tables)?.actor).toBe("operator");
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
    expect(after.schemaVersion).toBe("6");
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
