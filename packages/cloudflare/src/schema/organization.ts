// The organization coordinator's schema and additive migration chain.

import { ensureColumn, initializeSchema, type SchemaMigration } from "./sql";

export const ORGANIZATION_SCHEMA_VERSION = "6";

const ACTIVATION_REQUESTS = `CREATE TABLE IF NOT EXISTS activation_requests (
  request_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  revoked_at INTEGER,
  webauthn_challenge TEXT
)`;

const TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS organization (
    organization_id TEXT PRIMARY KEY,
    display_name TEXT,
    short_name TEXT,
    sealed_idp_config TEXT,
    sealed_idp_config_updated_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS actors (
    actor_id TEXT PRIMARY KEY,
    display_name TEXT,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS principal_links (
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (provider, subject)
  )`,
  "CREATE TABLE IF NOT EXISTS org_admins (actor_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)",
  `CREATE TABLE IF NOT EXISTS invitations (
    invitation_id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
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
  `CREATE TABLE IF NOT EXISTS credentials (
    credential_id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    alg TEXT NOT NULL,
    key_json TEXT NOT NULL,
    sign_count INTEGER NOT NULL,
    backup_eligible INTEGER NOT NULL,
    backed_up INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS webauthn_assertion_challenges (
    challenge TEXT PRIMARY KEY,
    rp_id TEXT NOT NULL,
    origin TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER
  )`,
];

export const organizationMigrations: readonly SchemaMigration[] = [
  {
    version: "2",
    name: "activation-requests",
    apply: (sql) => sql.exec(ACTIVATION_REQUESTS),
  },
  {
    version: "3",
    name: "display-short-name",
    apply: (sql) => ensureColumn(sql, "organization", "short_name", "TEXT"),
  },
  {
    version: "4",
    name: "credentials",
    apply: (sql) => sql.exec(
      `CREATE TABLE IF NOT EXISTS credentials (
        credential_id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        alg TEXT NOT NULL,
        key_json TEXT NOT NULL,
        sign_count INTEGER NOT NULL,
        backup_eligible INTEGER NOT NULL,
        backed_up INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ),
  },
  {
    version: "5",
    name: "webauthn-challenge",
    apply: (sql) => ensureColumn(sql, "activation_requests", "webauthn_challenge", "TEXT"),
  },
  {
    version: "6",
    name: "webauthn-assertion-challenges",
    apply: (sql) => sql.exec(
      `CREATE TABLE IF NOT EXISTS webauthn_assertion_challenges (
        challenge TEXT PRIMARY KEY,
        rp_id TEXT NOT NULL,
        origin TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      )`,
    ),
  },
];

export const initializeOrganizationSchema = (sql: SqlStorage): void => {
  initializeSchema(sql, {
    currentVersion: ORGANIZATION_SCHEMA_VERSION,
    tables: TABLES,
    migrations: organizationMigrations,
  });
};
