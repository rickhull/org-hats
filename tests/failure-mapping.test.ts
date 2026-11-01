// The consumer mapping guard: failure
// mapping. The closed `FailureKind` taxonomy has a consumer/product mapping
// in `examples/consumer-access.ts` — an exhaustive switch, then a walk that
// prints every mapping at run time. The switch is pinned at compile time by
// its `never` default; what nothing pinned is the walk list, a hardcoded
// array that would silently omit a new kind, and the shape of each mapping.
// This guard holds both against the union: the switch and the walk name
// exactly the closed taxonomy, and every mapping is a complete literal
// triple — status, reauthenticate, message — with no room for a generic
// default or a leaked `detail`.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

/** The closed taxonomy, from the union in contract.ts. */
const failureKinds = (): string[] => {
  const source = read("src/contract.ts");
  const match = /export type FailureKind =\s*([\s\S]*?);/.exec(source);
  assert.ok(match !== null, "contract.ts: cannot find the FailureKind union");
  return [...(match[1] ?? "").matchAll(/"([a-z-]+)"/g)].map((kind) => kind[1] ?? "");
};

interface Mapping {
  readonly status: number;
  readonly reauthenticate: boolean;
  readonly message: string;
}

test("[A4] the example maps every failure kind, completely, and drops none", () => {
  const problems: string[] = [];
  const kinds = failureKinds();
  assert.ok(kinds.length >= 9, `contract.ts: parsed ${kinds.length} failure kinds — parser broken?`);
  assert.equal(new Set(kinds).size, kinds.length, "contract.ts: a failure kind is declared twice");

  const source = read("examples/consumer-access.ts");

  // The exhaustive switch: one case per kind, each returning a complete
  // literal triple.
  const switchBody = /switch \(failure\.kind\) \{([\s\S]*?)\n  \}/.exec(source);
  assert.ok(switchBody !== null, "consumer-access.ts: cannot find the productResponse switch");
  const cases = new Map<string, Mapping>();
  for (const caseMatch of (switchBody[1] ?? "").matchAll(/case "([a-z-]+)":([\s\S]*?)(?=case "|default:|$)/g)) {
    const kind = caseMatch[1] ?? "";
    const body = /return \{([^}]*)\};/.exec(caseMatch[2] ?? "")?.[1];
    if (body === undefined) {
      problems.push(`${kind}: the case returns no literal mapping triple`);
      continue;
    }
    const status = /status: (\d{3})/.exec(body)?.[1];
    const reauthenticate = /reauthenticate: (true|false)/.exec(body)?.[1];
    const message = /message: "([^"]*)"/.exec(body)?.[1];
    if (status === undefined || reauthenticate === undefined || message === undefined) {
      problems.push(`${kind}: the mapping is not a complete literal triple (status/reauthenticate/message)`);
      continue;
    }
    const code = Number(status);
    if (code < 400 || code > 599) problems.push(`${kind}: status ${status} is not an error status`);
    if (message.length === 0) problems.push(`${kind}: the message is empty`);
    if (/detail/.test(body)) problems.push(`${kind}: the mapping reads the failure's detail — detail is for logs`);
    cases.set(kind, { status: code, reauthenticate: reauthenticate === "true", message });
  }

  for (const kind of kinds) {
    if (!cases.has(kind)) problems.push(`consumer-access.ts: failure kind ${kind} has no mapping case`);
  }
  for (const kind of cases.keys()) {
    if (!kinds.includes(kind)) problems.push(`consumer-access.ts: mapping case ${kind} names no failure kind`);
  }

  // The compile-time pin itself: a `never` default that throws, so a new
  // kind fails the example's typecheck instead of reaching a generic arm.
  if (!/const unreachable: never = failure\.kind/.test(source)) {
    problems.push("consumer-access.ts: the switch lost its `never` exhaustiveness default");
  }

  // The walk list: it must name exactly the union — the run-time half that
  // a hardcoded array would silently drop.
  const walk = /const kinds: readonly FailureKind\[\] = \[([\s\S]*?)\];/.exec(source);
  assert.ok(walk !== null, "consumer-access.ts: cannot find the walk list");
  const walked = [...(walk[1] ?? "").matchAll(/"([a-z-]+)"/g)].map((kind) => kind[1] ?? "");
  for (const kind of kinds) {
    if (!walked.includes(kind)) problems.push(`consumer-access.ts: the walk omits failure kind ${kind}`);
  }
  for (const kind of walked) {
    if (!kinds.includes(kind)) problems.push(`consumer-access.ts: the walk names ${kind}, which is no failure kind`);
  }
  if (walked.length !== kinds.length) {
    problems.push(`consumer-access.ts: the walk lists ${walked.length} kinds, the taxonomy has ${kinds.length}`);
  }

  assert.deepEqual(problems, [], problems.join("\n"));
});
