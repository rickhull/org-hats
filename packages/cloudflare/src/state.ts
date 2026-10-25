/** Canonical per-coordinator state export and restore.
 *
 * The export is plain rows, not a SQLite file: the restore drill is about
 * state semantics, not storage format. A coordinator wraps restore in
 * `transactionSync` so a failed restore leaves the previous state intact. */

export type StateValue = string | number | null;
export type StateRow = Record<string, StateValue>;

export interface TableSpec {
  readonly name: string;
  readonly columns: readonly string[];
  readonly orderBy: string;
}

export interface ExportSnapshot {
  readonly schemaVersion: string;
  readonly coordinator: "organization" | "operation";
  readonly tables: Record<string, StateRow[]>;
}

export const readTables = (
  sql: SqlStorage,
  specs: readonly TableSpec[],
): Record<string, StateRow[]> => {
  const tables: Record<string, StateRow[]> = {};
  for (const spec of specs) {
    tables[spec.name] = sql
      .exec<StateRow>(`SELECT ${spec.columns.join(", ")} FROM ${spec.name} ORDER BY ${spec.orderBy}`)
      .toArray();
  }
  return tables;
};

/** Clear the data tables and insert the snapshot's rows. The caller owns the
 * transaction. A missing table is treated as empty; an unknown table in the
 * snapshot is ignored by construction. */
export const restoreTables = (
  sql: SqlStorage,
  specs: readonly TableSpec[],
  tables: Readonly<Record<string, readonly StateRow[]>>,
): void => {
  for (const spec of specs) {
    sql.exec(`DELETE FROM ${spec.name}`);
    const rows = tables[spec.name] ?? [];
    if (rows.length === 0) continue;
    const placeholders = spec.columns.map(() => "?").join(", ");
    for (const row of rows) {
      sql.exec(
        `INSERT INTO ${spec.name} (${spec.columns.join(", ")}) VALUES (${placeholders})`,
        ...spec.columns.map((column) => row[column] ?? null),
      );
    }
  }
};

export const organizationTables: readonly TableSpec[] = [
  { name: "organization", columns: ["organization_id", "display_name", "sealed_idp_config", "sealed_idp_config_updated_at", "created_at", "updated_at"], orderBy: "organization_id" },
  { name: "actors", columns: ["actor_id", "display_name", "disabled", "created_at", "updated_at"], orderBy: "actor_id" },
  { name: "principal_links", columns: ["provider", "subject", "actor_id", "created_at"], orderBy: "provider, subject" },
  { name: "org_admins", columns: ["actor_id", "created_at"], orderBy: "actor_id" },
  { name: "invitations", columns: ["invitation_id", "operation_id", "status", "created_at", "updated_at"], orderBy: "invitation_id" },
  { name: "audit", columns: ["seq", "at", "actor", "fact"], orderBy: "seq" },
  { name: "claims", columns: ["idempotency_key", "payload", "created_at"], orderBy: "idempotency_key" },
  { name: "outbox", columns: ["id", "kind", "target", "payload", "created_at", "delivered_at"], orderBy: "id" },
];

/** The operation's own facts. The `org_actors` projection is deliberately
 * absent: it is derived from the organizations, and a snapshot that carried
 * it would restore a stale roster as authority. Restore rebuilds it by
 * pulling, which fails closed in the meantime — an actor missing from the
 * projection is `not-admitted`, never wrongly admitted. */
export const operationTables: readonly TableSpec[] = [
  { name: "operation", columns: ["operation_id", "display_name", "slug", "bounded", "policy_json", "admin_roles_json", "configure_actions_json", "envelope_lifetime_seconds", "created_at", "updated_at"], orderBy: "operation_id" },
  { name: "sites", columns: ["site_id", "display_name", "path", "aliases_json", "created_at", "updated_at"], orderBy: "site_id" },
  { name: "teams", columns: ["team_id", "site_id", "organization_id", "display_name", "created_at", "updated_at"], orderBy: "team_id" },
  { name: "participations", columns: ["organization_id", "status", "created_at", "updated_at"], orderBy: "organization_id" },
  { name: "invitations", columns: ["invitation_id", "organization_id", "status", "created_at", "updated_at"], orderBy: "invitation_id" },
  { name: "grants", columns: ["grant_id", "organization_id", "actor_id", "role", "target_kind", "team_id", "site_id", "is_primary", "revoked", "created_at", "updated_at"], orderBy: "grant_id" },
  { name: "refresh_records", columns: ["handle_hash", "organization_id", "actor_id", "revoked", "superseded", "amr_json", "auth_time", "created_at"], orderBy: "handle_hash" },
  { name: "access_requests", columns: ["request_id", "organization_id", "actor_id", "note", "created_at"], orderBy: "request_id" },
  { name: "audit", columns: ["seq", "at", "actor", "fact"], orderBy: "seq" },
  { name: "claims", columns: ["idempotency_key", "payload", "created_at"], orderBy: "idempotency_key" },
  { name: "outbox", columns: ["id", "kind", "target", "payload", "created_at", "delivered_at"], orderBy: "id" },
];
