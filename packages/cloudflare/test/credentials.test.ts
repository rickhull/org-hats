// Org-side credential storage (plans/local_credentials.md phase 2): a
// `credentials` table beside the principal links, carried by export and
// restore, removed by the identity-reset unlink, and untouched by the
// operation-scoped wipe verbs. Internal DO routes only — no public surface
// until phase 3.

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call, organizationBootstrap } from "./helpers";

const LEAD = "actor-lead";

const org = (id: string) => env.ORGANIZATION.get(env.ORGANIZATION.idFromName(id));

const credential = (credentialId: string, actorId: string = LEAD) => ({
  credentialId,
  actorId,
  key: { alg: "ES256", x: "11".repeat(32), y: "22".repeat(32) },
  signCount: 3,
  backupEligible: true,
  backedUp: false,
});

interface Snapshot {
  readonly schemaVersion: string;
  readonly coordinator: string;
  readonly tables: Record<string, Record<string, unknown>[]>;
}

const exported = async (id: string): Promise<Snapshot> => {
  const result = await call<Snapshot>(org(id), "GET", "/export");
  expect(result.body.ok).toBe(true);
  return result.body.value as Snapshot;
};

describe("credential storage", () => {
  it("stores a credential and carries it through export and restore", async () => {
    const source = "org-cred-export";
    const target = "org-cred-restore";
    await call(org(source), "POST", "/bootstrap", organizationBootstrap(source));

    const stored = await call(org(source), "POST", "/credential", credential("cred-1"));
    expect(stored.body.ok).toBe(true);

    const snapshot = await exported(source);
    expect(snapshot.schemaVersion).toBe("6");
    expect(snapshot.tables.credentials?.length).toBe(1);
    expect(snapshot.tables.credentials?.[0]?.["credential_id"]).toBe("cred-1");

    await call(org(target), "POST", "/bootstrap", organizationBootstrap(target));
    const restored = await call(org(target), "POST", "/restore", snapshot);
    expect(restored.body.ok).toBe(true);
    const read = await call<{ actorId: string; signCount: number; key: { alg: string } }>(
      org(target), "GET", "/credential?credentialId=cred-1",
    );
    expect(read.body.ok).toBe(true);
    expect(read.body.value?.actorId).toBe(LEAD);
    expect(read.body.value?.key.alg).toBe("ES256");
  });

  it("restores a pre-credentials snapshot with no credentials, not stale ones", async () => {
    const id = "org-cred-old-snapshot";
    await call(org(id), "POST", "/bootstrap", organizationBootstrap(id));
    await call(org(id), "POST", "/credential", credential("cred-stale"));

    const snapshot = await exported(id);
    const older = { ...snapshot, schemaVersion: "3", tables: { ...snapshot.tables, credentials: undefined } };
    delete (older.tables as Record<string, unknown>).credentials;
    const restored = await call(org(id), "POST", "/restore", older);
    expect(restored.body.ok).toBe(true);
    const read = await call(org(id), "GET", "/credential?credentialId=cred-stale");
    expect(read.body.ok).toBe(false);
  });

  it("updates the sign counter in place", async () => {
    const id = "org-cred-counter";
    await call(org(id), "POST", "/bootstrap", organizationBootstrap(id));
    await call(org(id), "POST", "/credential", credential("cred-2"));

    const updated = await call(org(id), "POST", "/credential-counter", { credentialId: "cred-2", signCount: 9 });
    expect(updated.body.ok).toBe(true);
    const read = await call<{ signCount: number }>(org(id), "GET", "/credential?credentialId=cred-2");
    expect(read.body.value?.signCount).toBe(9);
  });

  it("unlink is an identity reset: the credential goes with the links", async () => {
    const id = "org-cred-unlink";
    await call(org(id), "POST", "/bootstrap", organizationBootstrap(id));
    await call(org(id), "POST", "/credential", credential("cred-3"));

    const unlinked = await call(org(id), "POST", "/unlink-principal", {
      actorId: LEAD,
      byActorId: LEAD,
      idempotencyKey: "unlink-cred-1",
    });
    expect(unlinked.body.ok).toBe(true);
    const read = await call(org(id), "GET", "/credential?credentialId=cred-3");
    expect(read.body.ok).toBe(false);
  });

  it("survives an operation delete and forget-operation untouched", async () => {
    const orgId = "org-cred-wipe";
    const opId = "op-cred-wipe";
    const operation = env.OPERATION.get(env.OPERATION.idFromName(opId));
    await call(org(orgId), "POST", "/bootstrap", organizationBootstrap(orgId));
    await call(org(orgId), "POST", "/credential", credential("cred-4"));
    await call(org(orgId), "POST", "/invite", { invitationId: "inv-cred", operationId: opId });

    // the operation-side wipe, then the org-side scoped cleanup
    expect((await call(operation, "POST", "/delete", { operationId: opId })).body.ok).toBe(true);
    expect((await call(org(orgId), "POST", "/forget-operation", { operationId: opId })).body.ok).toBe(true);

    const read = await call<{ actorId: string }>(org(orgId), "GET", "/credential?credentialId=cred-4");
    expect(read.body.ok).toBe(true);
    expect(read.body.value?.actorId).toBe(LEAD);
  });
});
