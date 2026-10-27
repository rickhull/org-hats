/**
 * Git policy gate for the pi harness
 *
 * Replicates the permission tiers that `.claude/settings.json` gives Claude
 * Code, for pi, which has no settings-file equivalent: a `tool_call` hook
 * inspects every `bash` command and classifies git invocations.
 *
 *   deny  — git commit/reset/push/checkout/switch/merge/rebase/stash/
 *           cherry-pick/revert/clean: blocked outright, with the reason
 *           returned to the model. Rick makes every commit and every push;
 *           tags are created with `git tag` (AGENTS.md, "Git policy").
 *   ask   — git add/rm/mv/restore: prompt the human at the terminal for the
 *           exact command. Declined unless approved. Without a UI (headless
 *           sessions) the safe answer is "no": nobody present means nobody
 *           judged this path.
 *
 * Keep DENY and ASK in lockstep with AGENTS.md ("Git policy") and
 * .claude/settings.json (permissions). The parser lives separately so its
 * shell forms and value-taking global options can have portable regression
 * coverage without loading Pi's extension package.
 */

import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ASK, DENY, gitSubcommands } from "./git-command-classifier.ts";

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
          `commit and push; tags are created with git tag (AGENTS.md).`,
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
