// Shared schema application. The coordinators own use cases; this module owns
// the DDL and the additive migration chain, so a table or column change has
// one home and a named step a test can exercise.

export interface SchemaMigration {
  /** The schema version this step produces. */
  readonly version: string;
  /** A stable name for the change; tests pin the chain by name and version. */
  readonly name: string;
  apply(sql: SqlStorage): void;
}

export interface SchemaDefinition {
  readonly currentVersion: string;
  /** Current table declarations. `IF NOT EXISTS` leaves an older object's
   * tables in place; the migrations below fill the columns it lacks. */
  readonly tables: readonly string[];
  readonly migrations: readonly SchemaMigration[];
}

const columnsOf = (sql: SqlStorage, table: string): Set<string> =>
  new Set(
    sql.exec<{ readonly name: string }>(`PRAGMA table_info(${table})`)
      .toArray()
      .map((row) => String(row.name)),
  );

/** Add a column only when an older object lacks it. A fresh object already
 * has the current declaration, so this is a no-op there. */
export const ensureColumn = (
  sql: SqlStorage,
  table: string,
  column: string,
  definition: string,
): void => {
  if (columnsOf(sql, table).has(column)) return;
  sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};

/** Apply the current table declarations, then every named migration, then
 * stamp the stored version. Migrations are additive and idempotent: the
 * constructor runs on every object start. */
export const initializeSchema = (sql: SqlStorage, definition: SchemaDefinition): void => {
  sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  for (const table of definition.tables) sql.exec(table);
  for (const migration of definition.migrations) migration.apply(sql);
  // INSERT OR IGNORE keeps an object's recorded version until the final
  // UPDATE; the update is what makes an older object report the current
  // schema after the additive steps above have run.
  sql.exec(
    "INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)",
    definition.currentVersion,
  );
  sql.exec("UPDATE meta SET value = ? WHERE key = 'schema_version'", definition.currentVersion);
};
