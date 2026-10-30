// The spec witness gate. It is the test-side index over `specs/`: every
// `A#`, `E#`, and `P#` heading needs at least one witness, and every witness
// must name a spec that still exists. The suites themselves remain the proof;
// this gate makes an orphaned invariant or a stale tag fail loudly.
//
// Run with `SPEC_REPORT=1 node --test tests/specs.test.ts` to print the
// matrix on success. Discovery lives in `tests/spec-index.ts`, shared with
// `bin/spec-suite`, so the index and the suite selectors cannot drift.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CONFORMANCE_CASES } from "../src/conformance.ts";
import { createSpecHarness, type SpecHarness } from "./spec-runtime.ts";
import {
  readSpecs,
  SPEC_SUITES,
  suiteSelection,
  taggedTitles,
  tierOf,
  TRAITS,
  type SpecId,
  type SuiteName,
  type Tier,
} from "./spec-index.ts";
import { INTEGRATION_ONLY, SUPPLEMENTARY_WITNESSES } from "./spec-witnesses.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

interface Witness {
  readonly id: SpecId;
  readonly kind: "test" | "block" | "conformance" | "static" | "review";
  readonly tier: Tier;
  readonly label: string;
  readonly executed?: boolean;
}

test("every spec has a witness and every witness names a spec", async () => {
  const { entries: specs, blocks, problems: specProblems } = readSpecs();
  const problems = [...specProblems];
  const byId = new Map<SpecId, Witness[]>();
  const add = (witness: Witness): void => {
    const list = byId.get(witness.id) ?? [];
    list.push(witness);
    byId.set(witness.id, list);
  };

  // Tagged test titles are the primary witnesses.
  for (const { file, title, tags } of taggedTitles()) {
    for (const id of tags) {
      if (!specs.has(id)) problems.push(`${file}: test tag ${id} names no spec: ${title}`);
      add({ id, kind: "test", tier: tierOf(file), label: `${file}: ${title}` });
    }
  }

  // Executable blocks are stronger than tags when they are portable. An
  // integration block is recorded but not run here; it must not be reported
  // as executable until the workerd runner exists.
  for (const block of blocks) {
    const where = `${block.file}:${block.line}`;
    if (!specs.has(block.id)) problems.push(`${where}: spec block names no spec: ${block.id}`);
    if (block.traits.length === 0) problems.push(`${where}: spec block ${block.id} has no traits`);
    const unknownTraits = block.traits.filter((trait) => !TRAITS.has(trait));
    if (unknownTraits.length > 0) {
      problems.push(`${where}: spec block ${block.id} has unknown traits: ${unknownTraits.join(", ")}`);
    }
    const integration = block.traits.includes("integration") || block.traits.includes("concurrency");
    const portable = block.traits.includes("portable");
    if (portable && integration) problems.push(`${where}: spec block ${block.id} is both portable and integration`);
    if (!portable && !integration) {
      problems.push(`${where}: spec block ${block.id} needs a portable or integration trait`);
    }
    const shouldRun = portable && !integration;
    let executed = false;
    if (shouldRun) {
      try {
        const harness = await createSpecHarness();
        const run = new Function("spec", `return (async () => {\n${block.code}\n})();`) as (
          spec: SpecHarness,
        ) => Promise<unknown>;
        await run(harness);
        executed = true;
      } catch (error) {
        problems.push(`${where}: spec block ${block.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    add({
      id: block.id,
      kind: "block",
      tier: shouldRun ? "P" : "I2",
      label: `${where}: spec=${block.id} traits=${block.traits.join(",")}${executed ? " (executed)" : ""}`,
      executed,
    });
  }

  // Supplementary witnesses cover conformance cases, static gates, and the
  // two claims that are reviewed rather than executed
  const cases = new Set(CONFORMANCE_CASES.map((entry) => entry.id));
  for (const witness of SUPPLEMENTARY_WITNESSES) {
    if (!specs.has(witness.id)) {
      problems.push(`supplementary witness ${witness.id} names no spec`);
    }
    if (witness.kind === "conformance") {
      if (!cases.has(witness.caseId)) {
        problems.push(`${witness.id}: conformance case ${witness.caseId} is not in the inventory`);
      }
      add({ id: witness.id, kind: "conformance", tier: "S", label: witness.caseId });
    } else if (witness.kind === "static") {
      if (!existsSync(join(ROOT, witness.path))) {
        problems.push(`${witness.id}: static witness path is missing: ${witness.path}`);
      }
      add({ id: witness.id, kind: "static", tier: "X", label: `${witness.command} (${witness.path})` });
    } else {
      if (!existsSync(join(ROOT, witness.document))) {
        problems.push(`${witness.id}: review witness document is missing: ${witness.document}`);
      }
      add({ id: witness.id, kind: "review", tier: "R", label: witness.document });
    }
  }

  // An integration-only id must say why, and a reason cannot outlive the
  // integration-only state it describes.
  const integrationOnly = new Set<SpecId>();
  for (const entry of INTEGRATION_ONLY) {
    if (integrationOnly.has(entry.id)) problems.push(`${entry.id}: duplicate integrationOnly entry`);
    integrationOnly.add(entry.id);
    if (!specs.has(entry.id)) problems.push(`${entry.id}: integrationOnly names no spec`);
    const list = byId.get(entry.id) ?? [];
    if (list.length === 0) problems.push(`${entry.id}: integrationOnly has no witness`);
    if (list.some((witness) => !witness.tier.startsWith("I"))) {
      problems.push(`${entry.id}: integrationOnly has a portable, static, or review witness`);
    }
  }

  for (const [id, list] of byId) {
    if (!specs.has(id)) continue;
    if (list.length === 0) problems.push(`${id}: no witness`);
    if (list.length > 0 && list.every((witness) => witness.tier.startsWith("I")) && !integrationOnly.has(id)) {
      problems.push(`${id}: only integration witnesses; add a reason to INTEGRATION_ONLY or a cheaper witness`);
    }
  }

  for (const id of specs.keys()) {
    if (!byId.has(id)) problems.push(`${id}: no witness`);
  }

  const report = [...specs.keys()]
    .map((id) => {
      const list = byId.get(id) ?? [];
      const tiers = [...new Set(list.map((witness) => witness.tier))].sort().join(",");
      const labels = list.map((witness) => `${witness.tier}:${witness.kind}:${witness.label}`).join(" | ");
      return `${id}\t${tiers || "-"}\t${labels || "UNWITNESSED"}`;
    })
    .join("\n");
  if (process.env.SPEC_REPORT === "1" || problems.length > 0) {
    console.log(`spec\twitness tiers\twitnesses\n${report}`);
  }

  assert.deepEqual(problems, [], problems.join("\n"));
});

test("every spec suite resolves to files that exist", () => {
  // The selectors are views, not rings, but a view that points at a missing
  // file is stale. `suiteSelection` fails closed on an empty or mixed-runner
  // selection; this test adds the existence check.
  for (const [name] of Object.entries(SPEC_SUITES) as readonly [SuiteName, ...unknown[]][]) {
    const selection = suiteSelection(name);
    assert.ok(selection.files.length > 0, `${name} selects nothing`);
    for (const file of selection.files) {
      assert.ok(existsSync(join(ROOT, file)), `suite ${name} selects a missing file: ${file}`);
      const underWorkerd = file.startsWith("packages/cloudflare/");
      assert.equal(
        underWorkerd ? "vitest" : "node",
        selection.runner,
        `suite ${name} mislabels the runner for ${file}`,
      );
    }
  }
});
