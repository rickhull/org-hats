// A thin adapter over Node's built-in SQLite (node:sqlite). No dependencies.
//
// This is the only place a driver is spoken to. The core and the port import
// nothing from here.
import { DatabaseSync } from "node:sqlite";
export class Db {
    db;
    constructor(path) {
        this.db = new DatabaseSync(path);
        this.db.exec("PRAGMA foreign_keys = ON;");
    }
    exec(sql) {
        this.db.exec(sql);
    }
    all(sql, ...params) {
        return this.db.prepare(sql).all(...params);
    }
    get(sql, ...params) {
        return this.db.prepare(sql).get(...params);
    }
    run(sql, ...params) {
        this.db.prepare(sql).run(...params);
    }
    close() {
        this.db.close();
    }
    // The planner's own account of how it found the rows, for the checks in the
    // examples. Not part of the package's contract.
    plan(sql) {
        return this.all(`EXPLAIN QUERY PLAN ${sql}`)
            .map((r) => r.detail)
            .join(" | ");
    }
}
