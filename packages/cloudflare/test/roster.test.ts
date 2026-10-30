// The org-actor projection: the operation's local copy of the authority
// relevant tuple of each participating organization's roster.
//
// Two channels, tested separately because they do different jobs. The push
// is immediate and carries a change the moment the organization makes it;
// the pull is reconciliation and repairs a push that never arrived. Nothing
// here reads the projection for a decision yet — these tests assert only
// that it converges.

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call, organizationBootstrap } from "./helpers";

const LEAD = "actor-lead";
const CREW = "actor-crew";
const SITE = "site-roster";
const TEAM = "team-roster";

interface World {
  readonly orgId: string;
  readonly opId: string;
  readonly org: DurableObjectStub;
  readonly op: DurableObjectStub;
}

const world = (suffix: string): World => {
  const orgId = `org-${suffix}`;
  const opId = `op-${suffix}`;
  return {
    orgId,
    opId,
    org: env.ORGANIZATION.get(env.ORGANIZATION.idFromName(orgId)),
    op: env.OPERATION.get(env.OPERATION.idFromName(opId)),
  };
};

const bootstrapOperation = async (current: World) =>
  call(current.op, "POST", "/bootstrap", {
    operationId: current.opId,
    slug: "roster-op",
    policy: {
      format: 1,
      id: "policy-roster",
      version: "1",
      actions: ["observe"],
      roles: [{ title: "field", actions: ["observe"] }],
      readPolicy: { organizations: "granted-teams" },
    },
    adminRoles: ["admin"],
    configureActions: ["configure"],
    sites: [{ siteId: SITE, path: "site", aliases: ["site"] }],
    teams: [{ teamId: TEAM, siteId: SITE, organizationId: current.orgId }],
    grants: [
      { grantId: "g-roster", organizationId: current.orgId, actorId: CREW, role: "field", target: { kind: "team", teamId: TEAM }, primary: true },
    ],
  });

const drain = async (stub: DurableObjectStub) =>
  call<{ delivered: number; pending: number }>(stub, "POST", "/drain");

const status = async (current: World) =>
  (await call<Record<string, unknown>>(current.op, "GET", "/status")).body.value;

/** The projection's rows, read through the operator's inspection view. Not
 * the export: the projection is derived, so a snapshot deliberately does not
 * carry it. */
interface ProjectedActor {
  readonly organization_id: string;
  readonly actor_id: string;
  readonly disabled: number;
  readonly synced_at: number;
}

/** The snapshot's `orgActors` arrive ordered by `actor_id`: the `actors` table
 * spec declares that order, so it is behavior to assert, not an accident of
 * insertion. The assertions below compare ordered rows, which means renaming a
 * fixture actor can reorder them. */
const projected = async (current: World): Promise<ProjectedActor[]> => {
  const snapshot = await call<{ orgActors: ProjectedActor[] }>(current.op, "GET", "/snapshot");
  return snapshot.body.value?.orgActors ?? [];
};

/** Invite, deliver, accept, deliver: the participation ends up active and
 * the organization has pushed its roster along the way. */
const participate = async (current: World): Promise<void> => {
  await call(current.org, "POST", "/bootstrap", organizationBootstrap(current.orgId));
  await bootstrapOperation(current);
  await call(current.op, "POST", "/invite", {
    organizationId: current.orgId,
    byActorId: LEAD,
    idempotencyKey: `invite-${current.opId}`,
  });
  await drain(current.op);
  await call(current.org, "POST", "/accept", {
    operationId: current.opId,
    actorId: LEAD,
    idempotencyKey: `accept-${current.opId}`,
  });
  await drain(current.org);
};

