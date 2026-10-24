import {
  ACCESS_ENVELOPE_FORMAT,
  ACCESS_ENVELOPE_VERSION,
  AUTHORITY_INTERFACE_VERSION,
  canonicalJson,
  type AccessEnvelopeClaimsV1,
  type AccessFromEvidenceInput,
  type AccessIssue,
  type AuthorityCommand,
  type AuthorityContext,
  type AuthorityRuntime,
  type CommandResult,
  type ContextRequest,
  type Failure,
  type RefreshInput,
  type SignedAccessEnvelope,
} from "org-hats/authority";
import {
  base64Decode,
  base64Encode,
  base64UrlEncode,
  ed25519VerifyKey,
  utf8,
  verify,
  type Failed,
  type VerifyKey,
} from "org-hats/access";
import type { Env } from "./env";

/** The signing half the portable engine keeps internal. The Cloudflare
 * runtime signs at the Worker boundary; the operation coordinator never sees
 * the private key. */
export interface CloudflareSigner {
  readonly keyId: string;
  sign(payload: string): Promise<string>;
  publicKey(): Promise<string>;
}

export const createEphemeralSigner = async (keyId = `key-${crypto.randomUUID()}`): Promise<CloudflareSigner> => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    keyId,
    sign: async (payload) =>
      base64UrlEncode(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, utf8(payload)))),
    publicKey: async () =>
      base64Encode(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer)),
  };
};

export const verificationKeyOf = async (signer: CloudflareSigner): Promise<VerifyKey> =>
  ed25519VerifyKey(signer.keyId, await signer.publicKey());

/** A signer from deployment configuration, or the ephemeral dev signer. */
export const signerFromEnv = async (env: Env): Promise<CloudflareSigner> => {
  if (
    env.AUTHORITY_SIGNING_KEY === undefined ||
    env.AUTHORITY_SIGNING_PUBLIC_KEY === undefined ||
    env.AUTHORITY_SIGNING_KEY_ID === undefined
  ) {
    return createEphemeralSigner();
  }
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    base64Decode(env.AUTHORITY_SIGNING_KEY),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const publicKey = (await crypto.subtle.importKey(
    "raw",
    base64Decode(env.AUTHORITY_SIGNING_PUBLIC_KEY),
    { name: "Ed25519" },
    false,
    ["verify"],
  )) as CryptoKey;
  const publicKeyBase64 = env.AUTHORITY_SIGNING_PUBLIC_KEY;
  const keyId = env.AUTHORITY_SIGNING_KEY_ID;
  return {
    keyId,
    sign: async (payload) =>
      base64UrlEncode(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, utf8(payload)))),
    publicKey: async () => publicKeyBase64,
  };
};

/** The verifier map: configured rotation keys plus the current signer. */
export const verificationKeys = async (
  env: Env,
  signer: CloudflareSigner,
): Promise<ReadonlyMap<string, VerifyKey>> => {
  const keys = new Map<string, VerifyKey>();
  for (const entry of (env.AUTHORITY_VERIFICATION_KEYS ?? "").split(",")) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    const split = trimmed.indexOf(":");
    if (split <= 0 || split === trimmed.length - 1) {
      throw new Error("AUTHORITY_VERIFICATION_KEYS entries must be keyId:base64");
    }
    const keyId = trimmed.slice(0, split);
    keys.set(keyId, await ed25519VerifyKey(keyId, trimmed.slice(split + 1)));
  }
  const signing = await verificationKeyOf(signer);
  keys.set(signing.keyId, signing);
  return keys;
};

const now = (): number => Math.floor(Date.now() / 1000);

interface Envelope<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly failure?: Failure;
}

const failed = (failure: Failure): Failed => ({ failure });

interface Authorized {
  readonly organizationId: string;
  readonly actorId: string;
  readonly adminOfOperation: boolean;
  readonly adminOfOrganization: boolean;
  readonly claims?: AccessEnvelopeClaimsV1;
}

export interface CloudflareRuntimeOptions {
  readonly env: Env;
  readonly signer: CloudflareSigner;
  readonly keys: ReadonlyMap<string, VerifyKey>;
  /** The organization directory the runtime may consult for evidence
   * resolution. The conformance world supplies its fixtures; an operator
   * supplies the operations' known organizations. */
  readonly organizationIds: readonly string[];
}

