import { WorkerEntrypoint } from "cloudflare:workers";
import {
  canonicalJson,
  type AccessFromEvidenceInput,
  type AccessIssue,
  type AuthorityCommand,
  type AuthorityContext,
  type AuthorityRuntime,
  type CommandResult,
  type ContextRequest,
  type RefreshInput,
  type JsonValue,
} from "org-hats/authority";
import type { Env } from "./env";
import {
  createCloudflareRuntime,
  createEphemeralSigner,
  serializedVerificationKeys,
  signerFromEnv,
  verificationKeys,
  type CloudflareSigner,
} from "./runtime";
import { verify, type Failed, type VerifyKey } from "org-hats/access";
import { CONFORMANCE_PRINCIPALS, type ConformanceWorld } from "org-hats/conformance";
import { createCloudflareConformanceWorld } from "./conformance";

export { Counter } from "./counter";
export { OrganizationAuthority } from "./organization";
export { OperationAuthority } from "./operation";

let ephemeralPromise: Promise<CloudflareSigner> | undefined;
const signerFor = async (env: Env): Promise<CloudflareSigner> => {
  if (env.AUTHORITY_SIGNING_KEY !== undefined) return signerFromEnv(env);
  ephemeralPromise ??= createEphemeralSigner();
  return ephemeralPromise;
};

const keysFor = async (env: Env, signer: CloudflareSigner): Promise<ReadonlyMap<string, VerifyKey>> =>
  verificationKeys(env, signer);

