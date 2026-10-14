// A thin adapter over Node's built-in SQLite (node:sqlite). No dependencies.
//
// This is the only place a driver is spoken to. The core and the port import
// nothing from here.

import { DatabaseSync } from "node:sqlite";

export type SqlValue = string | number | bigint | null;

export class Db {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  all<T>(sql: string, ...params: SqlValue[]): T[] {
    return this.db.prepare(sql).all(...params) as unknown as T[];
  }

  get<T>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as unknown as T | undefined;
  }

  run(sql: string, ...params: SqlValue[]): void {
    this.db.prepare(sql).run(...params);
  }

  close(): void {
    this.db.close();
  }

  // The planner's own account of how it found the rows, for the checks in the
  // examples. Not part of the package's contract.
  plan(sql: string): string {
    return this.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
      .map((r) => r.detail)
      .join(" | ");
  }
}