/** The portable `AuthorityRuntime` over the two coordinators. */
export const createCloudflareRuntime = (options: CloudflareRuntimeOptions): AuthorityRuntime => {
  const { env, signer, keys, organizationIds } = options;
  const organization = (organizationId: string): DurableObjectStub =>
    env.ORGANIZATION.get(env.ORGANIZATION.idFromName(organizationId));
  const operation = (operationId: string): DurableObjectStub =>
    env.OPERATION.get(env.OPERATION.idFromName(operationId));

  const call = async <T>(
    stub: DurableObjectStub,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<Envelope<T>> => {
    const response = await stub.fetch(`https://authority.internal${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    return (await response.json()) as Envelope<T>;
  };

  const drain = async (operationId?: string, organizationId?: string): Promise<void> => {
    const jobs: Promise<unknown>[] = [];
    if (operationId !== undefined) jobs.push(call(operation(operationId), "POST", "/drain"));
    if (organizationId !== undefined) jobs.push(call(organization(organizationId), "POST", "/drain"));
    await Promise.allSettled(jobs);
  };

  const resolve = async (
    evidence: { readonly provider: string; readonly subject: string },
    preferredOrganizationId?: string,
  ): Promise<{ readonly actorId: string; readonly organizationId: string; readonly disabled: boolean } | Failed> => {
    const candidates = [...new Set([
      ...(preferredOrganizationId === undefined ? [] : [preferredOrganizationId]),
      ...organizationIds,
    ])];
    for (const organizationId of candidates) {
      const result = await call<{ actorId: string; disabled: boolean }>(
        organization(organizationId),
        "GET",
        `/resolve?provider=${encodeURIComponent(evidence.provider)}&subject=${encodeURIComponent(evidence.subject)}`,
      );
      if (result.ok && result.value !== undefined) {
        return { actorId: result.value.actorId, organizationId, disabled: result.value.disabled };
      }
      if (result.failure?.kind !== "unauthenticated") return failed(result.failure ?? { kind: "unavailable" });
    }
    return failed({ kind: "unauthenticated", detail: "no principal link for this evidence" });
  };

  const adminOfOrganization = async (organizationId: string, actorId: string): Promise<boolean> => {
    const result = await call<{ admin: boolean }>(
      organization(organizationId),
      "GET",
      `/admin?actorId=${encodeURIComponent(actorId)}`,
    );
    return result.ok === true && result.value?.admin === true;
  };

  const adminOfOperation = async (
    operationId: string,
    claims: AccessEnvelopeClaimsV1 | undefined,
  ): Promise<boolean> => {
    if (claims === undefined) return false;
    const config = await call<{
      adminRoles: readonly string[];
      configureActions: readonly string[];
    }>(operation(operationId), "GET", "/config");
    if (!config.ok || config.value === undefined) return false;
    return claims.hat.actions.some((action) => config.value?.configureActions.includes(action)) ||
      config.value.adminRoles.includes(claims.hat.role);
  };

  const authorize = async (command: AuthorityCommand): Promise<Authorized | Failed> => {
    const operationId = "operationId" in command ? command.operationId : undefined;
    if (command.authorization.kind === "access-envelope") {
      const result = await verify(
        command.authorization.envelope,
        keys,
        {
          now: now(),
          ...(operationId === undefined ? {} : { expectedOperationId: operationId }),
        },
      );
      if ("failure" in result) return failed(result.failure);
      const claims = result.claims;
      return {
        organizationId: claims.actor.organizationId,
        actorId: claims.actor.actorId,
        adminOfOperation: await adminOfOperation(claims.operationId, claims),
        adminOfOrganization: await adminOfOrganization(claims.actor.organizationId, claims.actor.actorId),
        claims,
      };
    }
    const preferred = command.kind === "disable-actor" ? command.organizationId : undefined;
    const resolved = await resolve(command.authorization.evidence, preferred);
    if ("failure" in resolved) return resolved;
    return {
      organizationId: resolved.organizationId,
      actorId: resolved.actorId,
      adminOfOperation: false,
      adminOfOrganization: await adminOfOrganization(resolved.organizationId, resolved.actorId),
    };
  };

  const sign = async (claims: AccessEnvelopeClaimsV1): Promise<SignedAccessEnvelope> => ({
    format: ACCESS_ENVELOPE_FORMAT,
    v: ACCESS_ENVELOPE_VERSION,
    keyId: signer.keyId,
    claims,
    signature: await signer.sign(canonicalJson(claims as never)),
  });

  const accessFromEvidence = async (input: AccessFromEvidenceInput): Promise<AccessIssue | Failed> => {
    if (input.interfaceVersion !== AUTHORITY_INTERFACE_VERSION) {
      return failed({ kind: "wrong-interface-version" });
    }
    await drain(input.operationId);
    const resolved = await resolve(input.evidence);
    if ("failure" in resolved) return resolved;
    if (resolved.disabled) return failed({ kind: "not-admitted", detail: "actor disabled" });
    const issued = await call<{
      claims: AccessEnvelopeClaimsV1;
      refresh: AccessIssue["refresh"];
    }>(operation(input.operationId), "POST", "/issue", {
      organizationId: resolved.organizationId,
      actorId: resolved.actorId,
    });
    if (!issued.ok || issued.value === undefined) return failed(issued.failure ?? { kind: "unavailable" });
    return { envelope: await sign(issued.value.claims), refresh: issued.value.refresh };
  };

  const refresh = async (input: RefreshInput): Promise<AccessIssue | Failed> => {
    if (input.interfaceVersion !== AUTHORITY_INTERFACE_VERSION) {
      return failed({ kind: "wrong-interface-version" });
    }
    await drain(input.operationId);
    const issued = await call<{
      claims: AccessEnvelopeClaimsV1;
      refresh: AccessIssue["refresh"];
    }>(operation(input.operationId), "POST", "/refresh", { handle: input.handle });
    if (!issued.ok || issued.value === undefined) return failed(issued.failure ?? { kind: "unavailable" });
    return { envelope: await sign(issued.value.claims), refresh: issued.value.refresh };
  };

  const context = async (input: ContextRequest): Promise<AuthorityContext | Failed> => {
    if (input.interfaceVersion !== AUTHORITY_INTERFACE_VERSION) return failed({ kind: "wrong-interface-version" });
    const verified = await verify(input.envelope, keys, { now: now() });
    if ("failure" in verified) return failed(verified.failure);
    const claims = verified.claims;
    const actor = await call<{ actorId: string; displayName?: string; disabled: boolean }>(
      organization(claims.actor.organizationId),
      "GET",
      `/actor?actorId=${encodeURIComponent(claims.actor.actorId)}`,
    );
    const org = await call<{ organizationId: string; displayName: string | null }>(
      organization(claims.actor.organizationId),
      "GET",
      "/organization",
    );
    const op = await call<{
      operationId: string;
      operationDisplayName?: string;
      participation: "invited" | "accepted" | "active" | "revoked";
      wearableHats: readonly {
        role: string;
        actions: readonly string[];
        teamId?: string;
        siteId?: string;
        primary: boolean;
      }[];
    }>(operation(claims.operationId), "POST", "/context", {
      organizationId: claims.actor.organizationId,
      actorId: claims.actor.actorId,
      role: claims.hat.role,
    });
    if (!op.ok || op.value === undefined) return failed(op.failure ?? { kind: "unavailable" });
    const selected = op.value.wearableHats.find((hat) => hat.role === claims.hat.role);
    return {
      actor: {
        organizationId: claims.actor.organizationId,
        actorId: claims.actor.actorId,
        ...(actor.value?.displayName === undefined ? {} : { displayName: actor.value.displayName }),
      },
      ...(org.value?.displayName === null || org.value?.displayName === undefined
        ? {}
        : { organizationDisplayName: org.value.displayName }),
      operationId: claims.operationId,
      ...(op.value.operationDisplayName === undefined ? {} : { operationDisplayName: op.value.operationDisplayName }),
      participation: op.value.participation,
      wearableHats: op.value.wearableHats,
      ...(selected === undefined
        ? {}
        : {
            selectedHat: {
              role: claims.hat.role,
              actions: [...claims.hat.actions],
              ...(selected.teamId === undefined ? {} : { teamId: selected.teamId }),
              ...(selected.siteId === undefined ? {} : { siteId: selected.siteId }),
              primary: selected.primary,
            },
          }),
      sites: claims.sites,
    };
  };

  const command = async (input: AuthorityCommand): Promise<CommandResult> => {
    if (input.interfaceVersion !== AUTHORITY_INTERFACE_VERSION) {
      return { ok: false, failure: { kind: "wrong-interface-version" } };
    }
    const authorized = await authorize(input);
    if ("failure" in authorized) return { ok: false, failure: authorized.failure };
    const operationId = "operationId" in input ? input.operationId : undefined;
    await drain(operationId, authorized.organizationId);
    const key = input.idempotencyKey;
    const route = async (stub: DurableObjectStub, path: string, body: Record<string, unknown>): Promise<CommandResult> => {
      const result = await call<{ applied: boolean }>(stub, "POST", path, { ...body, idempotencyKey: key });
      if (!result.ok || result.value === undefined) return { ok: false, failure: result.failure ?? { kind: "unavailable" } };
      return { ok: true, receipt: { idempotencyKey: key, applied: result.value.applied } };
    };
    const deny = (failure: Failure): CommandResult => ({ ok: false, failure });

    let result: CommandResult;
    switch (input.kind) {
      case "participation-invite":
        if (!authorized.adminOfOperation) return deny({ kind: "denied", detail: "the caller does not administer this operation" });
        result = await route(operation(input.operationId), "/invite", {
          organizationId: input.organizationId,
          byActorId: authorized.actorId,
        });
        break;
      case "participation-accept":
        if (!authorized.adminOfOrganization) return deny({ kind: "denied", detail: "the caller does not administer this organization" });
        result = await route(organization(authorized.organizationId), "/accept", {
          operationId: input.operationId,
          actorId: authorized.actorId,
        });
        break;
      case "participation-revoke":
        if (input.by === "operation") {
          if (!authorized.adminOfOperation) return deny({ kind: "denied", detail: "the caller does not administer this operation" });
          result = await route(operation(input.operationId), "/revoke-participation", {
            organizationId: input.organizationId,
            byActorId: authorized.actorId,
          });
        } else {
          if (!authorized.adminOfOrganization) return deny({ kind: "denied", detail: "the caller does not administer this organization" });
          result = await route(organization(input.organizationId), "/revoke", {
            operationId: input.operationId,
            actorId: authorized.actorId,
          });
        }
        break;
      case "request-access":
        result = await route(operation(input.operationId), "/request-access", {
          organizationId: authorized.organizationId,
          actorId: authorized.actorId,
          ...(input.note === undefined ? {} : { note: input.note }),
        });
        break;
      case "admit":
        if (!authorized.adminOfOperation) return deny({ kind: "denied", detail: "the caller does not administer this operation" });
        result = await route(operation(input.operationId), "/admit", {
          organizationId: input.organizationId,
          actorId: input.actorId,
          byActorId: authorized.actorId,
        });
        break;
      case "grant-hat":
        if (!authorized.adminOfOperation) return deny({ kind: "denied", detail: "the caller does not administer this operation" });
        result = await route(operation(input.operationId), "/grant", {
          organizationId: input.organizationId,
          actorId: input.actorId,
          role: input.role,
          ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
          ...(input.siteId === undefined ? {} : { siteId: input.siteId }),
          ...(input.primary === true ? { primary: true } : {}),
          byActorId: authorized.actorId,
        });
        break;
      case "revoke-grant":
        if (!authorized.adminOfOperation) return deny({ kind: "denied", detail: "the caller does not administer this operation" });
        result = await route(operation(input.operationId), "/revoke-grant", {
          grantId: input.grantId,
          byActorId: authorized.actorId,
        });
        break;
      case "select-hat":
        result = await route(operation(input.operationId), "/select-hat", {
          grantId: input.grantId,
          actorId: authorized.actorId,
          byActorId: authorized.actorId,
        });
        break;
      case "disable-actor":
        if (!authorized.adminOfOrganization) return deny({ kind: "denied", detail: "the caller does not administer this organization" });
        result = await route(organization(input.organizationId), "/disable", {
          actorId: input.actorId,
          byActorId: authorized.actorId,
        });
        break;
      default:
        return deny({ kind: "invalid-command", detail: "unknown command kind" });
    }
    await drain(operationId, authorized.organizationId);
    return result;
  };

  return { accessFromEvidence, refresh, context, command };
};

