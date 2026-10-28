// The public conformance inventory. The inventory is the specification; this
// file only runs it against the in-memory world and reports every failure
// with its id.

import test from "node:test";
import assert from "node:assert/strict";

import { CONFORMANCE_CASES, runConformance } from "../src/conformance.ts";

// The published inventory: adding, removing, or renaming a case is a spec
// change, so the list is pinned here as well as in the runner.
const EXPECTED_IDS = [
  "OH-MODEL-01",
  "OH-MODEL-02",
  "OH-MODEL-03",
  "OH-MODEL-04",
  "OH-MODEL-05",
  "OH-MODEL-06",
  "OH-MODEL-07",
  "OH-MODEL-08",
  "OH-MODEL-09",
  "OH-MODEL-10",
  "OH-MODEL-11",
  "OH-MODEL-12",
  "OH-AUTH-01",
  "OH-AUTH-02",
  "OH-AUTH-03",
  "OH-AUTH-04",
  "OH-AUTH-05",
  "OH-AUTH-06",
  "OH-AUTH-07",
  "OH-ACT-01",
  "OH-ACT-02",
  "OH-ACT-03",
  "OH-ACT-04",
  "OH-PART-01",
  "OH-PART-02",
  "OH-CMD-01",
  "OH-CMD-03",
  "OH-CMD-04",
  "OH-CMD-02",
  "OH-ACCESS-01",
  "OH-ACCESS-02",
  "OH-ACCESS-03",
  "OH-ACCESS-04",
] as const;

test("the conformance inventory has stable, unique ids", () => {
  const ids = CONFORMANCE_CASES.map((conformanceCase) => conformanceCase.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate conformance id");
  for (const id of ids) assert.match(id, /^OH-[A-Z]+-\d{2}$/);
  assert.deepEqual(ids, EXPECTED_IDS, "the inventory id set is the published list");
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
