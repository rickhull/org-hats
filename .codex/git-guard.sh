#!/bin/sh
# Codex PreToolUse hook: deny the git operations AGENTS.md reserves for Rick.
#
# Codex invokes the hook with JSON on stdin. For a `Bash` tool call, the
# command is `tool_input.command`. This hook either writes a documented
# PreToolUse denial decision or writes nothing, allowing Codex's usual
# approval flow.

# --- deny list: git operations that only Rick performs (AGENTS.md) ----------
DENY='commit reset push checkout switch merge rebase stash cherry-pick revert clean'

# --- allow list: the agent's outright, with no approval (AGENTS.md) ---------
# A tag is fully specified by its release family and re-checked by
# bin/check-version, so nothing is left to judge. Stated as an allowance
# because Codex cannot return "ask": silence here means Codex's own approval
# setting decides, which is not the same as allowed.
ALLOW='tag'

# --- parse: every shell command segment -----------------------------------
# jq decodes JSON correctly. Python's standard-library shlex distinguishes
# shell operators and quoted strings, so a forbidden command cannot be
# hidden behind a later harmless `git status` in the same shell invocation.
command_text=$(jq -er '.tool_input.command | strings' 2>/dev/null) || exit 0

subcommand=$(python3 - "$command_text" <<'PY'
import re
import shlex
import sys

DENY = {
    "commit", "reset", "push", "checkout", "switch", "merge", "rebase",
    "stash", "cherry-pick", "revert", "clean",
}
ALLOW = {"tag"}
VALUE_OPTIONS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"}
OPERATORS = {";", "&&", "||", "|", "&", "(", ")"}
ASSIGNMENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*=.*")

lexer = shlex.shlex(sys.argv[1], posix=True, punctuation_chars=";&|()")
lexer.whitespace_split = True
tokens = list(lexer)

found = []
segments = [[]]
for token in tokens:
    if token in OPERATORS:
        segments.append([])
    else:
        segments[-1].append(token)

for segment in segments:
    i = 0
    while i < len(segment) and ASSIGNMENT.fullmatch(segment[i]):
        i += 1
    # `command git …` and `exec git …` retain git as the invoked program.
    while i < len(segment) and segment[i] in {"command", "exec"}:
        i += 1
    if i >= len(segment) or segment[i] != "git":
        continue

    i += 1
    while i < len(segment):
        token = segment[i]
        if token in VALUE_OPTIONS:
            i += 2
            continue
        if token.startswith("--git-dir=") or token.startswith("--work-tree=") or token.startswith("--namespace=") or token.startswith("--config-env="):
            i += 1
            continue
        if token.startswith("-"):
            i += 1
            continue
        if token in DENY or token in ALLOW:
            found.append(token)
        break

# Deny wins over an allowance sharing the command line: `git tag v1 && git
# push` is a push. Scanning every segment is what makes that true, so the
# verdict is taken over all of them rather than from the first git call.
for token in found:
    if token in DENY:
        print(token)
        sys.exit(0)
for token in found:
    if token in ALLOW:
        print(token)
        sys.exit(0)
PY
) || exit 0

[ -n "$subcommand" ] || exit 0

# --- decide ---------------------------------------------------------------
for op in $DENY; do
  if [ "$subcommand" = "$op" ]; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}' \
      "git $op is denied by repository policy: Rick makes every commit and push; tags are created with git tag (AGENTS.md)."
    exit 0
  fi
done

for op in $ALLOW; do
  if [ "$subcommand" = "$op" ]; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"%s"}}' \
      "git $op is the agent's outright: a tag is named by its release family and re-checked by bin/check-version (AGENTS.md)."
    exit 0
  fi
done

exit 0
