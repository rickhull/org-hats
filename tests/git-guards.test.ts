// The repository-local agent guards must keep the Git-policy contract aligned:
// owner-only history changes are denied, index/worktree changes are approval
// gated, and plain inspection plus tagging remain available.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { ASK, DENY, gitSubcommands } from "../.pi/extensions/lib/git-command-classifier.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const codexGuard = join(root, ".codex", "git-guard.sh");
const codexSource = readFileSync(codexGuard, "utf8");
const claudeSettings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8")) as {
  permissions: { ask: string[]; deny: string[] };
};

const DENIED = [
  "commit",
  "push",
  "reset",
  "checkout",
  "switch",
  "merge",
  "rebase",
  "stash",
  "cherry-pick",
  "revert",
  "clean",
];
const ASKED = ["add", "rm", "mv", "restore"];

function codexList(): string[] {
  const match = codexSource.match(/^DENY='([^']+)'$/m);
  assert.ok(match, "Codex guard has a DENY list");
  return match[1]!.split(" ");
}

function codexDecision(command: string): string | undefined {
  // Run through `sh` so this works where direct shebang execution is blocked
  // by the test sandbox; the hook itself remains the exercised program.
  const result = spawnSync("sh", [codexGuard], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ tool_input: { command } }),
    timeout: 1_000,
  });
  assert.equal(result.status, 0, `Codex guard failed for ${JSON.stringify(command)}: ${result.stderr}`);
  if (result.stdout === "") return undefined;
  return JSON.parse(result.stdout).hookSpecificOutput.permissionDecision;
}

test("Codex guard denies protected operations across shell forms", () => {
  for (const operation of DENIED) {
    assert.equal(codexDecision(`git ${operation}`), "deny", operation);
  }

  assert.equal(codexDecision("git status && git push"), "deny");
  assert.equal(codexDecision("command git clean -fd"), "deny");
  assert.equal(codexDecision("exec git revert HEAD"), "deny");
  assert.equal(codexDecision("GIT_EDITOR=: git reset --hard"), "deny");
  assert.equal(codexDecision("git -C /tmp reset --hard"), "deny");
  assert.equal(codexDecision("git --git-dir /tmp reset --hard"), "deny");
});

test("Codex guard leaves harmless Git, tags, and quoted text to normal approval", () => {
  assert.equal(codexDecision("git status"), undefined);
  assert.equal(codexDecision("git tag v3.0.1"), undefined);
  assert.equal(codexDecision("echo 'git commit'"), undefined);
});

test("Pi classifier sees protected and approval-gated commands through shell forms", () => {
  for (const operation of DENIED) {
    assert.deepEqual(gitSubcommands(`git ${operation}`), [operation], operation);
  }
  for (const operation of ASKED) {
    assert.deepEqual(gitSubcommands(`git ${operation} path`), [operation], operation);
  }

  assert.deepEqual(gitSubcommands("git status && git push"), ["status", "push"]);
  assert.deepEqual(gitSubcommands("command git clean -fd"), ["clean"]);
  assert.deepEqual(gitSubcommands("exec git revert HEAD"), ["revert"]);
  assert.deepEqual(gitSubcommands("GIT_EDITOR=: git reset --hard"), ["reset"]);
  assert.deepEqual(gitSubcommands("git -C /tmp reset --hard"), ["reset"]);
  assert.deepEqual(gitSubcommands("git -c user.name=test reset --hard"), ["reset"]);
  assert.deepEqual(gitSubcommands("git --git-dir /tmp reset --hard"), ["reset"]);
  assert.deepEqual(gitSubcommands("git --work-tree /tmp reset --hard"), ["reset"]);
  assert.deepEqual(gitSubcommands("git --namespace main reset --hard"), ["reset"]);
  assert.deepEqual(gitSubcommands("git --config-env name=VALUE reset --hard"), ["reset"]);
  assert.deepEqual(gitSubcommands("echo 'git commit'"), []);
  assert.deepEqual(gitSubcommands("git tag v3.0.1"), ["tag"]);
});

test("all three guard harnesses carry the same policy lists", () => {
  const claudeDeny = claudeSettings.permissions.deny.map((rule) => rule.match(/^Bash\(git ([^)]+)\*\)$/)?.[1]);
  const claudeAsk = claudeSettings.permissions.ask.map((rule) => rule.match(/^Bash\(git ([^)]+)\*\)$/)?.[1]);

  assert.deepEqual([...DENIED].sort(), codexList().sort());
  assert.deepEqual([...DENIED].sort(), [...DENY].sort());
  assert.deepEqual([...DENIED].sort(), claudeDeny.sort());
  assert.deepEqual([...ASKED].sort(), [...ASK].sort());
  assert.deepEqual([...ASKED].sort(), claudeAsk.sort());
});
