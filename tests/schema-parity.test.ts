// Guard 1 of plans/refactor.md phase 1 (reliability guards): schema/spec
// parity. Every coordinator table's declared columns equal its export/
// restore column list, and every table the DDL creates is either exported
// or on a recorded allowance.
//
// The guarded drift is the one that let `teams.status` need edits in two
// places: a column added to the CREATE TABLE but not to state.ts's spec
// silently loses data on restore (the export SELECT names its columns, so
// the other direction — a spec column missing from the schema — already
// fails loudly at runtime inside the export route). A whole table with no
// spec and no allowance exports nothing at all, which is the same hazard
// one level up.
//
// This is a source-text guard, like the docs fence: the DDL and the specs
// are plain declarations, and parsing the text someone edits is the point.
// The counter DO's table is out of scope; it is not a coordinator.
// The parser fails closed: a DDL line it cannot read is a problem, never a
// skip.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Tables a coordinator creates but deliberately does not export. A table
 * here has a recorded reason; anything else must carry its rows in
 * state.ts. */
const NOT_EXPORTED: Readonly<Record<"organization" | "operation", readonly string[]>> = {
  // `meta` holds the schema version marker, not state; restore re-applies it.
  organization: ["meta"],
  // `meta` as above; `org_actors` is a projection rebuilt from the
  // organizations — a snapshot that carried it would restore a stale roster
  // as authority (see state.ts).
  operation: ["meta", "org_actors"],
};

const TABLE_START = /CREATE TABLE IF NOT EXISTS (\w+)\s*\((.*)$/;
const CLOSING_LINE = /^\)/;
const TABLE_CONSTRAINT = /^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i;
const SPEC_LINE = /\{\s*name:\s*"(\w+)",\s*columns:\s*\[(.*?)\],\s*orderBy:/;

interface Table {
  readonly name: string;
  readonly columns: readonly string[];
}

/** Extract every CREATE TABLE's column names from a coordinator source
 * file. Lines inside a table that yield no column name are recorded as
 * problems; the parser never silently skips. */
const readDdl = (file: string, problems: string[]): Map<string, Table> => {
  const tables = new Map<string, Table>();
  const lines = readFileSync(join(root, file), "utf8").split(/\r?\n/);
  let current: { name: string; columns: string[] } | null = null;
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (current === null) {
      const match = TABLE_START.exec(raw);
      if (match === null) continue;
      const rest = match[2] ?? "";
      // A one-line CREATE TABLE closes its paren on the same line;
      // anything else is a multi-line body that ends on a later line.
      const oneLine = /^(.*)\)\s*["'`),;]*$/.exec(rest);
      if (oneLine !== null) {
        const parts = (oneLine[1] ?? "").split(",").map((part) => part.trim()).filter((part) => part.length > 0);
        const names: string[] = [];
        for (const part of parts) {
          const name = part.split(/\s+/)[0] ?? "";
          if (name.length === 0 || TABLE_CONSTRAINT.test(name)) {
            problems.push(`${file}:${index + 1}: unreadable column in one-line CREATE TABLE ${match[1]}`);
            continue;
          }
          names.push(name);
        }
        tables.set(match[1] ?? "", { name: match[1] ?? "", columns: names });
        continue;
      }
      current = { name: match[1] ?? "", columns: [] };
      const first = rest.trim();
      if (first.length > 0) {
        const name = first.split(/\s+/)[0] ?? "";
        if (name.length === 0 || TABLE_CONSTRAINT.test(name)) {
          if (name.length > 0) continue; // a table constraint opening the body
          problems.push(`${file}:${index + 1}: unreadable column in CREATE TABLE ${current.name}`);
        } else {
          current.columns.push(name);
        }
      }
      continue;
    }
    if (CLOSING_LINE.test(line)) {
      if (current.columns.length === 0) {
        problems.push(`${file}: CREATE TABLE ${current.name} parsed with no columns`);
      }
      tables.set(current.name, { name: current.name, columns: current.columns });
      current = null;
      continue;
    }
    const bare = line.replace(/,$/, "").trim();
    if (bare.length === 0) continue;
    const name = bare.split(/\s+/)[0] ?? "";
    if (name.length === 0 || TABLE_CONSTRAINT.test(name)) {
      if (name.length > 0) continue; // a table-level constraint line
      problems.push(`${file}:${index + 1}: unreadable column line in CREATE TABLE ${current.name}`);
      continue;
    }
    current.columns.push(name);
  }
  if (current !== null) problems.push(`${file}: CREATE TABLE ${current.name} never closed`);
  return tables;
};

