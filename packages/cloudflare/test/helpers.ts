// Shared helpers for the coordinator suites: the response-envelope shape,
// the stub call, and the Cedar Works organization bootstrap payload — the
// same actors, principal links, org admins, and sealed config everywhere;
// only the organization id (and, at the ops surface, the display name and
// sealed marker) varies per test.

export interface Failure {
  readonly kind: string;
  readonly detail?: string;
}

export interface Envelope<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly failure?: Failure;
}

/** The coordinator handlers route on the pathname alone, so one fetch
 * authority serves both coordinators' stubs. */
export const call = async <T>(
  stub: DurableObjectStub,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Envelope<T> }> => {
  const response = await stub.fetch(`https://authority.internal${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
};

export const organizationBootstrap = (
  organizationId: string,
  overrides: { readonly longName?: string; readonly sealedIdpConfig?: string } = {},
) => ({
  organizationId,
  longName: overrides.longName ?? "Cedar Works",
  actors: [
    { actorId: "actor-lead", displayName: "Nia Fields" },
    { actorId: "actor-crew", displayName: "Sam Whitfield" },
  ],
  principalLinks: [
    { provider: "idp", subject: "lead", actorId: "actor-lead" },
    { provider: "idp", subject: "crew", actorId: "actor-crew" },
  ],
  orgAdmins: ["actor-lead"],
  sealedIdpConfig: overrides.sealedIdpConfig ?? "sealed:test-only",
});

export interface AuditRow {
  readonly seq: number;
  readonly at: number;
  readonly actor: string;
  readonly fact: string;
}

/** A restore appends one audit row recording itself, written after the tables
 * are replaced so the snapshot cannot overwrite it. It is therefore the one
 * row a round-trip comparison must account for: export → restore → export is
 * faithful in every fact the snapshot carried, plus that trace.
 *
 * Tests compare against `withoutRestoreAudit(...)` and assert the row itself
 * separately, so the appended trace stays visible rather than being absorbed
 * into a looser equality. */
export const restoreAuditOf = (tables: Readonly<Record<string, readonly unknown[]>>): AuditRow | undefined => {
  const audit = tables["audit"] ?? [];
  const last = audit[audit.length - 1] as AuditRow | undefined;
  return last?.fact?.startsWith("state restored from a snapshot") === true ? last : undefined;
};

export const withoutRestoreAudit = <T extends { readonly tables: Record<string, unknown[]> }>(snapshot: T): T => {
  if (restoreAuditOf(snapshot.tables) === undefined) return snapshot;
  const audit = snapshot.tables["audit"] ?? [];
  return { ...snapshot, tables: { ...snapshot.tables, audit: audit.slice(0, -1) } };
};
