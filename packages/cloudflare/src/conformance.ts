import {
  CONFORMANCE_WORLD,
  type ConformanceWorld,
} from "org-hats/conformance";
import type { Env } from "./env";
import {
  createCloudflareRuntime,
  createEphemeralSigner,
  verificationKeyOf,
} from "./runtime";

/** Boot the portable conformance world into the two coordinators. Every case
 * gets a fresh world: the coordinators are reset, then bootstrapped from the
 * same fixtures the in-memory world uses. */
export const createCloudflareConformanceWorld = async (env: Env): Promise<ConformanceWorld> => {
  const organizationIds = [...new Set(
    CONFORMANCE_WORLD.fixtures.flatMap((fixture) =>
      fixture.snapshot.organizations.map((organization) => organization.organizationId),
    ),
  )];
  const operationIds = [...new Set(
    CONFORMANCE_WORLD.fixtures.flatMap((fixture) =>
      fixture.snapshot.operations.map((operation) => operation.operationId),
    ),
  )];

  const organization = (id: string) => env.ORGANIZATION.get(env.ORGANIZATION.idFromName(id));
  const operation = (id: string) => env.OPERATION.get(env.OPERATION.idFromName(id));

  const post = async (stub: DurableObjectStub, path: string, body: unknown): Promise<unknown> => {
    const response = await stub.fetch(`https://authority.internal${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as { readonly ok: boolean; readonly failure?: unknown };
    if (!result.ok) throw new Error(`conformance bootstrap ${path} failed: ${JSON.stringify(result.failure)}`);
    return result;
  };

  for (const id of organizationIds) await post(organization(id), "/reset", {});
  for (const id of operationIds) await post(operation(id), "/reset", {});

  for (const id of organizationIds) {
    const fixtures = CONFORMANCE_WORLD.fixtures;
    const organizationRecord = fixtures
      .flatMap((fixture) => fixture.snapshot.organizations)
      .find((candidate) => candidate.organizationId === id);
    const actors = [...new Map(
      fixtures
        .flatMap((fixture) => fixture.snapshot.actors)
        .filter((actor) => actor.organizationId === id)
        .map((actor) => [actor.actorId, {
          actorId: actor.actorId,
          ...(actor.displayName === undefined ? {} : { displayName: actor.displayName }),
          ...(actor.disabled === true ? { disabled: true } : {}),
        }]),
    ).values()];
    const principalLinks = CONFORMANCE_WORLD.principalLinks
      .filter((link) => link.organizationId === id)
      .map((link) => ({ provider: link.provider, subject: link.subject, actorId: link.actorId }));
    await post(organization(id), "/bootstrap", {
      organizationId: id,
      ...(organizationRecord?.displayName === undefined ? {} : { displayName: organizationRecord.displayName }),
      actors,
      principalLinks,
      orgAdmins: CONFORMANCE_WORLD.orgAdmins[id] ?? [],
      sealedIdpConfig: "sealed:conformance",
    });
  }

  for (const fixture of CONFORMANCE_WORLD.fixtures) {
    const snapshot = fixture.snapshot;
    const operationRecord = snapshot.operations[0];
    if (operationRecord === undefined) continue;
    await post(operation(operationRecord.operationId), "/bootstrap", {
      operationId: operationRecord.operationId,
      ...(operationRecord.displayName === undefined ? {} : { displayName: operationRecord.displayName }),
      ...(operationRecord.bounded === true ? { bounded: true } : {}),
      policy: fixture.policy,
      configureActions: ["configure"],
      sites: snapshot.sites.map((site) => ({
        siteId: site.siteId,
        ...(site.displayName === undefined ? {} : { displayName: site.displayName }),
        aliases: [...site.aliases],
      })),
      teams: snapshot.teams.map((team) => ({
        teamId: team.teamId,
        siteId: team.siteId,
        organizationId: team.organizationId,
        ...(team.displayName === undefined ? {} : { displayName: team.displayName }),
      })),
      grants: snapshot.grants.map((grant) => ({
        grantId: grant.grantId,
        organizationId: grant.organizationId,
        actorId: grant.actorId,
        role: grant.role,
        target: grant.target,
        ...(grant.primary === true ? { primary: true } : {}),
        ...(grant.revoked === true ? { revoked: true } : {}),
      })),
      participations: snapshot.participations.map((participation) => ({
        organizationId: participation.organizationId,
        status: participation.status,
      })),
    });
  }

  const signer = await createEphemeralSigner();
  const key = await verificationKeyOf(signer);
  return {
    runtime: createCloudflareRuntime({
      env,
      signer,
      keys: new Map([[key.keyId, key]]),
      organizationIds,
    }),
    keys: new Map([[key.keyId, key]]),
  };
};
