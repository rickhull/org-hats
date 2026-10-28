import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call, organizationBootstrap } from "./helpers";

const organization = (name: string) =>
  env.ORGANIZATION.get(env.ORGANIZATION.idFromName(name));

const bootstrap = async (stub: DurableObjectStub, organizationId: string) =>
  call(stub, "POST", "/bootstrap", organizationBootstrap(organizationId));

const invite = async (stub: DurableObjectStub, operationId: string, invitationId = "inv-1") =>
  call(stub, "POST", "/invite", { invitationId, operationId });

const accept = async (
  stub: DurableObjectStub,
  operationId: string,
  actorId: string,
  idempotencyKey: string,
) =>
  call<{ applied: boolean; invitationId?: string }>(stub, "POST", "/accept", {
    operationId,
    actorId,
    idempotencyKey,
  });

const outbox = async (stub: DurableObjectStub) =>
  call<readonly { id: string; kind: string; target: string; payload: unknown }[]>(
    stub,
    "GET",
    "/outbox",
  );

const audit = async (stub: DurableObjectStub) =>
  call<readonly { seq: number; actor: string; fact: string }[]>(stub, "GET", "/audit");

describe("OrganizationAuthority", () => {
  it("persists only activation digests and atomically accepts one subject", async () => {
    const stub = organization("org-activation");
    const bootstrapped = await call(stub, "POST", "/bootstrap", {
      ...organizationBootstrap("org/activation"),
      principalLinks: [{ provider: "idp", subject: "lead", actorId: "actor-lead" }],
    });
    expect(bootstrapped.body.ok).toBe(true);

    const issued = await call<{ requestId: string; expiresAt: number }>(stub, "POST", "/activation-request", {
      actorId: "actor-crew",
      byActorId: "actor-lead",
      secretHash: "hash-only-not-plaintext",
    });
    expect(issued.body.ok).toBe(true);
    const inspected = await call<{ usable: true }>(stub, "POST", "/activation-inspect", {
      secretHash: "hash-only-not-plaintext",
    });
    expect(inspected.body.value).toEqual({ usable: true });

    const accepted = await call<{ applied: boolean; actorId: string }>(stub, "POST", "/activation-accept", {
      secretHash: "hash-only-not-plaintext",
      provider: "idp",
      subject: "crew-new",
    });
    expect(accepted.body.value).toEqual({ applied: true, actorId: "actor-crew" });
    const replay = await call<{ applied: boolean; actorId: string }>(stub, "POST", "/activation-accept", {
      secretHash: "hash-only-not-plaintext",
      provider: "idp",
      subject: "crew-new",
    });
    expect(replay.body.value).toEqual({ applied: false, actorId: "actor-crew" });
    const different = await call(stub, "POST", "/activation-accept", {
      secretHash: "hash-only-not-plaintext",
      provider: "idp",
      subject: "crew-other",
    });
    expect(different.body.failure?.kind).toBe("unauthenticated");

    const snapshot = await call<{ tables: Record<string, Record<string, unknown>[]> }>(stub, "GET", "/export");
    const request = snapshot.body.value?.tables["activation_requests"]?.[0];
    expect(request?.["secret_hash"]).toBe("hash-only-not-plaintext");
    expect(request).not.toHaveProperty("provider");
    expect(request).not.toHaveProperty("subject");
  });

  it("bootstraps, resolves principals, and keeps the sealed config opaque", async () => {
    const stub = organization("org-bootstrap");
    const result = await bootstrap(stub, "org/bootstrap");
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);

    const lead = await call<{ actorId: string; disabled: boolean }>(
      stub,
      "GET",
      "/resolve?provider=idp&subject=lead",
    );
    expect(lead.body.ok).toBe(true);
    expect(lead.body.value?.actorId).toBe("actor-lead");
    expect(lead.body.value?.disabled).toBe(false);

    const unknown = await call(stub, "GET", "/resolve?provider=idp&subject=nobody");
    expect(unknown.body.ok).toBe(false);
    expect(unknown.body.failure?.kind).toBe("unauthenticated");

    const status = await call<Record<string, unknown>>(stub, "GET", "/status");
    expect(status.body.value?.["schemaVersion"]).toBe("2");
    expect(status.body.value?.["organizationId"]).toBe("org/bootstrap");
    expect(status.body.value?.["actors"]).toBe(2);
    expect(status.body.value?.["hasSealedIdpConfig"]).toBe(true);
    expect(JSON.stringify(status.body)).not.toContain("sealed:test-only");

    const trail = await audit(stub);
    expect(trail.body.value?.some((entry) => entry.fact.includes("bootstrapped"))).toBe(true);
  });

  it("runs invite → accept with an atomic audit, outbox, and idempotency claim", async () => {
    const stub = organization("org-accept");
    await bootstrap(stub, "org/accept");
    await invite(stub, "op-accept");

    const crew = await accept(stub, "op-accept", "actor-crew", "accept-crew");
    expect(crew.body.ok).toBe(false);
    expect(crew.body.failure?.kind).toBe("denied");

    const first = await accept(stub, "op-accept", "actor-lead", "accept-1");
    expect(first.body.ok).toBe(true);
    expect(first.body.value?.applied).toBe(true);
    expect(first.body.value?.invitationId).toBe("inv-1");

    const retry = await accept(stub, "op-accept", "actor-lead", "accept-1");
    expect(retry.body.ok).toBe(true);
    expect(retry.body.value?.applied).toBe(false);

    const misuse = await call(stub, "POST", "/accept", {
      operationId: "op-other",
      actorId: "actor-lead",
      idempotencyKey: "accept-1",
    });
    expect(misuse.body.ok).toBe(false);
    expect(misuse.body.failure?.kind).toBe("invalid-command");

    // the acceptance plus the roster images bootstrap and accept each push;
    // assert the kinds rather than a total, so a new channel does not read
    // as a regression here
    const messages = await outbox(stub);
    const acceptances = messages.body.value?.filter((message) => message.kind === "acceptance") ?? [];
    expect(acceptances).toHaveLength(1);
    expect(acceptances[0]?.target).toBe("op-accept");
    expect(messages.body.value?.filter((message) => message.kind === "roster").length).toBeGreaterThan(0);
    expect(messages.body.value?.every((message) => message.kind === "acceptance" || message.kind === "roster")).toBe(true);

    const trail = await audit(stub);
    expect(trail.body.value?.some((entry) => entry.fact.includes("invitation inv-1 accepted"))).toBe(true);

    // marking every pending message delivered empties the pending list
    for (const message of messages.body.value ?? []) {
      const delivered = await call(stub, "POST", `/outbox/${message.id}/delivered`);
      expect(delivered.body.ok).toBe(true);
    }
    const empty = await outbox(stub);
    expect(empty.body.value).toHaveLength(0);
  });

  it("refuses acceptance before the invitation arrives", async () => {
    const stub = organization("org-early");
    await bootstrap(stub, "org/early");
    const early = await accept(stub, "op-early", "actor-lead", "accept-early");
    expect(early.body.ok).toBe(false);
    expect(early.body.failure?.kind).toBe("denied");
  });

  it("disables an actor and emits the actor-disabled message", async () => {
    const stub = organization("org-disable");
    await bootstrap(stub, "org/disable");
    const disabled = await call(stub, "POST", "/disable", {
      actorId: "actor-crew",
      byActorId: "actor-lead",
      idempotencyKey: "disable-1",
    });
    expect(disabled.body.ok).toBe(true);

    const crew = await call<{ disabled: boolean }>(
      stub,
      "GET",
      "/resolve?provider=idp&subject=crew",
    );
    expect(crew.body.value?.disabled).toBe(true);

    const messages = await outbox(stub);
    expect(messages.body.value?.some((message) => message.kind === "actor-disabled")).toBe(true);

    const trail = await audit(stub);
    expect(trail.body.value?.some((entry) => entry.fact.includes("actor actor-crew disabled"))).toBe(true);
  });

  it("revokes participation and emits the operation message", async () => {
    const stub = organization("org-revoke");
    await bootstrap(stub, "org/revoke");
    await invite(stub, "op-revoke");
    await accept(stub, "op-revoke", "actor-lead", "accept-revoke");
    const revoked = await call(stub, "POST", "/revoke", {
      operationId: "op-revoke",
      actorId: "actor-lead",
      idempotencyKey: "revoke-1",
    });
    expect(revoked.body.ok).toBe(true);
    const messages = await outbox(stub);
    expect(messages.body.value?.some((message) => message.kind === "participation-revoked")).toBe(true);
    const trail = await audit(stub);
    expect(trail.body.value?.some((entry) => entry.fact.includes("participation in op-revoke revoked"))).toBe(true);
  });

  it("refuses a principal link that would make one identity two actors", async () => {
    const stub = organization("org-links");
    const first = await call(stub, "POST", "/bootstrap", {
      organizationId: "org/links",
      actors: [
        { actorId: "actor-lead", displayName: "Nia Fields" },
        { actorId: "actor-crew", displayName: "Sam Whitfield" },
      ],
      principalLinks: [{ provider: "idp", subject: "lead", actorId: "actor-lead" }],
      orgAdmins: ["actor-lead"],
    });
    expect(first.body.ok).toBe(true);

    // re-linking the same subject to a different actor is a configuration
    // error, not a silent first-wins or last-wins
    const conflict = await call(stub, "POST", "/bootstrap", {
      organizationId: "org/links",
      actors: [{ actorId: "actor-lead" }, { actorId: "actor-crew" }],
      principalLinks: [{ provider: "idp", subject: "lead", actorId: "actor-crew" }],
      orgAdmins: [],
    });
    expect(conflict.body.ok).toBe(false);
    expect(conflict.body.failure?.kind).toBe("invalid-command");
    expect(conflict.body.failure?.detail).toMatch(/already resolves/);
    const stillLead = await call<{ actorId: string }>(
      stub,
      "GET",
      "/resolve?provider=idp&subject=lead",
    );
    expect(stillLead.body.value?.actorId).toBe("actor-lead");

    // a link naming an actor nobody knows is refused, not stored dead
    const unknown = await call(stub, "POST", "/bootstrap", {
      organizationId: "org/links",
      principalLinks: [{ provider: "idp", subject: "ghost", actorId: "actor-nobody" }],
      orgAdmins: [],
    });
    expect(unknown.body.ok).toBe(false);
    expect(unknown.body.failure?.kind).toBe("invalid-command");
  });
});
