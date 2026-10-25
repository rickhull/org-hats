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
  it("bootstraps, resolves principals, and keeps the sealed config opaque", async () => {
    const stub = organization("org-bootstrap");
    const result = await bootstrap(stub, "org/bootstrap");
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);

    const admin = await call<{ actorId: string; disabled: boolean }>(
      stub,
      "GET",
      "/resolve?provider=idp&subject=admin",
    );
    expect(admin.body.ok).toBe(true);
    expect(admin.body.value?.actorId).toBe("actor-admin");
    expect(admin.body.value?.disabled).toBe(false);

    const unknown = await call(stub, "GET", "/resolve?provider=idp&subject=nobody");
    expect(unknown.body.ok).toBe(false);
    expect(unknown.body.failure?.kind).toBe("unauthenticated");

    const status = await call<Record<string, unknown>>(stub, "GET", "/status");
    expect(status.body.value?.["schemaVersion"]).toBe("1");
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

    const member = await accept(stub, "op-accept", "actor-member", "accept-member");
    expect(member.body.ok).toBe(false);
    expect(member.body.failure?.kind).toBe("denied");

    const first = await accept(stub, "op-accept", "actor-admin", "accept-1");
    expect(first.body.ok).toBe(true);
    expect(first.body.value?.applied).toBe(true);
    expect(first.body.value?.invitationId).toBe("inv-1");

    const retry = await accept(stub, "op-accept", "actor-admin", "accept-1");
    expect(retry.body.ok).toBe(true);
    expect(retry.body.value?.applied).toBe(false);

    const misuse = await call(stub, "POST", "/accept", {
      operationId: "op-other",
      actorId: "actor-admin",
      idempotencyKey: "accept-1",
    });
    expect(misuse.body.ok).toBe(false);
    expect(misuse.body.failure?.kind).toBe("invalid-command");

    const messages = await outbox(stub);
    expect(messages.body.value).toHaveLength(1);
    expect(messages.body.value?.[0]?.kind).toBe("acceptance");
    expect(messages.body.value?.[0]?.target).toBe("op-accept");

    const trail = await audit(stub);
    expect(trail.body.value?.some((entry) => entry.fact.includes("invitation inv-1 accepted"))).toBe(true);

    const delivered = await call(stub, "POST", `/outbox/${messages.body.value?.[0]?.id}/delivered`);
    expect(delivered.body.ok).toBe(true);
    const empty = await outbox(stub);
    expect(empty.body.value).toHaveLength(0);
  });

  it("refuses acceptance before the invitation arrives", async () => {
    const stub = organization("org-early");
    await bootstrap(stub, "org/early");
    const early = await accept(stub, "op-early", "actor-admin", "accept-early");
    expect(early.body.ok).toBe(false);
    expect(early.body.failure?.kind).toBe("denied");
  });

  it("disables an actor and emits the actor-disabled message", async () => {
    const stub = organization("org-disable");
    await bootstrap(stub, "org/disable");
    const disabled = await call(stub, "POST", "/disable", {
      actorId: "actor-member",
      byActorId: "actor-admin",
      idempotencyKey: "disable-1",
    });
    expect(disabled.body.ok).toBe(true);

    const member = await call<{ disabled: boolean }>(
      stub,
      "GET",
      "/resolve?provider=idp&subject=member",
    );
    expect(member.body.value?.disabled).toBe(true);

    const messages = await outbox(stub);
    expect(messages.body.value?.some((message) => message.kind === "actor-disabled")).toBe(true);

    const trail = await audit(stub);
    expect(trail.body.value?.some((entry) => entry.fact.includes("actor actor-member disabled"))).toBe(true);
  });

  it("revokes participation and emits the operation message", async () => {
    const stub = organization("org-revoke");
    await bootstrap(stub, "org/revoke");
    await invite(stub, "op-revoke");
    await accept(stub, "op-revoke", "actor-admin", "accept-revoke");
    const revoked = await call(stub, "POST", "/revoke", {
      operationId: "op-revoke",
      actorId: "actor-admin",
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
        { actorId: "actor-admin", displayName: "Nia Fields" },
        { actorId: "actor-member", displayName: "Sam Whitfield" },
      ],
      principalLinks: [{ provider: "idp", subject: "admin", actorId: "actor-admin" }],
      orgAdmins: ["actor-admin"],
    });
    expect(first.body.ok).toBe(true);

    // re-linking the same subject to a different actor is a configuration
    // error, not a silent first-wins or last-wins
    const conflict = await call(stub, "POST", "/bootstrap", {
      organizationId: "org/links",
      actors: [{ actorId: "actor-admin" }, { actorId: "actor-member" }],
      principalLinks: [{ provider: "idp", subject: "admin", actorId: "actor-member" }],
      orgAdmins: [],
    });
    expect(conflict.body.ok).toBe(false);
    expect(conflict.body.failure?.kind).toBe("invalid-command");
    expect(conflict.body.failure?.detail).toMatch(/already resolves/);
    const stillAdmin = await call<{ actorId: string }>(
      stub,
      "GET",
      "/resolve?provider=idp&subject=admin",
    );
    expect(stillAdmin.body.value?.actorId).toBe("actor-admin");

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