describe("the org-actor projection", () => {
  it("arrives by push when the organization accepts the invitation", async () => {
    const current = world("roster-push");
    await participate(current);

    expect(await projected(current)).toEqual([
      { organization_id: current.orgId, actor_id: CREW, disabled: 0, synced_at: expect.any(Number) },
      { organization_id: current.orgId, actor_id: LEAD, disabled: 0, synced_at: expect.any(Number) },
    ]);
    const current_status = await status(current);
    expect(current_status?.["orgActors"]).toBe(2);
    expect(current_status?.["disabledOrgActors"]).toBe(0);
    expect(current_status?.["rosterSyncedAt"]).toBeGreaterThan(0);
  });

  it("carries a disable, so the operation's own state shows it", async () => {
    const current = world("roster-disable");
    await participate(current);

    await call(current.org, "POST", "/disable", {
      actorId: CREW,
      byActorId: LEAD,
      idempotencyKey: "disable-roster",
    });
    expect((await drain(current.org)).body.value?.pending).toBe(0);

    const rows = await projected(current);
    expect(rows.find((row) => row.actor_id === CREW)?.disabled).toBe(1);
    expect(rows.find((row) => row.actor_id === LEAD)?.disabled).toBe(0);
    expect((await status(current))?.["disabledOrgActors"]).toBe(1);
  });

  it("repairs a push that never arrived, by pulling", async () => {
    const current = world("roster-repair");
    await participate(current);
    expect(await projected(current)).toHaveLength(2);

    // a third actor appears, and the push stays pending: nothing drains
    const added = {
      ...organizationBootstrap(current.orgId),
      actors: [
        { actorId: LEAD, displayName: "Nia Fields" },
        { actorId: CREW, displayName: "Sam Whitfield" },
        { actorId: "actor-late", displayName: "Ira Mendel" },
      ],
    };
    await call(current.org, "POST", "/bootstrap", added);
    expect(await projected(current)).toHaveLength(2);

    // reconciliation pulls the organization's current state directly
    const reconciled = await call<{ synced: number; organizations: number }>(
      current.op,
      "POST",
      "/reconcile-rosters",
    );
    expect(reconciled.body.value).toEqual({ synced: 1, organizations: 1 });
    expect((await projected(current)).map((row) => row.actor_id)).toEqual([
      CREW,
      "actor-late",
      LEAD,
    ]);
  });

  it("ignores an image older than the one already applied", async () => {
    const current = world("roster-stale");
    await participate(current);
    const before = await projected(current);
    expect(before).toHaveLength(2);

    // a delayed delivery: the outbox can land a message whose target was
    // briefly unreachable after a later one
    const stale = await call(current.op, "POST", "/intake", {
      messageId: "stale-image",
      kind: "roster",
      organizationId: current.orgId,
      at: 1,
      actors: [{ actorId: "actor-ghost", disabled: false }],
    });
    expect(stale.body.ok).toBe(true);
    expect(await projected(current)).toEqual(before);

    const trail = await call<readonly { fact: string }[]>(current.op, "GET", "/audit");
    expect(trail.body.value?.some((entry) => entry.fact.includes("ignored: image 1 is older"))).toBe(true);
  });

  it("is load-bearing: issuance follows the projection, not a fabricated actor", async () => {
    const current = world("roster-decides");
    await participate(current);

    const issued = await call<{ claims: { actor: { actorId: string } } }>(current.op, "POST", "/issue", {
      organizationId: current.orgId,
      actorId: CREW,
    });
    expect(issued.body.ok).toBe(true);
    expect(issued.body.value?.claims.actor.actorId).toBe(CREW);

    // the same grant, the same participation, but the actor is no longer in
    // the projection: before the projection existed this still issued,
    // because the snapshot fabricated the actor who was asking
    const removed = await call(current.op, "POST", "/intake", {
      messageId: "roster-without-crew",
      kind: "roster",
      organizationId: current.orgId,
      actors: [{ actorId: LEAD, disabled: false }],
    });
    expect(removed.body.ok).toBe(true);

    const refused = await call(current.op, "POST", "/issue", {
      organizationId: current.orgId,
      actorId: CREW,
    });
    expect(refused.body.ok).toBe(false);
    expect(refused.body.failure?.kind).toBe("not-admitted");
  });

  it("is load-bearing: a disabled actor holds no wearable hat", async () => {
    const current = world("roster-disabled-denies");
    await participate(current);
    expect((await call(current.op, "POST", "/issue", {
      organizationId: current.orgId,
      actorId: CREW,
    })).body.ok).toBe(true);

    await call(current.org, "POST", "/disable", {
      actorId: CREW,
      byActorId: LEAD,
      idempotencyKey: "disable-denies",
    });
    await drain(current.org);

    const refused = await call(current.op, "POST", "/issue", {
      organizationId: current.orgId,
      actorId: CREW,
    });
    expect(refused.body.ok).toBe(false);
    expect(refused.body.failure?.kind).toBe("not-admitted");
  });

  it("[A13] is load-bearing: refresh denies a disabled actor whose disable message was lost", async () => {
    const current = world("roster-refresh");
    await participate(current);

    const issued = await call<{ refresh: { handle: string } }>(current.op, "POST", "/issue", {
      organizationId: current.orgId,
      actorId: CREW,
    });
    expect(issued.body.ok).toBe(true);
    // refresh rotates, so the live handle is the one the last call returned
    const rotated = await call<{ refresh: { handle: string } }>(current.op, "POST", "/refresh", {
      handle: issued.body.value?.refresh.handle ?? "",
    });
    expect(rotated.body.ok).toBe(true);

    // The disable happens, but neither the `actor-disabled` message nor the
    // roster image arrives: nothing drains and nothing reconciles. The
    // projection therefore still says enabled. Refresh re-resolves the actor
    // at the organization, so it refuses on the live fact rather than on the
    // stale image.
    await call(current.org, "POST", "/disable", {
      actorId: CREW,
      byActorId: LEAD,
      idempotencyKey: "disable-lost",
    });
    expect((await projected(current)).find((row) => row.actor_id === CREW)?.disabled).toBe(0);

    const refreshed = await call<{ refresh: { handle: string } }>(current.op, "POST", "/refresh", {
      handle: rotated.body.value?.refresh.handle ?? "",
    });
    expect(refreshed.body.ok).toBe(false);
    expect(refreshed.body.failure?.kind).toBe("not-admitted");
  });

  it("is derived: an export does not carry it, and a restore rebuilds it", async () => {
    const current = world("roster-restore");
    await participate(current);
    expect(await projected(current)).toHaveLength(2);

    // the snapshot carries the operation's own facts and not the projection
    const exported = await call<{ tables: Record<string, unknown[]> }>(current.op, "GET", "/export");
    expect(exported.body.ok).toBe(true);
    expect(exported.body.value?.tables["org_actors"]).toBeUndefined();
    expect(exported.body.value?.tables["participations"]).toHaveLength(1);

    // restoring rebuilds the projection by pulling, rather than resurrecting
    // a copy from the snapshot
    const restored = await call(current.op, "POST", "/restore", exported.body.value);
    expect(restored.body.ok).toBe(true);
    expect(await projected(current)).toHaveLength(2);

    // and issuance works immediately after the restore: the rebuild ran
    const issued = await call(current.op, "POST", "/issue", {
      organizationId: current.orgId,
      actorId: CREW,
    });
    expect(issued.body.ok).toBe(true);
  });

  it("reconciles only actively participating organizations", async () => {
    const current = world("roster-scope");
    await participate(current);

    // revoking the participation takes the organization out of the
    // reconciliation set; the projection is not the place that enforces
    // participation, so the rows stay until an image says otherwise
    await call(current.op, "POST", "/revoke-participation", {
      organizationId: current.orgId,
      byActorId: LEAD,
      idempotencyKey: "revoke-scope",
    });
    const reconciled = await call<{ synced: number; organizations: number }>(
      current.op,
      "POST",
      "/reconcile-rosters",
    );
    expect(reconciled.body.value).toEqual({ synced: 0, organizations: 0 });
  });
});
