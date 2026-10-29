import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call, organizationBootstrap } from "./helpers";

const LEAD = "actor-lead";
const CREW = "actor-crew";
const SITE = "site-test";
const TEAM = "team-test";

interface World {
  readonly orgId: string;
  readonly opId: string;
  readonly org: DurableObjectStub;
  readonly op: DurableObjectStub;
}

/** The coordinator ids are the addresses: the operation invites
 * `idFromName(organizationId)`, and the organization replies to
 * `idFromName(operationId)`. Each test gets its own pair. */
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

const bootstrapOrganization = async (current: World) =>
  call(current.org, "POST", "/bootstrap", organizationBootstrap(current.orgId));

/** `participating` declares the organization active at bootstrap, the shape
 * a seeded deployment uses: bootstrap also pulls the roster, so the grant
 * preconditions — an actor in the projection, an active participation — are
 * satisfied without walking the invitation workflow. */
const bootstrapOperation = async (current: World, participating = false) =>
  call(current.op, "POST", "/bootstrap", {
    operationId: current.opId,
    slug: "test-op",
    ...(participating ? { participations: [{ organizationId: current.orgId, status: "active" }] } : {}),
    displayName: "Test Operation",
    policy: {
      format: 1,
      id: "policy-test",
      version: "1",
      actions: ["observe", "review", "configure"],
      roles: [
        { title: "field", actions: ["observe"] },
        { title: "lead", actions: ["observe", "review"] },
        { title: "admin", actions: ["observe", "review", "configure"] },
      ],
      readPolicy: { organizations: "granted-teams" },
    },
    adminRoles: ["admin"],
    configureActions: ["configure"],
    sites: [{ siteId: SITE, path: "site", aliases: ["site"] }],
    teams: [{ teamId: TEAM, siteId: SITE, organizationId: current.orgId }],
    grants: [
      {
        grantId: "g-field",
        organizationId: current.orgId,
        actorId: CREW,
        role: "field",
        target: { kind: "team", teamId: TEAM },
        primary: true,
      },
    ],
  });

const routingPolicy = {
  format: 1,
  id: "policy-routing",
  version: "1",
  actions: ["observe"],
  roles: [{ title: "field", actions: ["observe"] }],
  readPolicy: { organizations: "granted-teams" },
};

const routingBootstrap = (operationId: string, overrides: Record<string, unknown> = {}) => ({
  operationId,
  slug: "routing-op",
  policy: routingPolicy,
  sites: [{ siteId: SITE, path: "site", aliases: [] }],
  teams: [],
  grants: [],
  participations: [],
  ...overrides,
});

const invite = async (current: World, key = "invite-1") =>
  call<{ applied: boolean; invitationId?: string }>(current.op, "POST", "/invite", {
    organizationId: current.orgId,
    byActorId: LEAD,
    idempotencyKey: key,
  });

const accept = async (current: World, key = "accept-1") =>
  call<{ applied: boolean }>(current.org, "POST", "/accept", {
    operationId: current.opId,
    actorId: LEAD,
    idempotencyKey: key,
  });

const drain = async (stub: DurableObjectStub) =>
  call<{ delivered: number; pending: number }>(stub, "POST", "/drain");

