// The operation coordinator's schema and additive migration chain.

import { ensureColumn, initializeSchema, type SchemaMigration } from "./sql";

export const OPERATION_SCHEMA_VERSION = "6";

const TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS operation (
    operation_id TEXT PRIMARY KEY,
    display_name TEXT,
    short_name TEXT,
    slug TEXT,
    bounded INTEGER NOT NULL DEFAULT 0,
    policy_json TEXT NOT NULL,
    admin_roles_json TEXT NOT NULL,
    configure_actions_json TEXT NOT NULL,
    envelope_lifetime_seconds INTEGER NOT NULL DEFAULT 900,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sites (
    site_id TEXT PRIMARY KEY,
    display_name TEXT,
    short_name TEXT,
    path TEXT,
    aliases_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS teams (
    team_id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    display_name TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'retired')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS participations (
    organization_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('invited', 'accepted', 'active', 'revoked')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS invitations (
    invitation_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('invited', 'accepted', 'active', 'revoked')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  // The org-actor projection: the authority-relevant tuple of a participating
  // organization's roster, and nothing more. Display names, principal links,
  // and provider configuration stay in the organization object, which is the
  // only writer of any of it — this operation holds a copy solely so a
  // decision it must make is a local, atomic read.
  `CREATE TABLE IF NOT EXISTS org_actors (
    organization_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0,
    synced_at INTEGER NOT NULL,
    PRIMARY KEY (organization_id, actor_id)
  )`,
  `CREATE TABLE IF NOT EXISTS grants (
    grant_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    role TEXT NOT NULL,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('team', 'site')),
    team_id TEXT,
    site_id TEXT,
    is_primary INTEGER NOT NULL DEFAULT 0,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS refresh_records (
    handle_hash TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    superseded INTEGER NOT NULL DEFAULT 0,
    amr_json TEXT,
    auth_time INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS access_requests (
    request_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    actor TEXT NOT NULL,
    fact TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS claims (
    idempotency_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    target TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    delivered_at INTEGER
  )`,
];

export const operationMigrations: readonly SchemaMigration[] = [
  {
    version: "3",
    name: "refresh-authentication-facts",
    apply: (sql) => {
      ensureColumn(sql, "refresh_records", "amr_json", "TEXT");
      ensureColumn(sql, "refresh_records", "auth_time", "INTEGER");
    },
  },
  {
    version: "4",
    name: "operation-routing-facts",
    apply: (sql) => {
      ensureColumn(sql, "operation", "slug", "TEXT");
      ensureColumn(sql, "sites", "path", "TEXT");
    },
  },
  {
    version: "5",
    name: "team-status",
    apply: (sql) => ensureColumn(sql, "teams", "status", "TEXT NOT NULL DEFAULT 'active'"),
  },
  {
    version: "6",
    name: "display-short-name",
    apply: (sql) => {
      ensureColumn(sql, "operation", "short_name", "TEXT");
      ensureColumn(sql, "sites", "short_name", "TEXT");
    },
  },
];

export const initializeOperationSchema = (sql: SqlStorage): void => {
  initializeSchema(sql, {
    currentVersion: OPERATION_SCHEMA_VERSION,
    tables: TABLES,
    migrations: operationMigrations,
  });
};
