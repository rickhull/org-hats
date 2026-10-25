// The Cloudflare runtime's cross-coordinator decisions: one identity must
// resolve to exactly one actor, a disabled actor cannot command, and
// request-access asks as the evidence in the request — the same rules the
// in-memory reference engine enforces.

import { env } from "cloudflare:test";
import { AUTHORITY_INTERFACE_VERSION, isFailed } from "org-hats/authority";
import {
  CONFORMANCE_PRINCIPALS,
  CONFORMANCE_WORLD,
} from "org-hats/conformance";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { createCloudflareConformanceWorld } from "../src/conformance";
import {
  createCloudflareRuntime,
  createEphemeralSigner,
  evidenceFromProviderCode,
  verificationKeyOf,
} from "../src/runtime";

const MERIDIAN = "op-9f2e6ad4";

const organization = (organizationId: string): DurableObjectStub =>
  env.ORGANIZATION.get(env.ORGANIZATION.idFromName(organizationId));
const operation = (operationId: string): DurableObjectStub =>
  env.OPERATION.get(env.OPERATION.idFromName(operationId));

const post = async (
  stub: DurableObjectStub,
  path: string,
  body: unknown,
): Promise<{ ok: boolean; value?: unknown; failure?: { kind: string; detail?: string } }> => {
  const response = await stub.fetch(`https://authority.internal${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as { ok: boolean; value?: unknown; failure?: { kind: string; detail?: string } };
};

const failingCoordinatorEnv = (): Env => ({
  ...env,
  AUTHORITY_ORGANIZATION_IDS: "org-unreachable",
  ORGANIZATION: {
    idFromName: (name: string) => name,
    get: () => ({ fetch: async () => { throw new Error("the coordinator is unavailable"); } }),
  },
  OPERATION: {
    idFromName: (name: string) => name,
    get: () => ({ fetch: async () => { throw new Error("the coordinator is unavailable"); } }),
  },
} as unknown as Env);

const conformanceOrganizationIds = (): readonly string[] => [...new Set(
  CONFORMANCE_WORLD.fixtures.flatMap((fixture) =>
    fixture.snapshot.organizations.map((record) => record.organizationId),
  ),
)];

describe("the Cloudflare runtime's cross-coordinator rules", () => {
  it("request-access asks as the evidence it carries, not the shell authorization", async () => {
    const world = await createCloudflareConformanceWorld(env);
    const invitee = CONFORMANCE_PRINCIPALS.inviteeAdmin;
    const result = await world.runtime.command({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      idempotencyKey: "runtime-request-own-evidence",
      kind: "request-access",
      operationId: MERIDIAN,
      evidence: invitee.evidence,
      note: "the request's own evidence",
      // The shell authorization names a different linked principal. The
      // request's own evidence is the request; the envelope only proves a
      // caller exists.
      authorization: {
        kind: "fresh-evidence",
        evidence: CONFORMANCE_PRINCIPALS.dana.evidence,
        operationId: MERIDIAN,
      },
    });
    expect(result.ok).toBe(true);

    const response = await operation(MERIDIAN).fetch("https://authority.internal/snapshot");
    const snapshot = (await response.json()) as {
      value: { accessRequests: { organization_id: string; actor_id: string; note?: string }[] };
    };
    const queued = snapshot.value.accessRequests.find((request) => request.note === "the request's own evidence");
    expect(queued).toBeDefined();
    expect(queued?.organization_id).toBe(invitee.organizationId);
    expect(queued?.actor_id).toBe(invitee.actorId);
  }, 30_000);

  it("refuses a disabled actor's fresh-evidence command while the projection is stale", async () => {
    const world = await createCloudflareConformanceWorld(env);
    const dana = CONFORMANCE_PRINCIPALS.dana;
    const sam = CONFORMANCE_PRINCIPALS.sam;
    const org = organization(dana.organizationId);
    const disabled = await post(org, "/disable", {
      actorId: dana.actorId,
      byActorId: dana.actorId,
      idempotencyKey: "runtime-disable-dana",
    });
    expect(disabled.ok).toBe(true);
    // the operation's projection has not received the roster yet: its own
    // actor row still says enabled. The live organization read is the gate.

    const result = await world.runtime.command({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      idempotencyKey: "runtime-disabled-command",
      kind: "disable-actor",
      organizationId: dana.organizationId,
      actorId: sam.actorId,
      authorization: { kind: "fresh-evidence", evidence: dana.evidence, operationId: MERIDIAN },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("not-admitted");

    const actor = await (await org.fetch(
      `https://authority.internal/actor?actorId=${encodeURIComponent(sam.actorId)}`,
    )).json() as { value?: { disabled: boolean } };
    expect(actor.value?.disabled).toBe(false);
  }, 30_000);

  it("returns unavailable when a coordinator cannot be reached", async () => {
    const signer = await createEphemeralSigner("key-unavailable");
    const key = await verificationKeyOf(signer);
    const runtime = createCloudflareRuntime({
      env: failingCoordinatorEnv(),
      signer,
      keys: new Map([[key.keyId, key]]),
      organizationIds: ["org-unreachable"],
    });
    const issued = await runtime.accessFromEvidence({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: MERIDIAN,
      evidence: CONFORMANCE_PRINCIPALS.dana.evidence,
    });
    expect(isFailed(issued)).toBe(true);
    if (!isFailed(issued)) return;
    expect(issued.failure.kind).toBe("unavailable");
  }, 30_000);

  it("returns unavailable when the organization directory cannot be read during the exchange", async () => {
    const result = await evidenceFromProviderCode(failingCoordinatorEnv(), {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: MERIDIAN,
      issuer: "https://idp.example",
      clientId: "client",
      redirectUri: "https://tenant.example/callback",
      code: "code-1",
      codeVerifier: "a".repeat(43),
      expectedNonce: "nonce-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unavailable");
  });

  it("refuses an ambiguous principal link instead of resolving the first organization", async () => {
    await createCloudflareConformanceWorld(env);
    const ambiguousOrganization = "org-ambiguous-runtime";
    const org = organization(ambiguousOrganization);
    await post(org, "/reset", {});
    const bootstrapped = await post(org, "/bootstrap", {
      organizationId: ambiguousOrganization,
      actors: [{ actorId: "actor-ambiguous" }],
      principalLinks: [{
        provider: CONFORMANCE_PRINCIPALS.dana.evidence.provider,
        subject: CONFORMANCE_PRINCIPALS.dana.evidence.subject,
        actorId: "actor-ambiguous",
      }],
      orgAdmins: [],
      sealedIdpConfig: "sealed:test",
    });
    expect(bootstrapped.ok).toBe(true);

    const signer = await createEphemeralSigner("key-ambiguous");
    const key = await verificationKeyOf(signer);
    const runtime = createCloudflareRuntime({
      env: env as Env,
      signer,
      keys: new Map([[key.keyId, key]]),
      // the duplicate is last: a first-match resolver would return Harbor
      organizationIds: [...conformanceOrganizationIds(), ambiguousOrganization],
    });
    const issued = await runtime.accessFromEvidence({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: MERIDIAN,
      evidence: CONFORMANCE_PRINCIPALS.dana.evidence,
    });
    expect(isFailed(issued)).toBe(true);
    if (!isFailed(issued)) return;
    expect(issued.failure.kind).toBe("unavailable");
    expect(issued.failure.detail).toMatch(/ambiguous/);
  }, 30_000);
});