/** Extract the export specs from state.ts, attributed to their coordinator
 * by the array they are declared in. */
const readSpecs = (problems: string[]): Record<"organization" | "operation", Map<string, readonly string[]>> => {
  const file = "packages/cloudflare/src/state.ts";
  const lines = readFileSync(join(root, file), "utf8").split(/\r?\n/);
  const specs: Record<"organization" | "operation", Map<string, readonly string[]>> = {
    organization: new Map(),
    operation: new Map(),
  };
  let owner: "organization" | "operation" | null = null;
  for (const [index, line] of lines.entries()) {
    if (/export const organizationTables/.test(line)) owner = "organization";
    else if (/export const operationTables/.test(line)) owner = "operation";
    else if (/^\];/.test(line.trim()) && owner !== null) owner = null;
    if (owner === null) continue;
    const match = SPEC_LINE.exec(line);
    if (match === null) {
      if (!/^\s*(\/\/|\/\*|\*)/.test(line) && line.trim().length > 0 && !/readonly TableSpec\[\]/.test(line)) {
        problems.push(`${file}:${index + 1}: unreadable spec line in ${owner}Tables`);
      }
      continue;
    }
    const columns = [...(match[2] ?? "").matchAll(/"([^"]+)"/g)].map((column) => column[1] ?? "");
    specs[owner].set(match[1] ?? "", columns);
  }
  return specs;
};

test("every coordinator table's schema equals its export spec", () => {
  const problems: string[] = [];
  const files = {
    organization: "packages/cloudflare/src/organization.ts",
    operation: "packages/cloudflare/src/operation.ts",
  } as const;
  const specs = readSpecs(problems);

  for (const coordinator of ["organization", "operation"] as const) {
    const ddl = readDdl(files[coordinator], problems);
    // Parser sanity: a reformat that hides the DDL from this guard must
    // fail it, not pass vacuously.
    const minimum = coordinator === "organization" ? 9 : 11;
    if (ddl.size < minimum) {
      problems.push(`${files[coordinator]}: expected at least ${minimum} tables, parsed ${ddl.size}`);
    }

    for (const [name, columns] of specs[coordinator]) {
      const table = ddl.get(name);
      if (table === undefined) {
        problems.push(`${coordinator}: export spec names table ${name}, which the DDL never creates`);
        continue;
      }
      for (const column of columns) {
        if (!table.columns.includes(column)) {
          problems.push(`${coordinator}.${name}: spec exports column ${column}, which the schema does not declare`);
        }
      }
      for (const column of table.columns) {
        if (!columns.includes(column)) {
          problems.push(
            `${coordinator}.${name}: schema declares column ${column}, which the export spec omits — restore drops it silently`,
          );
        }
      }
    }

    for (const name of ddl.keys()) {
      if (specs[coordinator].has(name)) continue;
      if ((NOT_EXPORTED[coordinator] ?? []).includes(name)) continue;
      problems.push(
        `${coordinator}: table ${name} is created but neither exported nor on the NOT_EXPORTED allowance`,
      );
    }
  }

  const expectedTables = { organization: 9, operation: 11 };
  for (const coordinator of ["organization", "operation"] as const) {
    if (specs[coordinator].size !== expectedTables[coordinator]) {
      problems.push(
        `state.ts: ${coordinator}Tables parsed ${specs[coordinator].size} specs, expected ${expectedTables[coordinator]} — did a table change without this guard?`,
      );
    }
  }

  assert.deepEqual(problems, [], problems.join("\n"));
});
