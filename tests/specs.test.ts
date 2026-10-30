// The spec witness gate. It is the test-side index over `specs/`: every
// `A#`, `E#`, and `P#` heading needs at least one witness, and every witness
// must name a spec that still exists. The suites themselves remain the proof;
// this gate makes an orphaned invariant or a stale tag fail loudly.
//
// Run with `SPEC_REPORT=1 node --test tests/specs.test.ts` to print the
// matrix on success.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { CONFORMANCE_CASES } from "../src/conformance.ts";
import { createSpecHarness, type SpecHarness } from "./spec-runtime.ts";
import {
  INTEGRATION_ONLY,
  SUPPLEMENTARY_WITNESSES,
  type SpecId,
  type Tier,
} from "./spec-witnesses.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SPECS = join(ROOT, "specs");
const TESTS = join(ROOT, "tests");
const WORKERD_TESTS = join(ROOT, "packages", "cloudflare", "test");

interface SpecEntry {
  readonly id: SpecId;
  readonly title: string;
  readonly file: string;
}

interface SpecBlock {
  readonly id: SpecId;
  readonly file: string;
  readonly line: number;
  readonly traits: readonly string[];
  readonly code: string;
}

interface Witness {
  readonly id: SpecId;
  readonly kind: "test" | "block" | "conformance" | "static" | "review";
  readonly tier: Tier;
  readonly label: string;
  readonly executed?: boolean;
}

const rel = (path: string): string => relative(ROOT, path).split(sep).join("/");

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
};

const readSpecs = (): {
  entries: Map<SpecId, SpecEntry>;
  blocks: SpecBlock[];
  problems: string[];
} => {
  const entries = new Map<SpecId, SpecEntry>();
  const blocks: SpecBlock[] = [];
  const problems: string[] = [];
  for (const name of readdirSync(SPECS).filter((entry) => entry.endsWith(".md")).sort()) {
    const file = `specs/${name}`;
    const source = readFileSync(join(SPECS, name), "utf8");
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.startsWith("### ")) return;
      const match = /^### ([AEP]\d+)\s+—\s+(.+)$/.exec(line);
      if (match === null) {
        problems.push(`${file}:${index + 1}: unparseable spec heading`);
        return;
      }
      const id = match[1] as SpecId;
      if (entries.has(id)) {
        problems.push(`${file}:${index + 1}: duplicate spec id ${id}`);
        return;
      }
      entries.set(id, { id, title: match[2] ?? "", file });
    });
    for (const match of source.matchAll(SPEC_BLOCK)) {
      const id = match[1] as SpecId;
      const info = match[2] ?? "";
      const traits = (/(?:^|\s)traits=([^\s]+)/.exec(info)?.[1] ?? "")
        .split(",")
        .filter((trait) => trait.length > 0);
      blocks.push({
        id,
        file,
        line: source.slice(0, match.index ?? 0).split("\n").length,
        traits,
        code: match[3] ?? "",
      });
    }
  }
  return { entries, blocks, problems };
};

const TEST_TITLE = /\b(?:test|it)\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`([^`]*)`)/g;
const TAG = /\[([AEP]\d+)\]/g;
const SPEC_BLOCK = /^```[^\n]*\bspec=([AEP]\d+)\b([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm;
const TRAITS = new Set(["portable", "unit", "smoke", "integration", "concurrency", "static", "review"]);

const STATIC_TEST_FILES = new Set([
  "tests/docs.test.ts",
  "tests/types.test.ts",
  "tests/release-tools.test.ts",
  "tests/artifact-check.test.ts",
  "tests/ci-run.test.ts",
  "tests/gate-cache.test.ts",
  "tests/tooling-policy.test.ts",
  "tests/git-guards.test.ts",
]);

// The workerd suites are split in the plan; the gate needs only the ring, and
// these are the two boundaries a tagged witness can come from today.
const WORKERD_TIERS: Readonly<Record<string, Tier>> = {
  "packages/cloudflare/test/operation.test.ts": "I2",
  "packages/cloudflare/test/organization.test.ts": "I1",
  "packages/cloudflare/test/ops.test.ts": "I2",
  "packages/cloudflare/test/keys.test.ts": "I1",
  "packages/cloudflare/test/exchange.test.ts": "I1",
  "packages/cloudflare/test/exchange-devidp.test.ts": "I1",
  "packages/cloudflare/test/roster.test.ts": "I2",
  "packages/cloudflare/test/runtime.test.ts": "I2",
  "packages/cloudflare/test/context.test.ts": "I2",
  "packages/cloudflare/test/conformance.test.ts": "I2",
  "packages/cloudflare/test/binding-smoke.test.ts": "I2",
};

const tierOf = (file: string): Tier => {
  if (file.startsWith("packages/cloudflare/test/")) return WORKERD_TIERS[file] ?? "I2";
  if (/^tests\/spec-.*\.test\.ts$/.test(file)) return "P";
  if (STATIC_TEST_FILES.has(file)) return "X";
  return "S";
};

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
  for (const file of [...walk(TESTS), ...walk(WORKERD_TESTS)].filter((path) => path.endsWith(".test.ts"))) {
    const relFile = rel(file);
    const source = readFileSync(file, "utf8");
    for (const title of source.matchAll(TEST_TITLE)) {
      const text = title[1] ?? title[2] ?? title[3] ?? "";
      const tags = new Set([...text.matchAll(TAG)].map((match) => match[1] as SpecId));
      for (const id of tags) {
        if (!specs.has(id)) problems.push(`${relFile}: test tag ${id} names no spec: ${text}`);
        add({ id, kind: "test", tier: tierOf(relFile), label: `${relFile}: ${text}` });
      }
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
  // two claims that are reviewed rather than executed.
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