describe("OperationAuthority", () => {
  it("stores and exports routing facts, and replaces them as a full set", async () => {
    const current = world("routing-facts");
    await bootstrapOrganization(current);
    const bootstrapped = await call(current.op, "POST", "/bootstrap", routingBootstrap(current.opId));
    expect(bootstrapped.body.ok).toBe(true);

    const snapshot = await call<{ operationSlug?: string; sites: { path?: string }[] }>(
      current.op,
      "GET",
      "/snapshot",
    );
    expect(snapshot.body.value?.operationSlug).toBe("routing-op");
    expect(snapshot.body.value?.sites[0]?.path).toBe("site");

    const exported = await call<{
      schemaVersion: string;
      tables: { operation: Record<string, unknown>[]; sites: Record<string, unknown>[] };
    }>(current.op, "GET", "/export");
    expect(exported.body.value?.schemaVersion).toBe("5");
    expect(exported.body.value?.tables.operation[0]?.["slug"]).toBe("routing-op");
    expect(exported.body.value?.tables.sites[0]?.["path"]).toBe("site");
    const status = await call<{ routingFactsComplete: boolean }>(current.op, "GET", "/status");
    expect(status.body.value?.routingFactsComplete).toBe(true);

    const updated = await call(current.op, "POST", "/routing-facts", {
      slug: "renamed-op",
      sites: [{ siteId: SITE, path: "renamed" }],
    });
    expect(updated.body.ok).toBe(true);
    const after = await call<{ operationSlug?: string; sites: { path?: string }[] }>(
      current.op,
      "GET",
      "/snapshot",
    );
    expect(after.body.value?.operationSlug).toBe("renamed-op");
    expect(after.body.value?.sites[0]?.path).toBe("renamed");
    const audit = await call<readonly { fact: string }[]>(current.op, "GET", "/audit");
    expect(audit.body.value?.some((entry) => entry.fact.includes("slug routing-op -> renamed-op"))).toBe(true);
    expect(audit.body.value?.some((entry) => entry.fact.includes("paths site-test:site -> site-test:renamed"))).toBe(true);

    const partial = await call(current.op, "POST", "/routing-facts", {
      slug: "renamed-op",
      sites: [],
    });
    expect(partial.body.ok).toBe(false);
    expect(partial.body.failure?.kind).toBe("invalid-command");
  });

  it("refuses invalid routing facts before committing", async () => {
    const current = world("routing-invalid");
    const cases = [
      { name: "www slug", overrides: { slug: "www" }, detail: /slug/ },
      { name: "invalid path", overrides: { sites: [{ siteId: SITE, path: "two/parts", aliases: [] }] }, detail: /path/ },
      {
        name: "duplicate path",
        overrides: { sites: [{ siteId: SITE, path: "same", aliases: [] }, { siteId: "site-two", path: "same", aliases: [] }] },
        detail: /used more than once/,
      },
      { name: "reserved alias", overrides: { sites: [{ siteId: SITE, path: "site", aliases: ["www"] }] }, detail: /alias/ },
      { name: "alias collides with slug", overrides: { sites: [{ siteId: SITE, path: "site", aliases: ["routing-op"] }] }, detail: /collides/ },
    ];
    for (const entry of cases) {
      const result = await call(current.op, "POST", "/bootstrap", routingBootstrap(current.opId, entry.overrides));
      expect(result.body.ok, entry.name).toBe(false);
      expect(result.body.failure?.kind, entry.name).toBe("invalid-command");
      expect(result.body.failure?.detail ?? "", entry.name).toMatch(entry.detail);
    }
  });

  it("refuses an acceptance delivered after the participation was revoked", async () => {
    // The outbox retries, so an acceptance can arrive against a state that
    // has moved on. `UPDATE participations SET status = 'active'` had no
    // current-state guard, and no CHECK constraint can express a transition
    // — only a set of legal strings — so the fix is to decide with the
    // portable state machine before writing.
    const current = world("accept-after-revoke");
    await bootstrapOrganization(current);
    await bootstrapOperation(current);

    const invited = await invite(current, "invite-race");
    expect(invited.body.ok).toBe(true);
    const invitationId = invited.body.value?.invitationId ?? "";

    const revoked = await call(current.op, "POST", "/revoke-participation", {
      organizationId: current.orgId,
      byActorId: LEAD,
      idempotencyKey: "revoke-race",
    });
    expect(revoked.body.ok).toBe(true);

    // the acceptance lands late, carrying the invitation it was issued for
    const late = await call(current.op, "POST", "/intake", {
      messageId: "late-acceptance",
      kind: "acceptance",
      invitationId,
    });
    expect(late.status).toBe(200);
    expect(late.body.ok).toBe(true);

    // A message that cannot be applied is a retry, not a recorded no-op: the
    // status distinguishes it so an outbox keeps retrying only real failures.
    const retry = await call(current.op, "POST", "/intake", {
      messageId: "acceptance-without-invitation",
      kind: "acceptance",
    });
    expect(retry.status).toBe(503);
    expect(retry.body.ok).toBe(false);
    expect(retry.body.failure?.kind).toBe("invalid-command");

    const snapshot = await call<Record<string, unknown>>(current.op, "GET", "/snapshot");
    const participations = snapshot.body.value?.["participations"] as { organization_id: string; status: string }[];
    expect(participations.find((p) => p.organization_id === current.orgId)?.status).toBe("revoked");

    const trail = await call<readonly { fact: string }[]>(current.op, "GET", "/audit");
    expect(trail.body.value?.some((entry) => entry.fact.includes("not applied: cannot accept from revoked"))).toBe(true);
  });

  it("revoking twice is a safe retry; revoking a non-participant is denied", async () => {
    const current = world("revoke-twice");
    await bootstrapOrganization(current);
    await bootstrapOperation(current);
    await invite(current, "invite-twice");

    const revoke = async (key: string, organizationId = current.orgId) =>
      call(current.op, "POST", "/revoke-participation", {
        organizationId,
        byActorId: LEAD,
        idempotencyKey: key,
      });

    expect((await revoke("twice-1")).body.ok).toBe(true);
    // a fresh key is not a replay, and must still read as success
    expect((await revoke("twice-2")).body.ok).toBe(true);

    const stranger = await revoke("twice-3", "org-stranger");
    expect(stranger.body.ok).toBe(false);
    expect(stranger.body.failure?.kind).toBe("denied");
  });

  it("refuses to re-invite a revoked organization: revoke is terminal", async () => {
    const current = world("reinvite");
    await bootstrapOrganization(current);
    await bootstrapOperation(current);
    await invite(current, "reinvite-1");
    await call(current.op, "POST", "/revoke-participation", {
      organizationId: current.orgId,
      byActorId: LEAD,
      idempotencyKey: "reinvite-revoke",
    });

    const again = await invite(current, "reinvite-2");
    expect(again.body.ok).toBe(false);
    expect(again.body.failure?.kind).toBe("denied");
    expect(again.body.failure?.detail).toContain("already participating");
  });

  it("moves an invitation through org authority and back as active participation", async () => {
    const current = world("flow");
    await bootstrapOrganization(current);
    await bootstrapOperation(current);

    const invited = await invite(current);
    expect(invited.body.ok).toBe(true);
    expect(invited.body.value?.invitationId).toBeDefined();
    expect((await drain(current.op)).body.value).toEqual({ delivered: 1, pending: 0 });

    const orgStatus = await call<Record<string, unknown>>(current.org, "GET", "/status");
    expect(orgStatus.body.value?.["invitations"]).toBe(1);

    const accepted = await accept(current);
    expect(accepted.body.ok).toBe(true);
    expect(accepted.body.value?.applied).toBe(true);
    // the acceptance plus the roster images the organization pushed; every
    // message must land, so assert nothing is left pending rather than a
    // delivered count a new channel would change
    expect((await drain(current.org)).body.value?.pending).toBe(0);

    const snapshot = await call<Record<string, unknown>>(current.op, "GET", "/snapshot");
    const participations = snapshot.body.value?.["participations"] as { organization_id: string; status: string }[];
    expect(participations.find((p) => p.organization_id === current.orgId)?.status).toBe("active");

    const retry = await accept(current, "accept-1");
    expect(retry.body.ok).toBe(true);
    expect(retry.body.value?.applied).toBe(false);
  });

  it("retries a delivery through the alarm when the organization is not ready", async () => {
    const current = world("retry");
    await bootstrapOperation(current);
    await invite(current, "invite-retry");
    const first = await drain(current.op);
    expect(first.body.value?.pending).toBe(1);

    // The alarm runs while the organization is still absent: still pending.
    await runDurableObjectAlarm(current.op);
    const stillPending = await call<Record<string, unknown>>(current.op, "GET", "/status");
    expect(stillPending.body.value?.["outbox"]).toBe(1);

    await bootstrapOrganization(current);
    await runDurableObjectAlarm(current.op);
    const delivered = await call<Record<string, unknown>>(current.op, "GET", "/status");
    expect(delivered.body.value?.["outbox"]).toBe(0);
    const orgStatus = await call<Record<string, unknown>>(current.org, "GET", "/status");
    expect(orgStatus.body.value?.["invitations"]).toBe(1);
  });

  it("refuses a grant to an unknown actor or a non-participating organization", async () => {
    const current = world("grant-preconditions");
    await bootstrapOrganization(current);
    await bootstrapOperation(current, true);

    const base = {
      organizationId: current.orgId,
      actorId: CREW,
      role: "lead",
      target: { kind: "team", teamId: TEAM },
      byActorId: LEAD,
    };

    // an actor the operation has never heard of: the projection is what
    // makes this answerable at all, since actors live in the other object
    const stranger = await call(current.op, "POST", "/grant", {
      ...base,
      actorId: "actor-nobody",
      grantId: "g-stranger",
      idempotencyKey: "grant-stranger",
    });
    expect(stranger.body.ok).toBe(false);
    expect(stranger.body.failure?.kind).toBe("invalid-command");
    expect(stranger.body.failure?.detail).toBe("unknown actor");

    // a real actor of an organization that does not participate here
    const outsider = await call(current.op, "POST", "/grant", {
      ...base,
      organizationId: "org-outsider",
      grantId: "g-outsider",
      idempotencyKey: "grant-outsider",
    });
    expect(outsider.body.ok).toBe(false);
    expect(outsider.body.failure?.kind).toBe("invalid-command");

    // and once the participation is revoked, no new grant stands on it
    await call(current.op, "POST", "/revoke-participation", {
      organizationId: current.orgId,
      byActorId: LEAD,
      idempotencyKey: "grant-precondition-revoke",
    });
    const afterRevoke = await call(current.op, "POST", "/grant", {
      ...base,
      grantId: "g-after-revoke",
      idempotencyKey: "grant-after-revoke",
    });
    expect(afterRevoke.body.ok).toBe(false);
    expect(afterRevoke.body.failure?.kind).toBe("denied");
    expect(afterRevoke.body.failure?.detail).toContain("actively participate");
  });

  it("grants, selects, revokes, and revokes refresh records idempotently", async () => {
    const current = world("grants");
    // the organization first: bootstrap pulls its roster, and a grant now
    // stands on an actor the operation knows and an active participation
    await bootstrapOrganization(current);
    await bootstrapOperation(current, true);

    const grant = await call<{ applied: boolean; grantId?: string }>(current.op, "POST", "/grant", {
      grantId: "g-new",
      organizationId: current.orgId,
      actorId: CREW,
      role: "lead",
      target: { kind: "team", teamId: TEAM },
      byActorId: LEAD,
      idempotencyKey: "grant-1",
    });
    expect(grant.body.ok).toBe(true);
    expect(grant.body.value?.applied).toBe(true);
    const retry = await call<{ applied: boolean }>(current.op, "POST", "/grant", {
      grantId: "g-new",
      organizationId: current.orgId,
      actorId: CREW,
      role: "lead",
      target: { kind: "team", teamId: TEAM },
      byActorId: LEAD,
      idempotencyKey: "grant-1",
    });
    expect(retry.body.value?.applied).toBe(false);

    const misuse = await call(current.op, "POST", "/grant", {
      grantId: "g-new",
      organizationId: current.orgId,
      actorId: CREW,
      role: "field",
      target: { kind: "team", teamId: TEAM },
      byActorId: LEAD,
      idempotencyKey: "grant-1",
    });
    expect(misuse.body.failure?.kind).toBe("invalid-command");

    const selected = await call(current.op, "POST", "/select-hat", {
      grantId: "g-new",
      actorId: CREW,
      byActorId: CREW,
      idempotencyKey: "select-1",
    });
    expect(selected.body.ok).toBe(true);
    const recorded = await call(current.op, "POST", "/refresh-record", {
      handleHash: "hash-1",
      organizationId: current.orgId,
      actorId: CREW,
    });
    expect(recorded.body.ok).toBe(true);
    const before = await call<Record<string, unknown>>(current.op, "GET", "/snapshot");
    const grants = before.body.value?.["grants"] as { grantId: string; primary: boolean }[];
    expect(grants.find((grant) => grant.grantId === "g-new")?.primary).toBe(true);

    const revoked = await call(current.op, "POST", "/revoke-grant", {
      grantId: "g-new",
      byActorId: LEAD,
      idempotencyKey: "revoke-1",
    });
    expect(revoked.body.ok).toBe(true);
    const after = await call<Record<string, unknown>>(current.op, "GET", "/snapshot");
    const records = after.body.value?.["refreshRecords"] as { handle_hash: string; revoked: number }[];
    expect(records.find((record) => record.handle_hash === "hash-1")?.revoked).toBe(1);
  });

  it("rotates one handle at most once under concurrent refresh", async () => {
    const current = world("refresh-race");
    await bootstrapOrganization(current);
    await bootstrapOperation(current, true);

    const issued = await call<{ refresh: { kind: string; handle?: string } }>(current.op, "POST", "/issue", {
      organizationId: current.orgId,
      actorId: CREW,
    });
    expect(issued.body.ok).toBe(true);
    const handle = issued.body.value?.refresh.handle;
    expect(handle).toBeDefined();

    // The organization read suspends the first request; the second must not
    // pass the same superseded check and rotate the same handle again.
    const results = await Promise.all([
      call(current.op, "POST", "/refresh", { handle }),
      call(current.op, "POST", "/refresh", { handle }),
    ]);
    expect(results.filter((result) => result.body.ok)).toHaveLength(1);
    expect(results.find((result) => !result.body.ok)?.body.failure?.kind).toBe("unauthenticated");
  });

  it("carries actor-disable from organization authority to operation refresh records", async () => {
    const current = world("disable-flow");
    await bootstrapOrganization(current);
    await bootstrapOperation(current);
    await invite(current, "invite-disable");
    await drain(current.op);
    await accept(current, "accept-disable");
    await drain(current.org);
    await call(current.op, "POST", "/refresh-record", {
      handleHash: "hash-disable",
      organizationId: current.orgId,
      actorId: CREW,
    });

    const disabled = await call(current.org, "POST", "/disable", {
      actorId: CREW,
      byActorId: LEAD,
      idempotencyKey: "disable-1",
    });
    expect(disabled.body.ok).toBe(true);
    // the disable travels as two messages doing two jobs: `actor-disabled`
    // revokes the refresh records, the roster image makes the operation's
    // own decisions see it
    const delivery = await drain(current.org);
    expect(delivery.body.value?.pending).toBe(0);

    const snapshot = await call<Record<string, unknown>>(current.op, "GET", "/snapshot");
    const records = snapshot.body.value?.["refreshRecords"] as { handle_hash: string; revoked: number }[];
    expect(records.find((record) => record.handle_hash === "hash-disable")?.revoked).toBe(1);
  });

  it("reconciles an operation-side participation revoke back to the organization", async () => {
    const current = world("revoke-flow");
    await bootstrapOrganization(current);
    await bootstrapOperation(current);
    await invite(current, "invite-revoke");
    await drain(current.op);
    await accept(current, "accept-revoke");
    await drain(current.org);

    const revoked = await call(current.op, "POST", "/revoke-participation", {
      organizationId: current.orgId,
      byActorId: LEAD,
      idempotencyKey: "revoke-participation-1",
    });
    expect(revoked.body.ok).toBe(true);
    const delivery = await drain(current.op);
    expect(delivery.body.value?.delivered).toBe(1);

    const audit = await call<readonly { fact: string }[]>(current.org, "GET", "/audit");
    expect(audit.body.value?.some((entry) => entry.fact.includes("revoked by operation"))).toBe(true);
  });

  it("survives a failover: state restored from export keeps refresh handles alive", async () => {
    const current = world("failover");
    await bootstrapOrganization(current);
    // active participation without the invite dance: this drill is about
    // state recovery, not the workflow
    await call(current.op, "POST", "/bootstrap", {
      operationId: current.opId,
      slug: "test-op",
      displayName: "Test Operation",
      policy: {
        format: 1,
        id: "policy-test",
        version: "1",
        actions: ["observe"],
        roles: [{ title: "field", actions: ["observe"] }],
        readPolicy: { organizations: "granted-teams" },
      },
      sites: [{ siteId: SITE, path: "site", aliases: [] }],
      teams: [{ teamId: TEAM, siteId: SITE, organizationId: current.orgId }],
      grants: [
        {
          grantId: "g-field",
          organizationId: current.orgId,
          actorId: CREW,
          role: "field",
          target: { kind: "team", teamId: TEAM },
          primary: true,
        },
      ],
      participations: [{ organizationId: current.orgId, status: "active" }],
    });

    const issued = await call<{ claims: unknown; refresh: { kind: string; handle?: string } }>(
      current.op,
      "POST",
      "/issue",
      { organizationId: current.orgId, actorId: CREW },
    );
    expect(issued.body.ok).toBe(true);
    const handle = issued.body.value?.refresh.kind === "rotated" ? issued.body.value.refresh.handle : undefined;
    expect(handle).toBeDefined();

    const exported = await call<Record<string, unknown>>(current.op, "GET", "/export");
    expect(exported.body.ok).toBe(true);
    await call(current.op, "POST", "/reset");
    const restored = await call(current.op, "POST", "/restore", exported.body.value);
    expect(restored.body.ok).toBe(true);

    // the handle issued before the wipe still refreshes against restored
    // state — recovery did not strand the session
    const refreshed = await call<{ refresh: { kind: string } }>(current.op, "POST", "/refresh", { handle });
    expect(refreshed.body.ok).toBe(true);
    expect(refreshed.body.value?.refresh.kind).toBe("rotated");
  });

  it("requests, admits, renames, and retires a team; retirement revokes its grants", async () => {
    const current = world("teams");
    await bootstrapOrganization(current);
    await bootstrapOperation(current, true);

    const requested = await call(current.op, "POST", "/request-team", {
      teamId: "team-new",
      siteId: SITE,
      organizationId: current.orgId,
      displayName: "New Crew",
      byActorId: LEAD,
      byOrganizationId: current.orgId,
      idempotencyKey: "team-request",
    });
    expect(requested.body.ok).toBe(true);

    interface SnapshotRows {
      readonly teams: readonly { readonly team_id: string; readonly status: string; readonly display_name: string | null }[];
      readonly grants: readonly { readonly grantId: string; readonly revoked: boolean }[];
    }
    const pending = await call<SnapshotRows>(current.op, "GET", "/snapshot");
    expect(pending.body.value?.teams.find((team) => team.team_id === "team-new")?.status).toBe("pending");

    const early = await call(current.op, "POST", "/grant", {
      organizationId: current.orgId,
      actorId: CREW,
      role: "field",
      target: { kind: "team", teamId: "team-new" },
      byActorId: LEAD,
      idempotencyKey: "team-early-grant",
    });
    expect(early.body.failure?.kind).toBe("invalid-command");

    expect((await call(current.op, "POST", "/admit-team", {
      teamId: "team-new",
      byActorId: LEAD,
      idempotencyKey: "team-admit",
    })).body.ok).toBe(true);
    const admitted = await call<SnapshotRows>(current.op, "GET", "/snapshot");
    expect(admitted.body.value?.teams.find((team) => team.team_id === "team-new")?.status).toBe("active");

    expect((await call(current.op, "POST", "/update-team", {
      teamId: "team-new",
      displayName: "Renamed Crew",
      byActorId: LEAD,
      byOrganizationId: current.orgId,
      idempotencyKey: "team-rename",
    })).body.ok).toBe(true);

    expect((await call(current.op, "POST", "/grant", {
      organizationId: current.orgId,
      actorId: CREW,
      role: "field",
      target: { kind: "team", teamId: "team-new" },
      byActorId: LEAD,
      idempotencyKey: "team-grant",
    })).body.ok).toBe(true);

    const foreign = await call(current.op, "POST", "/retire-team", {
      teamId: "team-new",
      byActorId: LEAD,
      byOrganizationId: "org-someone-else",
      asOperationAdmin: false,
      idempotencyKey: "team-retire-foreign",
    });
    expect(foreign.body.failure?.kind).toBe("denied");

    expect((await call(current.op, "POST", "/retire-team", {
      teamId: "team-new",
      byActorId: LEAD,
      byOrganizationId: current.orgId,
      asOperationAdmin: false,
      idempotencyKey: "team-retire",
    })).body.ok).toBe(true);

    const retired = await call<SnapshotRows>(current.op, "GET", "/snapshot");
    expect(retired.body.value?.teams.find((team) => team.team_id === "team-new")?.status).toBe("retired");
    expect(retired.body.value?.grants.find((grant) => grant.grantId !== "g-field" && grant.revoked === true)).toBeDefined();

    const reuse = await call(current.op, "POST", "/request-team", {
      teamId: "team-new",
      siteId: SITE,
      organizationId: current.orgId,
      byActorId: LEAD,
      byOrganizationId: current.orgId,
      idempotencyKey: "team-reuse",
    });
    expect(reuse.body.failure?.kind).toBe("invalid-command");
  });

  it("restores a schema-4 export whose teams carry no status", async () => {
    const current = world("restore-legacy-teams");
    await bootstrapOrganization(current);
    await bootstrapOperation(current, true);
    const exported = await call<{
      readonly schemaVersion: string;
      readonly coordinator: string;
      readonly tables: Readonly<Record<string, readonly Record<string, unknown>[]>>;
    }>(current.op, "GET", "/export");
    const snapshot = exported.body.value;
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) return;
    const teams = (snapshot.tables["teams"] ?? []).map((row) => {
      const rest = { ...row };
      delete rest["status"];
      return rest;
    });
    const legacy = { ...snapshot, schemaVersion: "4", tables: { ...snapshot.tables, teams } };
    expect((await call(current.op, "POST", "/reset")).body.ok).toBe(true);
    expect((await call(current.op, "POST", "/restore", legacy)).body.ok).toBe(true);
    const restored = await call<{ readonly teams: readonly { readonly team_id: string; readonly status: string }[] }>(
      current.op,
      "GET",
      "/snapshot",
    );
    expect(restored.body.value?.teams.find((team) => team.team_id === TEAM)?.status).toBe("active");
  });
});
