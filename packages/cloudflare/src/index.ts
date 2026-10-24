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
  signerFromEnv,
  verificationKeys,
  type CloudflareSigner,
} from "./runtime";
import type { Failed, VerifyKey } from "org-hats/access";

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
      const keys = (env.AUTHORITY_VERIFICATION_KEYS ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map((entry) => {
          const split = entry.indexOf(":");
          return split <= 0
            ? undefined
            : { keyId: entry.slice(0, split), publicKey: entry.slice(split + 1) };
        })
        .filter((entry): entry is { keyId: string; publicKey: string } => entry !== undefined);
      if (!keys.some((key) => key.keyId === signer.keyId)) {
        keys.push({ keyId: signer.keyId, publicKey: await signer.publicKey() });
      }
      return Response.json({ signingKeyId: signer.keyId, keys });
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
