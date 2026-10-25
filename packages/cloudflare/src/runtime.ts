import {
  ACCESS_ENVELOPE_FORMAT,
  ACCESS_ENVELOPE_VERSION,
  AUTHORITY_INTERFACE_VERSION,
  canonicalJson,
  isFailed,
  type AccessEnvelopeClaimsV1,
  type AccessFromEvidenceInput,
  type AccessIssue,
  type AuthorityCommand,
  type AuthorityContext,
  type AuthorityRuntime,
  type CommandResult,
  type ContextRequest,
  type HatSummary,
  type Failure,
  type RefreshInput,
  type SignedAccessEnvelope,
} from "org-hats/authority";
import {
  base64Decode,
  base64Encode,
  base64UrlEncode,
  ed25519VerifyKey,
  parseVerifyKeySet,
  serializeVerifyKeySet,
  utf8,
  verify,
  verifyKeysOf,
  type Failed,
  type VerifyKey,
  type VerifyKeySet,
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

/** A signer from deployment configuration, or the ephemeral dev signer.
 *
 * The three signing variables travel as a set: none means the development
 * fallback, a partial set is a configuration error — a deployment that
 * meant to configure signing must not serve silently ephemeral — and a
 * full set is proven a pair at import: the private half signs a fixed
 * probe the public half must verify, so a mismatch is an error here, not
 * an outage discovered when envelopes stop verifying. */
export const signerFromEnv = async (env: Env): Promise<CloudflareSigner> => {
  const key = env.AUTHORITY_SIGNING_KEY;
  const publicKeyRaw = env.AUTHORITY_SIGNING_PUBLIC_KEY;
  const keyId = env.AUTHORITY_SIGNING_KEY_ID;
  if (key === undefined || publicKeyRaw === undefined || keyId === undefined) {
    const present = [
      ...(key === undefined ? [] : ["AUTHORITY_SIGNING_KEY"]),
      ...(publicKeyRaw === undefined ? [] : ["AUTHORITY_SIGNING_PUBLIC_KEY"]),
      ...(keyId === undefined ? [] : ["AUTHORITY_SIGNING_KEY_ID"]),
    ];
    throw new Error(
      `partial signing-key configuration: ${present.join(", ")} set; configure all three or none`,
    );
  }
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    base64Decode(key),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const publicKey = (await crypto.subtle.importKey(
    "raw",
    base64Decode(publicKeyRaw),
    { name: "Ed25519" },
    false,
    ["verify"],
  )) as CryptoKey;
  const probe = "org-hats signing-key pair probe";
  const probeSignature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, utf8(probe));
  if (!(await crypto.subtle.verify({ name: "Ed25519" }, publicKey, probeSignature, utf8(probe)))) {
    throw new Error("AUTHORITY_SIGNING_KEY and AUTHORITY_SIGNING_PUBLIC_KEY are not a key pair");
  }
  return {
    keyId,
    sign: async (payload) =>
      base64UrlEncode(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, utf8(payload)))),
    publicKey: async () => publicKeyRaw,
  };
};

/** Whether any signing variable is set — the set is all-or-none, so one
 * is enough to demand the rest. */
const hasSigningConfig = (env: Env): boolean =>
  env.AUTHORITY_SIGNING_KEY !== undefined ||
  env.AUTHORITY_SIGNING_PUBLIC_KEY !== undefined ||
  env.AUTHORITY_SIGNING_KEY_ID !== undefined;

let ephemeralSigner: Promise<CloudflareSigner> | undefined;

/** The runtime's signer: a configured, proven pair, or the per-isolate
 * development key when nothing is configured. */
export const signerFor = async (env: Env): Promise<CloudflareSigner> => {
  if (hasSigningConfig(env)) return signerFromEnv(env);
  ephemeralSigner ??= createEphemeralSigner();
  return ephemeralSigner;
};