const runtime = async (env: Env): Promise<AuthorityRuntime> => {
  const organizationIds = (env.AUTHORITY_ORGANIZATION_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  const signer = await signerFor(env);
  return createCloudflareRuntime({
    env,
    signer,
    keys: await keysFor(env, signer),
    organizationIds,
  });
};

const opsAuthorized = (request: Request, env: Env): boolean => {
  const token = env.OPS_TOKEN;
  if (token === undefined || token.length === 0) return false;
  return request.headers.get("authorization") === `Bearer ${token}`;
};

const DEMO_OPERATION = "op-9f2e6ad4";
const DEMO_ORG = "org-4c1f9a2e";
const DEMO_WEST = "site-b8d620fa";
const DEMO_HARBOR_TEAM = "team-2e8c64b9";
const DEMO_OTHER_TEAM = "team-c7d9e2a1";

let demoWorldPromise: Promise<ConformanceWorld> | undefined;
const demoWorld = (env: Env): Promise<ConformanceWorld> => {
  demoWorldPromise ??= createCloudflareConformanceWorld(env);
  return demoWorldPromise;
};

const demoPage = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>org-hats demo</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 52rem; margin: 3rem auto; padding: 0 1rem; color: #17202a; }
  h1 { font-weight: 600; } code, pre { background: #f4f6f8; } pre { padding: 1rem; overflow: auto; }
  button { font: inherit; padding: .45rem .8rem; margin: 0 .5rem .5rem 0; }
  .note { color: #566573; }
</style></head>
<body>
<h1>org-hats demo</h1>
<p class="note">Dev evidence only. No identity provider, no external service. The envelope is
signed by the authority runtime and verified by <code>org-hats/access</code>.</p>
<button onclick="bootstrap()">Bootstrap twin</button>
<button onclick="login()">Sign in as Dana Okafor</button>
<button onclick="check()">Check access</button>
<pre id="out">Ready.</pre>
<script>
let envelope;
const show = (value) => { document.getElementById("out").textContent = JSON.stringify(value, null, 2); };
const api = async (path, body) => {
  const response = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return response.json();
};
async function bootstrap() { show(await api("/demo/bootstrap")); }
async function login() { const result = await api("/demo/login", {}); envelope = result.envelope; show(result); }
async function check() { show(await api("/demo/access", { envelope })); }
</script>
</body></html>`;


/** The service-binding surface. A consumer holding this binding holds the
 * same four methods the in-memory engine implements. */
export class AuthorityRuntimeEntrypoint extends WorkerEntrypoint<Env> implements AuthorityRuntime {
  accessFromEvidence(input: AccessFromEvidenceInput): Promise<AccessIssue | Failed> {
    return runtime(this.env).then((value) => value.accessFromEvidence(input));
  }
  refresh(input: RefreshInput): Promise<AccessIssue | Failed> {
    return runtime(this.env).then((value) => value.refresh(input));
  }
  context(input: ContextRequest): Promise<AuthorityContext | Failed> {
    return runtime(this.env).then((value) => value.context(input));
  }
  command(input: AuthorityCommand): Promise<CommandResult> {
    return runtime(this.env).then((value) => value.command(input));
  }
}

const coordinator = (env: Env, name: string | null, id: string): DurableObjectStub | undefined => {
  if (name === "organization") return env.ORGANIZATION.get(env.ORGANIZATION.idFromName(id));
  if (name === "operation") return env.OPERATION.get(env.OPERATION.idFromName(id));
  return undefined;
};

const relay = async (stub: DurableObjectStub, path: string, body?: unknown): Promise<Response> => {
  const response = await stub.fetch(`https://authority.internal${path}`, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
};

/** A minimal fetch surface for the harness and the typed ops routes. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ops/verification-keys") {
      const signer = await signerFor(env);
      return Response.json({
        signingKeyId: signer.keyId,
        keySet: await serializedVerificationKeys(env, signer),
      });
    }

    if (url.pathname.startsWith("/ops/")) {
      if (!opsAuthorized(request, env)) {
        return Response.json({ ok: false, failure: { kind: "unauthenticated" } }, { status: 401 });
      }
      try {
        if (request.method === "POST" && url.pathname === "/ops/organization/bootstrap") {
          const body = await request.json() as { organizationId?: string };
          if (typeof body.organizationId !== "string") throw new Error("organizationId is required");
          return relay(env.ORGANIZATION.get(env.ORGANIZATION.idFromName(body.organizationId)), "/bootstrap", body);
        }
        if (request.method === "POST" && url.pathname === "/ops/operation/bootstrap") {
          const body = await request.json() as { operationId?: string };
          if (typeof body.operationId !== "string") throw new Error("operationId is required");
          return relay(env.OPERATION.get(env.OPERATION.idFromName(body.operationId)), "/bootstrap", body);
        }
        if (request.method === "GET" && url.pathname === "/ops/schema-status") {
          const stub = coordinator(env, url.searchParams.get("coordinator"), url.searchParams.get("id") ?? "");
          if (stub === undefined) throw new Error("coordinator must be organization or operation, with an id");
          return relay(stub, "/status");
        }
        if (request.method === "GET" && url.pathname === "/ops/export") {
          const stub = coordinator(env, url.searchParams.get("coordinator"), url.searchParams.get("id") ?? "");
          if (stub === undefined) throw new Error("coordinator must be organization or operation, with an id");
          const response = await relay(stub, "/export");
          const body = await response.json() as { ok: boolean; value?: unknown; failure?: unknown };
          if (!body.ok) return Response.json(body, { status: response.status });
          return new Response(canonicalJson(body.value as JsonValue), {
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        }
        if (request.method === "POST" && url.pathname === "/ops/restore") {
          const body = await request.json() as { coordinator?: string; id?: string; snapshot?: unknown };
          const stub = coordinator(env, body.coordinator ?? null, body.id ?? "");
          if (stub === undefined) throw new Error("coordinator must be organization or operation, with an id");
          return relay(stub, "/restore", body.snapshot);
        }
        return Response.json({ ok: false, failure: { kind: "wrong-binding", detail: "unknown ops route" } }, { status: 404 });
      } catch (error) {
        return Response.json(
          { ok: false, failure: { kind: "invalid-command", detail: error instanceof Error ? error.message : "invalid ops request" } },
          { status: 400 },
        );
      }
    }

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(demoPage, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (request.method === "GET" && url.pathname === "/demo/bootstrap") {
      await demoWorld(env);
      return Response.json({
        ok: true,
        operationId: DEMO_OPERATION,
        organizationId: DEMO_ORG,
        actorId: CONFORMANCE_PRINCIPALS.dana.actorId,
      });
    }

    if (request.method === "POST" && url.pathname === "/demo/login") {
      const world = await demoWorld(env);
      // fixed dev evidence: Dana authenticated with a password just now
      const issued = await world.runtime.accessFromEvidence({
        interfaceVersion: 1,
        operationId: DEMO_OPERATION,
        evidence: {
          ...CONFORMANCE_PRINCIPALS.dana.evidence,
          amr: ["pwd"],
          authTime: Math.floor(Date.now() / 1000),
        },
      });
      if ("failure" in issued) return Response.json({ ok: false, failure: issued.failure }, { status: 401 });
      return Response.json({ ok: true, envelope: issued.envelope, refresh: issued.refresh });
    }

    if (request.method === "POST" && url.pathname === "/demo/access") {
      const body = await request.json() as { envelope?: unknown };
      if (body.envelope === undefined) return Response.json({ ok: false, failure: { kind: "invalid-command" } }, { status: 400 });
      const world = await demoWorld(env);
      const result = await verify(body.envelope as never, world.keys, {
        now: Math.floor(Date.now() / 1000),
        expectedOperationId: DEMO_OPERATION,
        expectedSiteId: DEMO_WEST,
      });
      if ("failure" in result) return Response.json({ ok: false, failure: result.failure }, { status: 401 });
      const access = result.access;
      return Response.json({
        ok: true,
        actor: result.claims.actor,
        operationId: access.operationId,
        sites: access.sites,
        selectedHat: result.claims.hat,
        amr: result.claims.amr ?? null,
        authTime: result.claims.auth_time ?? null,
        readableOrganizationIds: access.readableOrganizationIds(),
        readableTeamIds: access.readableTeamIds(),
        mayConfigureWest: access.mayConfigure(DEMO_WEST),
        expiresAt: access.expiresAt(),
        checks: [
          { action: "review", target: { kind: "team", teamId: DEMO_HARBOR_TEAM }, allowed: access.mayAct("review", { kind: "team", teamId: DEMO_HARBOR_TEAM }) },
          { action: "configure", target: { kind: "team", teamId: DEMO_HARBOR_TEAM }, allowed: access.mayAct("configure", { kind: "team", teamId: DEMO_HARBOR_TEAM }) },
          { action: "review", target: { kind: "team", teamId: DEMO_OTHER_TEAM }, allowed: access.mayAct("review", { kind: "team", teamId: DEMO_OTHER_TEAM }) },
          { action: "review", target: { kind: "operation" }, allowed: access.mayAct("review", { kind: "operation" }) },
        ],
      });
    }

    if (url.pathname !== "/increment") {
      return new Response("not found\n", { status: 404 });
    }
    const id = env.COUNTER.idFromName("harness");
    const stub = env.COUNTER.get(id) as DurableObjectStub & {
      increment(): Promise<number>;
    };
    return Response.json({ count: await stub.increment() });
  },
};
