// Guard 2 of plans/refactor.md phase 1 (reliability guards): the command
// inventory. Every `AuthorityCommand` kind resolves to exactly one
// coordinator, one operation-binding rule, one authorization mode, and one
// required standing — stated here as a table, then verified against the
// three places the policy lives: the type union, the portable engine's
// dispatch, and the Cloudflare runtime's dispatch plus each coordinator's
// standing checks. A behavioral matrix then proves the standing claims on
// the in-memory engine: a plain actor's fresh evidence is denied every
// administered command, and an organization administrator's envelope
// cannot carry the fresh-evidence-only commands.
//
// The compiler proves switch exhaustiveness; this guard makes the policy
// explicit and fails when any of the four statements drifts.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { AUTHORITY_INTERFACE_VERSION } from "../src/contract.ts";
import { CONFORMANCE_PRINCIPALS, createInMemoryConformanceWorld } from "../src/conformance.ts";
import { COMMAND_POLICY, type CommandPolicy } from "../src/authority/commands.ts";
import type { AuthorityCommand } from "../src/authority/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

/** The policy table moved into source; this suite checks it against the
 * command union, the two dispatches, and the coordinators. */
const INVENTORY: Readonly<Record<string, CommandPolicy>> = COMMAND_POLICY;
const KINDS = Object.keys(INVENTORY);

// --- source facts ----------------------------------------------------------------

/** The command kind union, from the five command unions in types.ts. */
const unionKinds = (): string[] => {
  const lines = read("src/authority/types.ts").split(/\r?\n/);
  const start = lines.findIndex((line) => /export type ParticipationCommand/.test(line));
  const end = lines.findIndex((line) => /export type AuthorityCommand/.test(line));
  assert.ok(start !== -1 && end > start, "types.ts: cannot scope the command unions");
  const kinds: string[] = [];
  for (const line of lines.slice(start, end)) {
    const match = /readonly kind: "([a-z-]+)"/.exec(line);
    if (match !== null) kinds.push(match[1] ?? "");
  }
  return kinds;
};

/** The Cloudflare runtime's transport switch: every kind still names its
 * route target, but the binding and standing policy come from the descriptor. */
