// Shared discovery for the spec-witness gate (`tests/specs.test.ts`) and the
// suite selector (`bin/spec-suite`): the spec headings in `specs/`, the
// executable blocks, the tagged test titles across both test trees, and the
// tier→trait model that turns a witness into a suite selection. One module
// keeps the gate's index and the selector's file lists from drifting apart.
//
// Traits are fuzzy selectors, not exclusive folders: a witness may carry
// several, and a file appears in every suite one of its witnesses selects.
// Portable blocks declare their traits in the fence info string; everything
// else derives them from its tier, which comes from location. "portable" is
// the ring a block runs in, not a trait a suite selects.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { SUPPLEMENTARY_WITNESSES, type SpecId, type Tier } from "./spec-witnesses.ts";

export type { SpecId, Tier };

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SPECS = join(ROOT, "specs");
const TESTS = join(ROOT, "tests");
const WORKERD_TESTS = join(ROOT, "packages", "cloudflare", "test");

export interface SpecEntry {
  readonly id: SpecId;
  readonly title: string;
  readonly file: string;
}

export interface SpecBlock {
  readonly id: SpecId;
  readonly file: string;
  readonly line: number;
  readonly traits: readonly string[];
  readonly code: string;
}

export interface TaggedTitle {
  readonly file: string;
  readonly title: string;
  readonly tags: readonly SpecId[];
}

export type Trait = "unit" | "smoke" | "integration" | "concurrency" | "static" | "review";

export type SuiteName = "unit" | "smoke" | "integration" | "static";

export const TRAITS = new Set(["portable", "unit", "smoke", "integration", "concurrency", "static", "review"]);

const TEST_TITLE = /\b(?:test|it)\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`([^`]*)`)/g;
const TAG = /\[([AEP]\d+)\]/g;
const SPEC_BLOCK = /^```[^\n]*\bspec=([AEP]\d+)\b([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm;

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

export const readSpecs = (): {
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

// The workerd suites are split in the plan; the selector needs only the
// ring, and these are the two boundaries a tagged witness can come from today.
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

export const tierOf = (file: string): Tier => {
  if (file.startsWith("packages/cloudflare/test/")) return WORKERD_TIERS[file] ?? "I2";
  if (/^tests\/spec-.*\.test\.ts$/.test(file)) return "P";
  if (STATIC_TEST_FILES.has(file)) return "X";
  return "S";
};

// Traits by tier: P files are portable unit witnesses, S files are the
// in-memory smoke lane, workerd files are integration (I3 the adversarial
// concurrency pass), the tool files are static, and review documents review.
export const TIER_TRAITS: Readonly<Record<Tier, readonly Trait[]>> = {
  P: ["unit"],
  S: ["smoke"],
  I1: ["integration"],
  I2: ["integration"],
  I3: ["concurrency"],
  X: ["static"],
  R: ["review"],
};

export const taggedTitles = (): readonly TaggedTitle[] => {
  const titles: TaggedTitle[] = [];
  for (const file of [...walk(TESTS), ...walk(WORKERD_TESTS)].filter((path) => path.endsWith(".test.ts"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(TEST_TITLE)) {
      const text = match[1] ?? match[2] ?? match[3] ?? "";
      const tags = [...text.matchAll(TAG)].map((tag) => tag[1] as SpecId);
      if (tags.length > 0) titles.push({ file: rel(file), title: text, tags });
    }
  }
  return titles;
};

// The suites are views over traits, per plans/spec_testing.md:
// unit — unit witnesses; smoke — unit, smoke, and portable executable
// blocks; integration — integration and concurrency; static — static and
// review. They are focused loops, not rings: `pnpm check` and
// `pnpm check:cloudflare` remain the gates.
export const SPEC_SUITES: Readonly<Record<SuiteName, readonly Trait[]>> = {
  unit: ["unit"],
  smoke: ["unit", "smoke"],
  integration: ["integration", "concurrency"],
  static: ["static", "review"],
};

export interface SuiteSelection {
  /** The runner the selected files share; a mix fails closed. */
  readonly runner: "node" | "vitest";
  /** Repo-relative test files the suite runs, sorted. */
  readonly files: readonly string[];
  /** Selections the suite names but does not run, with the reason. */
  readonly notes: readonly string[];
}

export const suiteSelection = (name: SuiteName): SuiteSelection => {
  const wanted = SPEC_SUITES[name];
  const wants = (trait: Trait): boolean => wanted.includes(trait);
  const files = new Set<string>();
  const notes: string[] = [];

  for (const { file } of taggedTitles()) {
    if (TIER_TRAITS[tierOf(file)].some(wants)) files.add(file);
  }

  const { blocks } = readSpecs();
  for (const block of blocks) {
    const traits = block.traits.filter((trait) => trait !== "portable") as Trait[];
    if (!traits.some(wants)) continue;
    if (block.traits.includes("portable")) {
      // The gate file is the executor of portable blocks.
      files.add("tests/specs.test.ts");
    } else {
      notes.push(`${block.file}:${block.line}: block ${block.id} is ${traits.join(",")}; no runner yet`);
    }
  }

  const testFileInCommand = /((?:tests|packages\/cloudflare\/test)\/[A-Za-z0-9._-]+\.test\.ts)/;
  for (const witness of SUPPLEMENTARY_WITNESSES) {
    if (witness.kind === "conformance") {
      // The public inventory runs in the portable conformance suite.
      if (wants("smoke")) files.add("tests/conformance.test.ts");
    } else if (witness.kind === "static") {
      if (!wants("static")) continue;
      const commandFile = testFileInCommand.exec(witness.command)?.[1];
      if (commandFile !== undefined) files.add(commandFile);
      else notes.push(`${witness.id}: ${witness.command}`);
    } else if (wants("review")) {
      notes.push(`${witness.id}: reviewed in ${witness.document}`);
    }
  }

  const sorted = [...files].sort();
  const runners = new Set(sorted.map((file) => (file.startsWith("packages/cloudflare/") ? "vitest" : "node")));
  if (runners.size > 1) {
    throw new Error(`suite ${name} mixes node and vitest files: ${sorted.join(", ")}`);
  }
  if (sorted.length === 0) throw new Error(`suite ${name} selects no files`);
  return { runner: runners.values().next().value ?? "node", files: sorted, notes };
};
