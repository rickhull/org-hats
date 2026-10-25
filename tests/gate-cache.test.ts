// The local gate marker: a clean commit is checked once per checkout and
// reused for a second push, but dirt, a new commit, or a changed toolchain
// must not inherit the old result.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../bin/gate-cache", import.meta.url));

const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    "git",
    [
      "-c", "user.name=Gate Test",
      "-c", "user.email=gate@example.test",
      "-c", "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );

const repo = (): { root: string; sha: string } => {
  const root = mkdtempSync(join(tmpdir(), "org-hats-gate-"));
  git(root, "init", "-q");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "gate-test", version: "1.0.0" }, null, 2) + "\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "gate fixtures");
  return { root, sha: git(root, "rev-parse", "HEAD").trim() };
};

const run = (root: string, ...args: string[]) =>
  spawnSync(script, args, {
    cwd: root,
    env: { ...process.env, GATE_CACHE_ROOT: root },
    encoding: "utf8",
  });

test("a clean commit's gate marker is reused, then invalidated by dirt or a new commit", () => {
  const { root, sha } = repo();
  try {
    assert.equal(run(root, "record", sha).status, 0);
    assert.equal(run(root, "check", sha).status, 0);

    // An untracked file is enough: the gate no longer describes the tree.
    writeFileSync(join(root, "untracked.txt"), "dirty\n");
    assert.notEqual(run(root, "check", sha).status, 0);
    assert.notEqual(run(root, "record", sha).status, 0);
    rmSync(join(root, "untracked.txt"));
    assert.equal(run(root, "check", sha).status, 0);

    // A new commit is not the gated one.
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "gate-test", version: "1.0.1" }, null, 2) + "\n");
    git(root, "add", "package.json");
    git(root, "commit", "-q", "-m", "next commit");
    const next = git(root, "rev-parse", "HEAD").trim();
    assert.notEqual(run(root, "check", sha).status, 0);
    assert.notEqual(run(root, "record", sha).status, 0);

    assert.equal(run(root, "record", next).status, 0);
    assert.equal(run(root, "check", next).status, 0);
    assert.equal(run(root, "clear", next).status, 0);
    assert.notEqual(run(root, "check", next).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
