// The public conformance inventory. The inventory is the specification; this
// file only runs it against the in-memory world and reports every failure
// with its id.

import test from "node:test";
import assert from "node:assert/strict";

import { CONFORMANCE_CASES, runConformance } from "../src/conformance.ts";

test("the conformance inventory has stable, unique ids", () => {
  const ids = CONFORMANCE_CASES.map((conformanceCase) => conformanceCase.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate conformance id");
  for (const id of ids) assert.match(id, /^OH-[A-Z]+-\d{2}$/);
});

test("every conformance case passes against the in-memory authority", async () => {
  const results = await runConformance();
  const failures = results.filter((result) => !result.ok);
  assert.deepEqual(
    failures.map((failure) => `${failure.id} ${failure.title}: ${failure.error ?? "failed"}`),
    [],
  );
  assert.equal(results.length, CONFORMANCE_CASES.length);
});
