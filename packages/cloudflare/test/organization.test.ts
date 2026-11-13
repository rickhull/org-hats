import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call, organizationBootstrap } from "./helpers";
import { OUTBOX_DRAIN_LIMIT } from "../src/state";

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

const drain = async (stub: DurableObjectStub) =>
  call<{ delivered: number; pending: number }>(stub, "POST", "/drain");

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
    expect(status.body.value?.["schemaVersion"]).toBe("4");
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
    // A fan-out is expanded at enqueue into one row per participating
    // operation, so the organization needs one to address. With none, the
    // event is correctly enqueued nowhere — asserted separately below.
    await invite(stub, "op-disable-watcher");
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
    const disabledMessages = messages.body.value?.filter((message) => message.kind === "actor-disabled") ?? [];
    expect(disabledMessages.length).toBe(1);
    expect(disabledMessages[0]?.target).toBe("op-disable-watcher");

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

  it("creates, renames, appoints, and retires administrators without a deployment", async () => {
    const stub = organization("org-roster");
    expect((await call(stub, "POST", "/bootstrap", organizationBootstrap("org/roster"))).body.ok).toBe(true);
    await invite(stub, "op-roster-watcher");

    const created = await call<{ applied: boolean }>(stub, "POST", "/create-actor", {
      actorId: "actor-new",
      displayName: "New Person",
      byActorId: "actor-lead",
      idempotencyKey: "create-1",
    });
    expect(created.body.ok).toBe(true);
    const replay = await call<{ applied: boolean }>(stub, "POST", "/create-actor", {
      actorId: "actor-new",
      displayName: "New Person",
      byActorId: "actor-lead",
      idempotencyKey: "create-1",
    });
    expect(replay.body.value).toEqual({ applied: false });
    const duplicate = await call(stub, "POST", "/create-actor", {
      actorId: "actor-new",
      byActorId: "actor-lead",
      idempotencyKey: "create-2",
    });
    expect(duplicate.body.failure?.kind).toBe("invalid-command");

    // the roster image is what lets an operation decide about the new actor,
    // and it deliberately carries no display name
    const messages = await outbox(stub);
    const rosters = messages.body.value?.filter((message) => message.kind === "roster") ?? [];
    expect(rosters.some((message) => JSON.stringify(message.payload).includes("actor-new"))).toBe(true);
    expect(rosters.every((message) => !JSON.stringify(message.payload).includes("New Person"))).toBe(true);

    const renamed = await call(stub, "POST", "/update-actor", {
      actorId: "actor-new",
      displayName: "Renamed Person",
      byActorId: "actor-lead",
      idempotencyKey: "rename-1",
    });
    expect(renamed.body.ok).toBe(true);
    const cleared = await call(stub, "POST", "/update-actor", {
      actorId: "actor-new",
      displayName: null,
      byActorId: "actor-lead",
      idempotencyKey: "rename-2",
    });
    expect(cleared.body.ok).toBe(true);
    const empty = await call(stub, "POST", "/update-actor", {
      actorId: "actor-new",
      displayName: "",
      byActorId: "actor-lead",
      idempotencyKey: "rename-3",
    });
    expect(empty.body.failure?.kind).toBe("invalid-command");

    // an unclaimed successor may be appointed but is not usable, so the last
    // linked administrator cannot retire yet
    expect((await call(stub, "POST", "/appoint-administrator", {
      actorId: "actor-new",
      byActorId: "actor-lead",
      idempotencyKey: "appoint-1",
    })).body.ok).toBe(true);
    const refused = await call(stub, "POST", "/retire-administrator", {
      actorId: "actor-lead",
      byActorId: "actor-lead",
      idempotencyKey: "retire-1",
    });
    expect(refused.body.failure?.kind).toBe("denied");
    expect(refused.body.failure?.detail).toMatch(/no other usable administrator/);

    // a linked, enabled successor takes over
    expect((await call(stub, "POST", "/appoint-administrator", {
      actorId: "actor-crew",
      byActorId: "actor-lead",
      idempotencyKey: "appoint-2",
    })).body.ok).toBe(true);
    expect((await call(stub, "POST", "/retire-administrator", {
      actorId: "actor-lead",
      byActorId: "actor-lead",
      idempotencyKey: "retire-2",
    })).body.ok).toBe(true);
    const retired = await call(stub, "POST", "/create-actor", {
      actorId: "actor-after",
      byActorId: "actor-lead",
      idempotencyKey: "create-after",
    });
    expect(retired.body.failure?.kind).toBe("denied");
    const successor = await call(stub, "POST", "/create-actor", {
      actorId: "actor-after",
      byActorId: "actor-crew",
      idempotencyKey: "create-after",
    });
    expect(successor.body.ok).toBe(true);
  });

  it("a re-bootstrap cannot revert a rename or re-enable a disabled actor", async () => {
    const stub = organization("org-rebootstrap");
    expect((await call(stub, "POST", "/bootstrap", organizationBootstrap("org/rebootstrap"))).body.ok).toBe(true);

    expect((await call(stub, "POST", "/update-actor", {
      actorId: "actor-crew",
      displayName: "Renamed Crew",
      byActorId: "actor-lead",
      idempotencyKey: "rebootstrap-rename",
    })).body.ok).toBe(true);
    expect((await call(stub, "POST", "/disable", {
      actorId: "actor-crew",
      byActorId: "actor-lead",
      idempotencyKey: "rebootstrap-disable",
    })).body.ok).toBe(true);

    // the operator re-runs the same bootstrap payload
    expect((await call(stub, "POST", "/bootstrap", organizationBootstrap("org/rebootstrap"))).body.ok).toBe(true);

    const crew = await call<{ actorId: string; displayName?: string; disabled: boolean }>(
      stub,
      "GET",
      "/actor?actorId=actor-crew",
    );
    expect(crew.body.value?.displayName).toBe("Renamed Crew");
    expect(crew.body.value?.disabled).toBe(true);
  });

  it("[A9] a re-bootstrap cannot reappoint a retired administrator", async () => {
    const stub = organization("org-standing");
    expect((await call(stub, "POST", "/bootstrap", organizationBootstrap("org/standing"))).body.ok).toBe(true);

    // the successor holds standing before the predecessor retires
    expect((await call(stub, "POST", "/appoint-administrator", {
      actorId: "actor-crew",
      byActorId: "actor-lead",
      idempotencyKey: "standing-appoint",
    })).body.ok).toBe(true);
    expect((await call(stub, "POST", "/retire-administrator", {
      actorId: "actor-lead",
      byActorId: "actor-lead",
      idempotencyKey: "standing-retire",
    })).body.ok).toBe(true);

    // the operator replays an old payload that still seeds the predecessor
    expect((await call(stub, "POST", "/bootstrap", organizationBootstrap("org/standing"))).body.ok).toBe(true);

    const retired = await call(stub, "POST", "/create-actor", {
      actorId: "actor-after",
      byActorId: "actor-lead",
      idempotencyKey: "standing-after",
    });
    expect(retired.body.failure?.kind).toBe("denied");
    const successor = await call(stub, "POST", "/create-actor", {
      actorId: "actor-after",
      byActorId: "actor-crew",
      idempotencyKey: "standing-after",
    });
    expect(successor.body.ok).toBe(true);
  });

  it("[A9] a bootstrap of an existing organization seeds no standing", async () => {
    const stub = organization("org-late-seed");
    // an organization created without standing has no seed writer afterwards:
    // a later payload cannot appoint its first administrator by replay
    expect((await call(stub, "POST", "/bootstrap", {
      ...organizationBootstrap("org/late-seed"),
      orgAdmins: [],
    })).body.ok).toBe(true);
    expect((await call(stub, "POST", "/bootstrap", organizationBootstrap("org/late-seed"))).body.ok).toBe(true);

    const denied = await call(stub, "POST", "/create-actor", {
      actorId: "actor-after",
      byActorId: "actor-lead",
      idempotencyKey: "late-seed-create",
    });
    expect(denied.body.failure?.kind).toBe("denied");
  });

  it("[A10] refuses a principal link that would make one identity two actors", async () => {
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

describe("the outbox drain is bounded per invocation", () => {
  // Before the bound, a drain issued one coordinator subrequest per pending
  // message per fan-out target, against a platform cap on subrequests per
  // invocation. Exceeding it was a livelock rather than a slowdown: the
  // undelivered rows stayed pending, the alarm rescheduled a second later,
  // and the next invocation attempted the same oversized batch forever.
  it("expands a fan-out into one addressed row per participating operation", async () => {
    const stub = organization("org-fanout");
    await bootstrap(stub, "org/fanout");
    const operations = ["op-fan-a", "op-fan-b", "op-fan-c"];
    for (const [index, operationId] of operations.entries()) {
      await invite(stub, operationId, `inv-fan-${index}`);
    }

    await call(stub, "POST", "/disable", {
      actorId: "actor-crew",
      byActorId: "actor-lead",
      idempotencyKey: "fanout-disable",
    });

    const messages = (await outbox(stub)).body.value ?? [];
    const disabled = messages.filter((message) => message.kind === "actor-disabled");
    expect(disabled.length).toBe(operations.length);
    expect(disabled.map((message) => message.target).sort()).toEqual([...operations].sort());
    // one row per target is what makes a row one subrequest, and what lets a
    // target that failed stop forcing redelivery to the ones that succeeded
    expect(new Set(disabled.map((message) => message.id)).size).toBe(operations.length);
  });

  it("drains a backlog larger than the cap across invocations rather than failing", async () => {
    const stub = organization("org-backlog");
    await bootstrap(stub, "org/backlog");
    // more participating operations than the cap, so one disable alone
    // produces a backlog that must be drained in batches
    const count = OUTBOX_DRAIN_LIMIT + 7;
    for (let index = 0; index < count; index += 1) {
      await invite(stub, `op-backlog-${index}`, `inv-backlog-${index}`);
    }
    await call(stub, "POST", "/disable", {
      actorId: "actor-crew",
      byActorId: "actor-lead",
      idempotencyKey: "backlog-disable",
    });
    // a disable emits two facts to every participating operation — the
    // disable itself and the refreshed roster image — so the backlog is twice
    // the operation count, and well over the cap
    const total = ((await outbox(stub)).body.value ?? []).length;
    expect(total).toBe(count * 2);
    expect(total).toBeGreaterThan(OUTBOX_DRAIN_LIMIT);

    // every invocation delivers at most the cap, and reports the remainder
    // rather than throwing or wedging
    const first = await drain(stub);
    expect(first.body.ok).toBe(true);
    expect(first.body.value?.delivered).toBe(OUTBOX_DRAIN_LIMIT);
    expect(first.body.value?.pending).toBe(total - OUTBOX_DRAIN_LIMIT);

    // and it keeps draining in capped batches until the backlog clears,
    // which is the alarm's job in a deployment
    let remaining = first.body.value?.pending ?? 0;
    let invocations = 1;
    while (remaining > 0) {
      const next = await drain(stub);
      expect(next.body.value?.delivered).toBe(Math.min(OUTBOX_DRAIN_LIMIT, remaining));
      remaining = next.body.value?.pending ?? 0;
      invocations += 1;
    }
    expect(invocations).toBe(Math.ceil(total / OUTBOX_DRAIN_LIMIT));
  }, 30_000);

  it("refuses a display label the display-name rule rejects, at bootstrap", async () => {
    // Same boundary and same rule as the operation coordinator: a bad label
    // is refused before it persists, rather than stored and rendered later.
    const stub = organization("org/label-rule");
    const long = "x".repeat(201);

    const tooLong = await call(stub, "POST", "/bootstrap", {
      ...organizationBootstrap("org/label-rule"),
      shortName: long,
    });
    expect(tooLong.body.failure?.kind).toBe("invalid-command");

    const empty = await call(stub, "POST", "/bootstrap", {
      ...organizationBootstrap("org/label-rule"),
      shortName: "   ",
    });
    expect(empty.body.failure?.kind).toBe("invalid-command");

    const longDisplay = await call(stub, "POST", "/bootstrap", {
      ...organizationBootstrap("org/label-rule", { longName: long }),
    });
    expect(longDisplay.body.failure?.kind).toBe("invalid-command");

    // Nothing persisted: the organization is still unbootstrapped.
    const status = await call<Record<string, unknown>>(stub, "GET", "/status");
    expect(status.body.value?.["organizationId"]).toBe(null);

    const ok = await call(stub, "POST", "/bootstrap", {
      ...organizationBootstrap("org/label-rule"),
      shortName: "y".repeat(200),
    });
    expect(ok.body.ok).toBe(true);
  });
});