const runtimeDispatch = (): Map<string, "organization" | "operation" | "by-participation"> => {
  const lines = read("packages/cloudflare/src/runtime.ts").split(/\r?\n/);
  const routes = new Map<string, "organization" | "operation" | "by-participation">();
  const switchStart = lines.findIndex((line) => /switch \(input\.kind\)/.test(line));
  assert.ok(switchStart !== -1, "runtime.ts: cannot find the dispatch switch");
  let pending: string[] = [];
  let sawOperation = false;
  let sawOrganization = false;
  const flush = (): void => {
    if (pending.length === 0) return;
    const route = sawOperation && sawOrganization ? "by-participation" : sawOperation ? "operation" : "organization";
    for (const kind of pending) routes.set(kind, route);
    pending = [];
    sawOperation = false;
    sawOrganization = false;
  };
  for (const line of lines.slice(switchStart)) {
    const caseMatch = /case "([a-z-]+)":/.exec(line);
    if (caseMatch !== null) {
      // Clustered case labels (no route between them) share the arm.
      if (sawOperation || sawOrganization) flush();
      pending.push(caseMatch[1] ?? "");
      continue;
    }
    if (/route\(operation\(/.test(line)) sawOperation = true;
    if (/route\(organization\(/.test(line)) sawOrganization = true;
    if (/input\.kind satisfies never|default:/.test(line)) break;
  }
  flush();
  return routes;
};

/** Per-kind standing evidence inside the portable coordinators: each handler
 * is anchored by its `input.kind !== "…"` guard; the window up to the next
 * anchor must carry the standing tokens the inventory claims. */
const coordinatorStanding = (): Map<string, Set<string>> => {
  const tokens = new Map<string, Set<string>>();
  for (const file of ["src/authority/organization.ts", "src/authority/operation.ts"]) {
    const lines = read(file).split(/\r?\n/);
    const anchors: { kind: string; line: number }[] = [];
    lines.forEach((line, index) => {
      const match = /if \(input\.kind !== "([a-z-]+)"\) return fail\("invalid-command"/.exec(line);
      if (match !== null) anchors.push({ kind: match[1] ?? "", line: index });
    });
    anchors.forEach((anchor, position) => {
      const end = position + 1 < anchors.length ? anchors[position + 1]!.line : lines.length;
      const window = lines.slice(anchor.line, end).join("\n");
      const found = new Set<string>();
      if (/rosterAuthority\(input\.authorization/.test(window)) found.add("roster:fresh+organization-admin");
      if (/if \(!principal\.adminOfOperation && !selectsOwn\)/.test(window)) found.add("operation-admin-or-owner");
      if (/owner retirement requires fresh evidence/.test(window)) found.add("operation-admin-or-org-owner");
      if (/if \(!principal\.adminOfOperation\)/.test(window)) found.add("operation-admin");
      if (/if \(!principal\.adminOfOrganization\)/.test(window)) found.add("organization-admin");
      if (/team changes require fresh evidence/.test(window)) found.add("mode:fresh");
      if (/principal recovery requires fresh evidence/.test(window)) found.add("mode:fresh");
      if (/activation recovery requires fresh evidence/.test(window)) found.add("mode:fresh");
      const existing = tokens.get(anchor.kind) ?? new Set<string>();
      for (const token of found) existing.add(token);
      if (found.size > 0 || !tokens.has(anchor.kind)) tokens.set(anchor.kind, existing);
    });
  }
  return tokens;
};

const standingTokensOf = (entry: CommandPolicy): Set<string> => {
  const tokens = new Set<string>();
  switch (entry.standing) {
    case "none":
      break;
    case "operation-admin":
      tokens.add("operation-admin");
      break;
    case "organization-admin":
      if (entry.mode === "fresh" && entry.freshDetail === "roster changes require fresh evidence") {
        tokens.add("roster:fresh+organization-admin");
      } else {
        tokens.add("organization-admin");
        if (entry.mode === "fresh") tokens.add("mode:fresh");
      }
      break;
    case "operation-admin-or-owner":
      tokens.add("operation-admin-or-owner");
      break;
    case "operation-admin-or-org-owner":
      tokens.add("operation-admin-or-org-owner");
      break;
    case "by-participation":
      tokens.add("operation-admin");
      tokens.add("organization-admin");
      break;
  }
  return tokens;
};

test("the command inventory matches the union, both dispatches, and the standing checks", () => {
  const problems: string[] = [];

  // 1. Coverage: the union and the inventory name the same kinds.
  const kinds = unionKinds();
  for (const kind of kinds) {
    if (!(kind in INVENTORY)) problems.push(`types.ts: command kind ${kind} has no inventory row`);
  }
  for (const kind of KINDS) {
    if (!kinds.includes(kind)) problems.push(`inventory row ${kind} names no command kind`);
  }
  assert.equal(kinds.length, new Set(kinds).size, "types.ts: a command kind is declared twice");

  // 2. The portable engine consumes the descriptor. Its dispatch is on the
  // policy's coordinator, not a second kind list.
  const engine = read("src/authority/engine.ts");
  if (!/commandPolicy\(inputCommand\.kind\)/.test(engine)) {
    problems.push("engine.ts: does not read the command policy");
  }
  if (!/switch \(policy\.coordinator\)/.test(engine)) {
    problems.push("engine.ts: does not dispatch on the policy coordinator");
  }
  if (/switch \(inputCommand\.kind\)/.test(engine)) {
    problems.push("engine.ts: still has a per-kind dispatch switch");
  }
  if (/const boundOperation = inputCommand\.kind ===/.test(engine)) {
    problems.push("engine.ts: still has a hand-written unbound list");
  }
  if (!/if \(inputCommand\.kind === "request-access"\) return operations\.requestAccess/.test(engine)) {
    problems.push("engine.ts: request-access is not dispatched before principal resolution");
  }

  // 3. The Cloudflare runtime consumes the descriptor for the preferred
  // organization and standing, while its transport switch still names a route
  // target per kind. Routing parity is checked against the same table.
  const runtimeSource = read("packages/cloudflare/src/runtime.ts");
  if (!/commandPolicy\(command\.kind\)/.test(runtimeSource)) {
    problems.push("runtime.ts: authorize does not read the command policy");
  }
  if (!/commandPolicy\(input\.kind\)/.test(runtimeSource)) {
    problems.push("runtime.ts: command does not read the command policy");
  }
  if (!/switch \(policy\.standing\)/.test(runtimeSource)) {
    problems.push("runtime.ts: does not enforce the policy standing");
  }
  if (/const preferred = command\.kind ===/.test(runtimeSource)) {
    problems.push("runtime.ts: still has a hand-written preferred list");
  }
  const routes = runtimeDispatch();
  for (const kind of KINDS) {
    const expected = INVENTORY[kind]!;
    if (kind === "request-access") {
      if (routes.has(kind)) problems.push("runtime.ts: request-access appears in the dispatch switch");
      continue;
    }
    const route = routes.get(kind);
    if (route === undefined) {
      problems.push(`runtime.ts: ${kind} has no dispatch case`);
      continue;
    }
    if (route !== expected.coordinator) {
      problems.push(`runtime.ts: ${kind} routes to ${route}, inventory says ${expected.coordinator}`);
    }
  }

  // 4. Standing and mode in the portable coordinators.
  const standing = coordinatorStanding();
  for (const kind of KINDS) {
    const expected = standingTokensOf(INVENTORY[kind]!);
    const actual = standing.get(kind);
    if (actual === undefined) {
      problems.push(`coordinators: ${kind} has no handler anchor`);
      continue;
    }
    for (const token of expected) {
      if (!actual.has(token)) problems.push(`${kind}: coordinator standing lacks [${token}]`);
    }
    const allowed = new Set([...expected, ...(INVENTORY[kind]!.also ?? [])]);
    for (const token of actual) {
      if (!allowed.has(token)) problems.push(`${kind}: coordinator standing carries [${token}] the inventory does not claim`);
    }
  }

  assert.deepEqual(problems, [], problems.join("\n"));
});

// --- behavioral matrix --------------------------------------------------------------

const OP = "op-9f2e6ad4";
const HARBOR = "org-4c1f9a2e";
const ATLAS = "org-a53e90f7";
const SAM = "actor-3a91c4d8";
const DANA = "actor-8d3b77c1";

test("the standing claims hold on the in-memory engine", async () => {
  const { runtime } = await createInMemoryConformanceWorld();
  const sam = CONFORMANCE_PRINCIPALS.sam!;
  const dana = CONFORMANCE_PRINCIPALS.dana!;
  let key = 0;
  const fresh = (evidence: unknown, operationId = OP) => ({
    kind: "fresh-evidence",
    evidence,
    operationId,
  }) as AuthorityCommand["authorization"];
  const envelopeOf = async (label: string) => {
    const entry = CONFORMANCE_PRINCIPALS[label as keyof typeof CONFORMANCE_PRINCIPALS]!;
    const issued = await runtime.accessFromEvidence({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: OP,
      evidence: entry.evidence,
    });
    if ("failure" in issued) throw new Error(`probe setup: ${label}: ${issued.failure.kind}`);
    return { kind: "access-envelope", envelope: issued.envelope } as AuthorityCommand["authorization"];
  };

  const bound = (kind: string): boolean =>
    INVENTORY[kind]!.operationBound && kind !== "request-access";
  const probe = async (
    label: string,
    kind: string,
    authorization: AuthorityCommand["authorization"],
    body: Record<string, unknown>,
    expect: "denied" | "ok",
  ): Promise<void> => {
    const result = await runtime.command({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      idempotencyKey: `inventory-${key++}`,
      authorization,
      kind,
      ...(bound(kind) ? { operationId: OP } : {}),
      ...body,
    } as AuthorityCommand);
    const denied = !result.ok && result.failure.kind === "denied";
    if (expect === "denied" && !denied) {
      assert.fail(`${label}: expected denied, got ${JSON.stringify(result)}`);
    }
    if (expect === "ok" && !result.ok) {
      assert.fail(`${label}: expected ok, got ${JSON.stringify(result.failure)}`);
    }
  };

  // request-access needs no administrator: a plain actor's evidence is the request.
  await probe(
    "request-access/plain",
    "request-access",
    fresh(sam.evidence),
    { operationId: OP, evidence: sam.evidence, note: "probe" },
    "ok",
  );

  // A plain actor is denied every administered command.
  const plainDenials: readonly [string, Record<string, unknown>][] = [
    ["participation-invite", { organizationId: ATLAS }],
    ["participation-accept", {}],
    ["participation-revoke", { organizationId: ATLAS, by: "operation" }],
    ["participation-revoke", { organizationId: HARBOR, by: "organization" }],
    ["admit", { organizationId: ATLAS, actorId: "actor-77f2b0e5" }],
    ["grant-hat", { organizationId: ATLAS, actorId: "actor-77f2b0e5", role: "field", target: { kind: "team", teamId: "team-9a1f73e0" }, primary: true }],
    ["revoke-grant", { grantId: "g-mer-4" }],
    ["select-hat", { grantId: "g-mer-5" }],
    ["request-team", { organizationId: HARBOR, teamId: "team-probe-1", siteId: "site-b8d620fa", displayName: "Probe" }],
    ["admit-team", { teamId: "team-c7d9e2a1" }],
    ["update-team", { teamId: "team-2e8c64b9", displayName: "Probe" }],
    ["retire-team", { teamId: "team-c7d9e2a1" }],
    ["disable-actor", { organizationId: HARBOR, actorId: SAM }],
    ["unlink-principal", { organizationId: HARBOR, actorId: SAM }],
    ["revoke-activation", { organizationId: HARBOR, actorId: SAM }],
    ["create-actor", { organizationId: HARBOR, actorId: "actor-probe-1", displayName: "Probe" }],
    ["update-actor", { organizationId: HARBOR, actorId: SAM, displayName: "Probe" }],
    ["appoint-administrator", { organizationId: HARBOR, actorId: SAM }],
    ["retire-administrator", { organizationId: HARBOR, actorId: DANA }],
  ];
  for (const [kind, body] of plainDenials) {
    await probe(`${kind}/plain-fresh`, kind, fresh(sam.evidence), body, "denied");
  }

  // An organization administrator's envelope carries the either-mode
  // commands but not the fresh-only ones — an envelope belongs to an
  // operation and cannot carry a roster or team change.
  const danaEnvelope = await envelopeOf("dana");
  const freshOnly: readonly [string, Record<string, unknown>][] = [
    ["request-team", { organizationId: HARBOR, teamId: "team-probe-2", siteId: "site-b8d620fa", displayName: "Probe" }],
    ["update-team", { teamId: "team-2e8c64b9", displayName: "Probe" }],
    ["create-actor", { organizationId: HARBOR, actorId: "actor-probe-2", displayName: "Probe" }],
    ["update-actor", { organizationId: HARBOR, actorId: SAM, displayName: "Probe" }],
    ["appoint-administrator", { organizationId: HARBOR, actorId: SAM }],
    ["retire-administrator", { organizationId: HARBOR, actorId: SAM }],
  ];
  for (const [kind, body] of freshOnly) {
    await probe(`${kind}/admin-envelope`, kind, danaEnvelope, body, "denied");
  }

  // The either-mode proof: the administrator's envelope does carry disable.
  await probe("disable-actor/admin-envelope", "disable-actor", danaEnvelope, { organizationId: HARBOR, actorId: SAM }, "ok");
});
