// The portable gates must reject a checkout before they can report a partial
// success. Each fixture has all later check inputs but deliberately lacks tsc.

import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const fixture = (): string => {
  const root = mkdtempSync(join(tmpdir(), "org-hats-tooling-"));
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "dist"));
  mkdirSync(join(root, "tests"));
  mkdirSync(join(root, "examples"));

  for (const name of ["check", "check-dist"]) {
    const target = join(root, "bin", name);
    copyFileSync(join(projectRoot, "bin", name), target);
    chmodSync(target, 0o755);
  }
  writeFileSync(join(root, "bin", "check-version"), "#!/usr/bin/env sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(root, "tests", "passes.test.ts"), 'import test from "node:test";\ntest("fixture", () => {});\n');
  for (const name of ["pilot.ts", "own-world.ts", "consumer-access.ts"]) {
    writeFileSync(join(root, "examples", name), "");
  }
  return root;
};

test("portable gates fail closed when compiler tooling is absent", () => {
  const root = fixture();
  try {
    for (const name of ["check", "check-dist"]) {
      const result = spawnSync(join(root, "bin", name), [], { cwd: root, encoding: "utf8" });
      assert.notEqual(result.status, 0, `${name} accepted a checkout without tsc:\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr ?? "", /tsc is required/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const filesUnder = (path: string): readonly string[] =>
  readdirSync(path).flatMap((name) => {
    const entry = join(path, name);
    return statSync(entry).isDirectory() ? filesUnder(entry) : [entry];
  });

test("operational scripts never use rg's short replacement flag", () => {
  const files = ["bin", "ci", ".githooks", "tests", "examples"].flatMap((directory) => filesUnder(join(projectRoot, directory)));
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (const line of lines) {
      if (line.trimStart().startsWith("#")) continue;
      const words = line.trim().split(/\s+/);
      const rg = words.indexOf("rg");
      if (rg === -1) continue;
      const hasShortReplacement = words.slice(rg + 1).some((word) => /^-[^-]*r\S*$/.test(word));
      assert.equal(
        hasShortReplacement,
        false,
        `${file} must spell --replace instead of using rg's short flag: ${line}`,
      );
    }
  }
});
