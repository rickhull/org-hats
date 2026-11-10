/** Canonical per-coordinator state export and restore.
 *
 * The export is plain rows, not a SQLite file: the restore drill is about
 * state semantics, not storage format. A coordinator wraps restore in
 * `transactionSync` so a failed restore leaves the previous state intact. */

export type StateValue = string | number | null;
export type StateRow = Record<string, StateValue>;

/** How many outbox messages one drain may deliver.
 *
 * Each pending row costs one coordinator subrequest, and the platform caps
 * subrequests per invocation. Without a bound a large enough backlog exceeds
 * the cap, fails partway, and the one-second alarm re-attempts the same
 * oversized batch forever — a livelock rather than a slowdown, which is the
 * failure this number exists to prevent.
 *
 * 25 sits under even the free tier's 50-subrequest limit, so the bound does
 * not depend on which plan a deployment runs. The alarm reschedules a second
 * out while anything is pending, so this is also the drain rate: a thousand
 * queued messages clear in forty seconds. Fan-out is expanded at enqueue, so
 * one row is one subrequest and this count is the subrequest bound. */
export const OUTBOX_DRAIN_LIMIT = 25;

/** How long a delivered outbox row is kept before the drain prunes it.
 *
 * A delivered row's only remaining use is forensic — whether a message went
 * out, and when — and the audit trail carries the durable version of that. A
 * week spans a weekend plus a working day, which is the realistic window for
 * noticing a delivery problem and looking into it.
 *
 * Age rather than count: a count cap would prune a busy organization's rows
 * faster than a quiet one's, which makes the retention window depend on
 * traffic instead of on time, and time is the axis the question is asked on.
 *
 * This is safe in a way pruning `audit` or `claims` is not. A delivered
 * outbox row is spent: it is not evidence, and it is not what makes a retry
 * safe. Do not read this as a precedent for those tables. */
export const OUTBOX_DELIVERED_RETENTION_SECONDS = 7 * 86_400;

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
  { name: "organization", columns: ["organization_id", "display_name", "short_name", "sealed_idp_config", "sealed_idp_config_updated_at", "created_at", "updated_at"], orderBy: "organization_id" },
  { name: "actors", columns: ["actor_id", "display_name", "disabled", "created_at", "updated_at"], orderBy: "actor_id" },
  { name: "principal_links", columns: ["provider", "subject", "actor_id", "created_at"], orderBy: "provider, subject" },
  { name: "activation_requests", columns: ["request_id", "actor_id", "secret_hash", "issued_at", "expires_at", "consumed_at", "revoked_at"], orderBy: "request_id" },
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
  { name: "operation", columns: ["operation_id", "display_name", "short_name", "slug", "bounded", "policy_json", "admin_roles_json", "configure_actions_json", "envelope_lifetime_seconds", "created_at", "updated_at"], orderBy: "operation_id" },
  { name: "sites", columns: ["site_id", "display_name", "short_name", "path", "aliases_json", "created_at", "updated_at"], orderBy: "site_id" },
  { name: "teams", columns: ["team_id", "site_id", "organization_id", "display_name", "status", "created_at", "updated_at"], orderBy: "team_id" },
  { name: "participations", columns: ["organization_id", "status", "created_at", "updated_at"], orderBy: "organization_id" },
  { name: "invitations", columns: ["invitation_id", "organization_id", "status", "created_at", "updated_at"], orderBy: "invitation_id" },
  { name: "grants", columns: ["grant_id", "organization_id", "actor_id", "role", "target_kind", "team_id", "site_id", "is_primary", "revoked", "created_at", "updated_at"], orderBy: "grant_id" },
  { name: "refresh_records", columns: ["handle_hash", "organization_id", "actor_id", "revoked", "superseded", "amr_json", "auth_time", "created_at"], orderBy: "handle_hash" },
  { name: "access_requests", columns: ["request_id", "organization_id", "actor_id", "note", "created_at"], orderBy: "request_id" },
  { name: "audit", columns: ["seq", "at", "actor", "fact"], orderBy: "seq" },
  { name: "claims", columns: ["idempotency_key", "payload", "created_at"], orderBy: "idempotency_key" },
  { name: "outbox", columns: ["id", "kind", "target", "payload", "created_at", "delivered_at"], orderBy: "id" },
];
