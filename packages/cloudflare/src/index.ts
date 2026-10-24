import { WorkerEntrypoint } from "cloudflare:workers";
import type {
  AccessFromEvidenceInput,
  AccessIssue,
  AuthorityCommand,
  AuthorityContext,
  AuthorityRuntime,
  CommandResult,
  ContextRequest,
  RefreshInput,
} from "org-hats/authority";
import type { Env } from "./env";
import {
  createCloudflareRuntime,
  createEphemeralSigner,
  verificationKeyOf,
  type CloudflareSigner,
} from "./runtime";
import type { Failed, VerifyKey } from "org-hats/access";

export { Counter } from "./counter";
export { OrganizationAuthority } from "./organization";
export { OperationAuthority } from "./operation";

let signerPromise: Promise<CloudflareSigner> | undefined;
const signer = (): Promise<CloudflareSigner> => {
  signerPromise ??= createEphemeralSigner();
  return signerPromise;
};

let keysPromise: Promise<ReadonlyMap<string, VerifyKey>> | undefined;
const keys = async (): Promise<ReadonlyMap<string, VerifyKey>> => {
  keysPromise ??= verificationKeyOf(await signer()).then((key) => new Map([[key.keyId, key]]));
  return keysPromise;
};

const runtime = async (env: Env): Promise<AuthorityRuntime> => {
  const organizationIds = (env.AUTHORITY_ORGANIZATION_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return createCloudflareRuntime({
    env,
    signer: await signer(),
    keys: await keys(),
    organizationIds,
  });
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

/** A minimal fetch surface for the harness and the ops routes. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ops/verification-keys") {
      const key = await verificationKeyOf(await signer());
      return Response.json({ keys: [{ keyId: key.keyId, publicKey: await (await signer()).publicKey() }] });
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
