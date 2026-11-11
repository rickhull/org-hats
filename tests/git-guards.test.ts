// The repository-local agent guards must keep the Git-policy contract aligned:
// owner-only history changes are denied, index/worktree changes are approval
// gated, and plain inspection plus tagging remain available.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { ALLOW, ASK, DENY, gitSubcommands } from "../.pi/extensions/lib/git-command-classifier.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const codexGuard = join(root, ".codex", "git-guard.sh");
const codexSource = readFileSync(codexGuard, "utf8");
const claudeSettings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8")) as {
  permissions: { allow?: string[]; ask: string[]; deny: string[] };
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
/** Tagging is the agent's outright: named by a release family, verified by
 * `bin/check-version`, and no approval anywhere. A guard that merely declines
 * to deny it leaves the decision to each harness's own default, which is how
 * the three drifted apart; the allowance is stated. */
const ALLOWED = ["tag"];

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

test("Codex guard leaves harmless Git and quoted text to normal approval", () => {
  assert.equal(codexDecision("git status"), undefined);
  assert.equal(codexDecision("echo 'git commit'"), undefined);
});

test("Codex guard allows tagging outright, and a denial still wins beside it", () => {
  for (const operation of ALLOWED) {
    assert.equal(codexDecision(`git ${operation} v3.0.1`), "allow", operation);
  }
  // Deny precedence: an allowance must not launder a denied verb sharing the
  // command line. This is the whole reason the guard scans every segment.
  assert.equal(codexDecision("git tag v3.0.1 && git push"), "deny");
  assert.equal(codexDecision("git push && git tag v3.0.1"), "deny");
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
  // Bare-verb rules only: a rule carrying a flag (`git add -A`) states a
  // narrower prohibition inside a tier, not the tier's verb list, and is
  // asserted separately below.
  const verbs = (rules: readonly string[]): string[] =>
    rules
      .map((rule) => rule.match(/^Bash\(git ([a-z-]+)\*\)$/)?.[1])
      .filter((verb): verb is string => verb !== undefined);
  const claudeDeny = verbs(claudeSettings.permissions.deny);
  const claudeAsk = verbs(claudeSettings.permissions.ask);
  const claudeAllow = verbs(claudeSettings.permissions.allow ?? []);

  assert.deepEqual([...DENIED].sort(), codexList().sort());
  assert.deepEqual([...DENIED].sort(), [...DENY].sort());
  assert.deepEqual([...DENIED].sort(), claudeDeny.sort());
  assert.deepEqual([...ASKED].sort(), [...ASK].sort());
  assert.deepEqual([...ASKED].sort(), claudeAsk.sort());
  assert.deepEqual([...ALLOWED].sort(), [...ALLOW].sort());
  assert.deepEqual([...ALLOWED].sort(), claudeAllow.sort());

  // The three tiers are disjoint: a verb in two tiers is a policy that
  // cannot be read off the lists.
  const all = [...DENIED, ...ASKED, ...ALLOWED];
  assert.equal(new Set(all).size, all.length, "no verb appears in two tiers");
});

test("staging the ignored relay, and the sweeping add forms, stay denied", () => {
  // `notes/` is gitignored, and AGENTS.md names the hazard: a gitignore is
  // one `git add -f` from not applying. Opening the index is what puts that
  // flag in reach, so the force and sweep forms are denied outright rather
  // than left to a prompt.
  const denyRules = claudeSettings.permissions.deny;
  for (const rule of ["Bash(git add -A*)", "Bash(git add .*)", "Bash(git add -f*)", "Bash(git add --force*)"]) {
    assert.ok(denyRules.includes(rule), `${rule} is denied`);
  }
});
