// Shell-aware, dependency-free classification for the Pi Git policy gate.
// It deliberately recognizes only the command shapes agents commonly emit;
// unrecognized text never becomes a Git command merely because it mentions
// the words "git" and a protected subcommand.

export const DENY: readonly string[] = [
  "commit",
  "reset",
  "push",
  "checkout",
  "switch",
  "merge",
  "rebase",
  "stash",
  "cherry-pick",
  "revert",
  "clean",
] as const;

export const ASK: readonly string[] = ["add", "rm", "mv", "restore"] as const;

const VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
]);
const VALUE_OPTION_PREFIXES = ["-C", "-c"];
const VALUE_OPTION_EQUALS_PREFIXES = [
  "--git-dir=",
  "--work-tree=",
  "--namespace=",
  "--config-env=",
];
const OPERATORS = new Set([";", "&&", "||", "|", "&", "(", ")"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=.*/;

function shellTokens(command: string): string[] {
  const tokens: string[] = [];
  let word = "";
  let quote: "'" | '"' | undefined;

  const flush = () => {
    if (word !== "") tokens.push(word);
    word = "";
  };

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!;
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      } else if (char === "\\" && quote === '"' && i + 1 < command.length) {
        word += command[i + 1]!;
        i += 1;
      } else {
        word += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "\\" && i + 1 < command.length) {
      word += command[i + 1]!;
      i += 1;
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    if (";&|()".includes(char)) {
      flush();
      const next = command[i + 1];
      if ((char === "&" || char === "|") && next === char) {
        tokens.push(`${char}${next}`);
        i += 1;
      } else {
        tokens.push(char);
      }
      continue;
    }
    word += char;
  }
  flush();
  return tokens;
}

function subcommand(segment: string[]): string | undefined {
  let i = 0;
  while (i < segment.length && ASSIGNMENT.test(segment[i]!)) i += 1;
  while (segment[i] === "command" || segment[i] === "exec") i += 1;
  if (segment[i] !== "git") return undefined;

  for (i += 1; i < segment.length; i += 1) {
    const token = segment[i]!;
    if (VALUE_OPTIONS.has(token)) {
      i += 1;
      continue;
    }
    if (VALUE_OPTION_EQUALS_PREFIXES.some((prefix) => token.startsWith(prefix))) continue;
    if (VALUE_OPTION_PREFIXES.some((prefix) => token.startsWith(prefix) && token !== prefix)) continue;
    if (token.startsWith("-")) continue;
    return token;
  }
  return undefined;
}

export function gitSubcommands(command: string): string[] {
  const subcommands: string[] = [];
  let segment: string[] = [];
  for (const token of shellTokens(command)) {
    if (OPERATORS.has(token)) {
      const found = subcommand(segment);
      if (found !== undefined) subcommands.push(found);
      segment = [];
    } else {
      segment.push(token);
    }
  }
  const found = subcommand(segment);
  if (found !== undefined) subcommands.push(found);
  return subcommands;
}
