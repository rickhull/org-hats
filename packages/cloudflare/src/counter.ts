import { DurableObject } from "cloudflare:workers";

/** The T6.1 harness object: one SQLite-backed Durable Object, one durable
 * count. It proves storage survives across requests; the authority
 * coordinators replace it in T6.2–T6.3. */
export class Counter extends DurableObject {
  async increment(): Promise<number> {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY CHECK (id = 1), value INTEGER NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO counter (id, value) VALUES (1, 0) ON CONFLICT(id) DO NOTHING",
    );
    this.ctx.storage.sql.exec("UPDATE counter SET value = value + 1 WHERE id = 1");
    const row = this.ctx.storage.sql.exec("SELECT value FROM counter WHERE id = 1").one();
    return Number(row["value"]);
  }
}
