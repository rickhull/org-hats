// The documentation fence: docs, inventory, and fixtures reinforce one
// another mechanically, so a story cannot drift from what ships.
//
//   docs → inventory  — every OH-* id cited in any doc names a case that
//                       exists in CONFORMANCE_CASES.
//   inventory → docs  — every case has a row in docs/inventory.md with its
//                       title verbatim; a removed case leaves a stale row
//                       that fails here.
//   docs → fixtures   — every twin id cited in the story docs (tutorial,
//                       walkthrough) exists in a shipped twin snapshot, so
//                       Dana's story stays true as the fixtures evolve.
//   links             — every relative link in the READMEs and docs/,
//                       including heading anchors, resolves.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

import { CONFORMANCE_CASES } from "../src/conformance.ts";
import { AIRLIFT, FESTIVAL, PROFESSIONAL_OPERATION } from "../src/authority/twins.ts";

const storyDocs = ["docs/tutorial.md", "docs/walkthrough.md"] as const;

const read = (path: string): string => readFileSync(path, "utf8");

const docFiles = (): readonly string[] => [
  "README.md",
  "AGENTS.md",
  "SECURITY.md",
  "tests/README.md",
  ...readdirSync("docs")
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/${name}`),
];

const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile();

// GitHub-style heading slug: lowercase, drop punctuation, spaces to hyphens.
const anchorsOf = (text: string): ReadonlySet<string> => {
  const slugs = new Set<string>();
  for (const heading of text.matchAll(/^#+\s+(.+?)\s*$/gm)) {
    slugs.add(
      heading[1]!
        .toLowerCase()
        .replace(/[^a-z0-9\- ]/g, "")
        .trim()
        .replace(/ /g, "-"),
    );
  }
  return slugs;
};

test("every relative link in the READMEs and docs resolves, anchors included", () => {
  for (const file of docFiles()) {
    for (const match of read(file).matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1]!.split(/\s/)[0]!;
      if (/^(https?:|mailto:)/.test(target)) continue;
      // A directory link (e.g. ../specs/) resolves by existing; only a
      // fragment-bearing link needs a file and its headings.
      const [path = "", fragment] = target.split("#");
      const anchorHost = path === "" ? file : normalize(join(dirname(file), path));
      assert.ok(existsSync(anchorHost), `${file} links to a missing path: ${target}`);
      if (fragment === undefined) continue;
      assert.ok(isFile(anchorHost), `${file} anchors into a non-file: ${target}`);
      assert.ok(
        anchorsOf(read(anchorHost)).has(fragment),
        `${file} links to a missing anchor: ${target}`,
      );
    }
  }
});

test("every conformance id cited in the docs names a case that ships", () => {
  const ids = new Set(CONFORMANCE_CASES.map((conformanceCase) => conformanceCase.id));
  for (const file of docFiles()) {
    // Migration notes are the documented exception to "docs describe the
    // working system": their subject is the transition, and the v0.4
    // `OH-QM-*` ids they contrast against are frozen with their tags.
    if (file.startsWith("docs/migration-")) continue;
    for (const match of read(file).matchAll(/\bOH-[A-Z]+-\d{2}\b/g)) {
      assert.ok(ids.has(match[0]), `${file} cites ${match[0]}, which is not in the inventory`);
    }
  }
});

test("every shipped case has an inventory row with its title verbatim", () => {
  const rows = new Map<string, string>();
  for (const line of read("docs/inventory.md").split("\n")) {
    if (!line.startsWith("| OH-")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    rows.set(cells[1]!, cells[2]!);
  }
  assert.equal(rows.size, CONFORMANCE_CASES.length, "one row per case, no more, no fewer");
  for (const conformanceCase of CONFORMANCE_CASES) {
    assert.ok(rows.has(conformanceCase.id), `${conformanceCase.id} has no row in docs/inventory.md`);
    assert.equal(
      rows.get(conformanceCase.id),
      conformanceCase.title,
      `${conformanceCase.id}'s inventory title must match the shipped title verbatim`,
    );
  }
});

test("every twin id cited in the story docs exists in a shipped twin", () => {
  const known = new Set<string>();
  for (const twin of [PROFESSIONAL_OPERATION, FESTIVAL, AIRLIFT]) {
    const snapshot = twin.snapshot;
    for (const operation of snapshot.operations) known.add(operation.operationId);
    for (const site of snapshot.sites) known.add(site.siteId);
    for (const team of snapshot.teams) known.add(team.teamId);
    for (const organization of snapshot.organizations) known.add(organization.organizationId);
    for (const actor of snapshot.actors) known.add(actor.actorId);
    for (const grant of snapshot.grants) known.add(grant.grantId);
  }
  const cited = /\b(?:op|site|team|org|actor)-[0-9a-f]{6,}\b|\bg-(?:mer|fest)-\d+\b/g;
  for (const file of storyDocs) {
    for (const match of read(file).matchAll(cited)) {
      assert.ok(
        known.has(match[0]),
        `${file} cites ${match[0]}, which is not an id of any shipped twin`,
      );
    }
  }
});
