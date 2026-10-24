/**
 * Git policy gate for the pi harness
 *
 * Replicates the permission tiers that `.claude/settings.json` gives Claude
 * Code, for pi, which has no settings-file equivalent: a `tool_call` hook
 * inspects every `bash` command and classifies git invocations.
 *
 *   deny  — git commit/reset/push/checkout/switch/merge/rebase/stash/tag/
 *           cherry-pick/revert/clean: blocked outright, with the reason
 *           returned to the model. Rick makes every commit and every push
 *           (AGENTS.md, "Git policy").
 *   ask   — git add/rm/mv/restore: prompt the human at the terminal for the
 *           exact command. Declined unless approved. Without a UI (headless
 *           sessions) the safe answer is "no": nobody present means nobody
 *           judged this path.
 *
 * Keep DENY and ASK in lockstep with AGENTS.md ("Git policy") and
 * .claude/settings.json (permissions). Both were last aligned 2026-10-24.
 *
 * Scope note: the parser takes the first non-flag word after `git` as the
 * subcommand. That covers the forms this repository's agent uses, running
 * from the repo root (`git add <path>`); it does not resolve option values,
 * so `git -C <dir> add ...` would classify `<dir>` instead of `add`. If the
 * harness ever needs that shape, add a value-consuming-option skip list.
 */

import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DENY = [
  "commit",
  "reset",
  "push",
  "checkout",
  "switch",
  "merge",
  "rebase",
  "stash",
  "tag",
  "cherry-pick",
  "revert",
  "clean",
];

const ASK = ["add", "rm", "mv", "restore"];

function gitSubcommands(command: string): string[] {
  const words = command.trim().split(/\s+/);
  const subs: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i] !== "git") continue;
    // Skip flags and their values that follow `git`; the subcommand is the
    // first word that is neither a flag nor another `git`. (Value-taking
    // options like -C are deliberately unresolved — see scope note.)
    for (let j = i + 1; j < words.length; j++) {
      const w = words[j];
      if (w === "git") break;
      if (w.startsWith("-")) continue;
      subs.push(w);
      break;
    }
  }
  return subs;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    const command = String(event.input.command ?? "");
    const subs = gitSubcommands(command);
    if (subs.length === 0) return;

    const denied = subs.find((s) => DENY.includes(s));
    if (denied) {
      return {
        block: true,
        reason:
          `git ${denied} is denied by repository policy: Rick makes every ` +
          `commit, push, and history-changing operation (AGENTS.md).`,
      };
    }

    const asked = subs.find((s) => ASK.includes(s));
    if (!asked) return;
    const brief =
      command.length > 120 ? `${command.slice(0, 120)}…` : command;
    const ok = ctx.hasUI
      ? await ctx.ui.confirm("Run this git command?", brief)
      : false;
    if (ok) return;
    return {
      block: true,
      reason:
        "git add/rm/mv/restore needs explicit human approval per path, " +
        "never `git add -A` or `.` (AGENTS.md).",
    };
  });
}
