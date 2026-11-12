// Route boolean flags outside bootstrap: present non-booleans are refused
// before any route mutates state, and true/false/omitted keep their existing
// meanings. These regressions were proven red first: each malformed value
// below was silently flattened to false or absent.

import { env } from "cloudflare:test";
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

const operationBootstrap = (opId: string, orgId: string) => ({
  operationId: opId,
  slug: "test-op",
  longName: "Test Operation",
  participations: [{ organizationId: orgId, status: "active" }],
  policy: {
    format: 1,
    id: "policy-test",
    version: "1",
    actions: ["observe", "review", "configure"],
    roles: [
      { title: "field", actions: ["observe"] },
      { title: "admin", actions: ["observe", "review", "configure"] },
    ],
    readPolicy: { organizations: "granted-teams" },
  },
  adminRoles: ["admin"],
  configureActions: ["configure"],
  sites: [{ siteId: SITE, path: "site", aliases: ["site"] }],
  teams: [{ teamId: TEAM, siteId: SITE, organizationId: orgId }],
  grants: [],
});

const bootstrapped = async (current: World): Promise<void> => {
  await call(current.org, "POST", "/bootstrap", organizationBootstrap(current.orgId));
  const op = await call(current.op, "POST", "/bootstrap", operationBootstrap(current.opId, current.orgId));
  expect(op.body.ok).toBe(true);
};

describe("route boolean flags", () => {
  it("refuses a non-boolean disabled flag on a roster intake actor", async () => {
    const current = world("intake-flag");
    await bootstrapped(current);
    const result = await call(current.op, "POST", "/intake", {
      messageId: "flag-roster-1",
      kind: "roster",
      organizationId: current.orgId,
      actors: [{ actorId: LEAD, disabled: "yes" }],
    });
    expect(result.body.failure?.kind).toBe("invalid-command");
  });

  it("refuses a non-boolean primary flag on a grant command", async () => {
    const current = world("grant-flag");
    await bootstrapped(current);
    const result = await call(current.op, "POST", "/grant", {
      organizationId: current.orgId,
      actorId: CREW,
      role: "field",
      target: { kind: "team", teamId: TEAM },
      primary: "yes",
      byActorId: LEAD,
      idempotencyKey: "grant-flag-1",
    });
    expect(result.body.failure?.kind).toBe("invalid-command");
    // nothing was granted
    const snapshot = await call<{ grants: unknown[] }>(current.op, "GET", "/snapshot");
    expect(snapshot.body.value?.grants.length).toBe(0);
  });

  it("refuses a non-boolean asOperationAdmin flag on team retirement", async () => {
    const current = world("retire-flag");
    await bootstrapped(current);
    const result = await call(current.op, "POST", "/retire-team", {
      teamId: TEAM,
      byActorId: LEAD,
      byOrganizationId: current.orgId,
      asOperationAdmin: "yes",
      idempotencyKey: "retire-flag-1",
    });
    expect(result.body.failure?.kind).toBe("invalid-command");
  });

  it("refuses a non-boolean operator flag on an activation request", async () => {
    const stub = env.ORGANIZATION.get(env.ORGANIZATION.idFromName("org-activation-flag"));
    const bootstrappedOrg = await call(stub, "POST", "/bootstrap", organizationBootstrap("org-activation-flag"));
    expect(bootstrappedOrg.body.ok).toBe(true);
    const result = await call(stub, "POST", "/activation-request", {
      actorId: CREW,
      byActorId: LEAD,
      secretHash: "hash-flag",
      operator: "yes",
    });
    expect(result.body.failure?.kind).toBe("invalid-command");
  });

  it("refuses a non-boolean operator flag on principal unlinking", async () => {
    const stub = env.ORGANIZATION.get(env.ORGANIZATION.idFromName("org-unlink-flag"));
    const bootstrappedOrg = await call(stub, "POST", "/bootstrap", organizationBootstrap("org-unlink-flag"));
    expect(bootstrappedOrg.body.ok).toBe(true);
    const result = await call(stub, "POST", "/unlink-principal", {
      actorId: CREW,
      byActorId: LEAD,
      idempotencyKey: "unlink-flag-1",
      operator: "yes",
    });
    expect(result.body.failure?.kind).toBe("invalid-command");
    // the actor's links were untouched
    const links = await call<{ readonly links: readonly unknown[] }>(stub, "GET", "/principal-links");
    expect((links.body.value?.links ?? []).length).toBe(2);
  });

  it("keeps accepted true values working: an operator activation request succeeds", async () => {
    const stub = env.ORGANIZATION.get(env.ORGANIZATION.idFromName("org-operator-true"));
    const bootstrappedOrg = await call(stub, "POST", "/bootstrap", {
      ...organizationBootstrap("org-operator-true"),
      // the target must not already hold a principal link
      principalLinks: [{ provider: "idp", subject: "lead", actorId: LEAD }],
    });
    expect(bootstrappedOrg.body.ok).toBe(true);
    const result = await call<{ requestId: string }>(stub, "POST", "/activation-request", {
      actorId: CREW,
      byActorId: CREW,
      secretHash: "hash-operator-true",
      operator: true,
    });
    expect(result.body.ok).toBe(true);
  });
});