/** The configured set plus the current signer, as one canonical set. */
export const verificationKeySet = async (
  env: Env,
  signer: CloudflareSigner,
): Promise<VerifyKeySet> => {
  const configured = (env.AUTHORITY_VERIFICATION_KEYS ?? "").trim();
  const set = configured.length === 0
    ? { format: "org-hats.verify-keys" as const, v: 1 as const, keys: [] }
    : parseVerifyKeySet(configured);
  const signing = {
    keyId: signer.keyId,
    algorithm: "Ed25519",
    publicKey: await signer.publicKey(),
  };
  return {
    format: set.format,
    v: set.v,
    keys: [...set.keys.filter((key) => key.keyId !== signer.keyId), signing],
  };
};

/** The verifier map: configured rotation keys plus the current signer. */
export const verificationKeys = async (
  env: Env,
  signer: CloudflareSigner,
): Promise<ReadonlyMap<string, VerifyKey>> => {
  const set = await verificationKeySet(env, signer);
  return verifyKeysOf(set);
};

export const serializedVerificationKeys = async (env: Env, signer: CloudflareSigner): Promise<string> =>
  serializeVerifyKeySet((await verificationKeySet(env, signer)).keys);

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
import {
  exchangeCodeForEvidence,
  parseSealedProviderConfig,
  type EvidenceFromProviderCodeInput,
  type EvidenceFromProviderCodeResult,
  type SealedProviderConfig,
} from "./exchange";

/** The provider-callback exchange as the Worker serves it: resolve the
 * sealed provider configuration from the organization directory — there is
 * no global registry — then exchange the code for verified evidence. The
 * portable seam is untouched; this is runtime surface. */
export const evidenceFromProviderCode = async (
  env: Env,
  input: EvidenceFromProviderCodeInput,
): Promise<EvidenceFromProviderCodeResult | { readonly ok: false; readonly failure: Failure }> => {
  const organizationIds = (env.AUTHORITY_ORGANIZATION_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  for (const organizationId of organizationIds) {
    const stub = env.ORGANIZATION.get(env.ORGANIZATION.idFromName(organizationId));
    let result: {
      readonly ok: boolean;
      readonly value?: { readonly present: boolean; readonly config?: string };
    };
    try {
      const response = await stub.fetch("https://authority.internal/idp-config");
      result = (await response.json()) as typeof result;
    } catch (error) {
      // A directory member that cannot answer could be the one holding the
      // sealed configuration; do not claim no match.
      return {
        ok: false,
        failure: {
          kind: "unavailable",
          detail: error instanceof Error ? error.message : "the organization directory is unavailable",
        },
      };
    }
    if (!result.ok || result.value?.present !== true) continue;
    let config: SealedProviderConfig | undefined;
    try {
      config = parseSealedProviderConfig(result.value.config ?? "");
    } catch {
      continue; // a configuration this runtime cannot read is not a match
    }
    if (config.issuer !== input.issuer || config.clientId !== input.clientId) continue;
    return exchangeCodeForEvidence(input, config);
  }
  return {
    ok: false,
    failure: { kind: "unauthenticated", detail: "no sealed provider configuration for this issuer" },
  };
};

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
    try {
      const response = await stub.fetch(`https://authority.internal${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      return (await response.json()) as Envelope<T>;
    } catch (error) {
      // A coordinator that cannot answer is `unavailable`, not an exception
      // through the service binding. The portable seam returns failures.
      return {
        ok: false,
        failure: {
          kind: "unavailable",
          detail: error instanceof Error ? error.message : "the coordinator is unavailable",
        },
      };
    }
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
    // The directory is not a registry: each organization holds its own
    // links, so the only global view is to ask every candidate. One
    // identity linked to two actors is a configuration fault, not a race
    // to win — return it as `unavailable` rather than silently resolving
    // whichever organization happened to be first.
    const matches: { actorId: string; organizationId: string; disabled: boolean }[] = [];
    for (const organizationId of candidates) {
      const result = await call<{ actorId: string; disabled: boolean }>(
        organization(organizationId),
        "GET",
        `/resolve?provider=${encodeURIComponent(evidence.provider)}&subject=${encodeURIComponent(evidence.subject)}`,
      );
      if (result.ok && result.value !== undefined) {
        matches.push({ actorId: result.value.actorId, organizationId, disabled: result.value.disabled });
        continue;
      }
      if (result.failure?.kind !== "unauthenticated") return failed(result.failure ?? { kind: "unavailable" });
    }
    if (matches.length > 1) {
      return failed({
        kind: "unavailable",
        detail: "the principal link is ambiguous across organizations",
      });
    }
    const match = matches[0];
    if (match === undefined) {
      return failed({ kind: "unauthenticated", detail: "no principal link for this evidence" });
    }
    return match;
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
      if (isFailed(result)) return failed(result.failure);
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
    if (isFailed(resolved)) return resolved;
    // The live organization read is the disable gate; the projection is not
    // the revocation promise. This matches the in-memory engine, which
    // refuses a disabled actor's fresh evidence before any handler runs.
    if (resolved.disabled) return failed({ kind: "not-admitted", detail: "actor disabled" });
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
    if (isFailed(resolved)) return resolved;
    if (resolved.disabled) return failed({ kind: "not-admitted", detail: "actor disabled" });
    const issued = await call<{
      claims: AccessEnvelopeClaimsV1;
      refresh: AccessIssue["refresh"];
    }>(operation(input.operationId), "POST", "/issue", {
      organizationId: resolved.organizationId,
      actorId: resolved.actorId,
      ...(input.evidence.amr === undefined ? {} : { amr: [...input.evidence.amr] }),
      ...(input.evidence.authTime === undefined ? {} : { authTime: input.evidence.authTime }),
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
    if (isFailed(verified)) return failed(verified.failure);
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
      wearableHats: readonly HatSummary[];
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
              target: selected.target,
              primary: selected.primary,
            },
          }),
      sites: claims.sites,
      ...(claims.amr === undefined ? {} : { amr: [...claims.amr] }),
      ...(claims.auth_time === undefined ? {} : { authTime: claims.auth_time }),
    };
  };

  const command = async (input: AuthorityCommand): Promise<CommandResult> => {
    if (input.interfaceVersion !== AUTHORITY_INTERFACE_VERSION) {
      return { ok: false, failure: { kind: "wrong-interface-version" } };
    }
    const operationId = "operationId" in input ? input.operationId : undefined;
    const key = input.idempotencyKey;
    const route = async (stub: DurableObjectStub, path: string, body: Record<string, unknown>): Promise<CommandResult> => {
      const result = await call<{ applied: boolean }>(stub, "POST", path, { ...body, idempotencyKey: key });
      if (!result.ok || result.value === undefined) return { ok: false, failure: result.failure ?? { kind: "unavailable" } };
      return { ok: true, receipt: { idempotencyKey: key, applied: result.value.applied } };
    };
    const deny = (failure: Failure): CommandResult => ({ ok: false, failure });

    // request-access asks as the evidence in the request; the shell
    // authorization is not the request. The in-memory engine reads the same
    // field and takes this path before resolving an administrator, so an
    // unrelated (or stale) authorization cannot make the request as
    // somebody else. No administrator is involved.
    if (input.kind === "request-access") {
      const resolved = await resolve(input.evidence);
      if (isFailed(resolved)) return deny(resolved.failure);
      await drain(input.operationId, resolved.organizationId);
      const result = await route(operation(input.operationId), "/request-access", {
        organizationId: resolved.organizationId,
        actorId: resolved.actorId,
        ...(input.note === undefined ? {} : { note: input.note }),
      });
      await drain(input.operationId, resolved.organizationId);
      return result;
    }

    const authorized = await authorize(input);
    if (isFailed(authorized)) return deny(authorized.failure);
    await drain(operationId, authorized.organizationId);

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
          target: input.target,
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
      default: {
        // The exhaustiveness witness: this arm is `never` when every command
        // kind has a case, so adding one fails the build here instead of
        // silently routing to invalid-command. The failure — not a throw —
        // stays: the service binding can deliver a structurally different
        // command from a caller whose types disagree, and that caller gets
        // the closed taxonomy, never an exception.
        input satisfies never;
        return deny({ kind: "invalid-command", detail: "unknown command kind" });
      }
    }
    await drain(operationId, authorized.organizationId);
    return result;
  };

  return { accessFromEvidence, refresh, context, command };
};

