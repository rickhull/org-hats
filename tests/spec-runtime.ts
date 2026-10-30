// The harness injected into executable spec blocks. It is deliberately a
// thin adapter over the public runtime and the conformance fixtures: the
// example exercises the same use cases a caller does, and this file does not
// reimplement reach, selection, policy, or refresh semantics.
//
// A block gets one `spec` object:
//
//   const s = await spec.world();
//   const issued = await s.issue("sam");
//   const disabled = await s.disable("sam");
//   spec.expect(disabled.ok, "disable applies");
//   spec.expectFailure(await s.refresh(issued), "unauthenticated");
//
// `spec.world()` creates an isolated in-memory world. Labels are the
// conformance principals ("dana", "sam", "len", …); `disable` uses "dana" as
// the Harbor administrator. This is a prototype surface, not a public API.

import {
  AUTHORITY_INTERFACE_VERSION,
  isFailed,
  type FailureKind,
} from "../src/contract.ts";
import {
  CONFORMANCE_PRINCIPALS,
  createInMemoryConformanceWorld,
} from "../src/conformance.ts";
import { PROFESSIONAL_OPERATION } from "../src/authority/twins.ts";
import type {
  AccessIssue,
  AuthorityCommand,
  CommandResult,
  Failed,
} from "../src/authority/types.ts";

type Label = keyof typeof CONFORMANCE_PRINCIPALS;

const operation = PROFESSIONAL_OPERATION.snapshot.operations[0];
if (operation === undefined) throw new Error("the professional twin has no operation");
const OPERATION = operation.operationId;

const principal = (label: string): (typeof CONFORMANCE_PRINCIPALS)[Label] => {
  const entry = CONFORMANCE_PRINCIPALS[label as Label];
  if (entry === undefined) throw new Error(`unknown spec principal "${label}"`);
  return entry;
};

const failedKind = (result: unknown): FailureKind | undefined => {
  if (typeof result !== "object" || result === null || !("failure" in result)) return undefined;
  const failure = (result as { readonly failure?: { readonly kind?: FailureKind } }).failure;
  return failure?.kind;
};

export interface SpecWorld {
  readonly issue: (label: string) => Promise<AccessIssue>;
  readonly refresh: (issued: AccessIssue) => Promise<AccessIssue | Failed>;
  readonly disable: (label: string) => Promise<CommandResult>;
}

export interface SpecHarness {
  readonly world: () => Promise<SpecWorld>;
  readonly expect: (condition: unknown, message: string) => void;
  readonly expectFailure: (result: unknown, kind: FailureKind, message?: string) => void;
}

export const createSpecHarness = async (): Promise<SpecHarness> => {
  const expect = (condition: unknown, message: string): void => {
    if (!condition) throw new Error(message);
  };

  const expectFailure = (result: unknown, kind: FailureKind, message?: string): void => {
    const actual = failedKind(result);
    if (actual === undefined) throw new Error(`${message ?? "expected failure"}: expected ${kind}, got success`);
    if (actual !== kind) throw new Error(`${message ?? "expected failure"}: expected ${kind}, got ${actual}`);
  };

  const world = async (): Promise<SpecWorld> => {
    const runtime = (await createInMemoryConformanceWorld()).runtime;

    const issue = async (label: string): Promise<AccessIssue> => {
      const entry = principal(label);
      const result = await runtime.accessFromEvidence({
        interfaceVersion: AUTHORITY_INTERFACE_VERSION,
        operationId: OPERATION,
        evidence: entry.evidence,
      });
      if (isFailed(result)) throw new Error(`issue ${label}: ${result.failure.kind}`);
      return result;
    };

    const refresh = async (issued: AccessIssue): Promise<AccessIssue | Failed> => {
      if (issued.refresh.kind !== "rotated") throw new Error("the example needs a rotated refresh handle");
      return runtime.refresh({
        interfaceVersion: AUTHORITY_INTERFACE_VERSION,
        operationId: OPERATION,
        handle: issued.refresh.handle,
      });
    };

    const disable = async (label: string): Promise<CommandResult> => {
      const target = principal(label);
      const admin = await issue("dana");
      const command: AuthorityCommand = {
        interfaceVersion: AUTHORITY_INTERFACE_VERSION,
        idempotencyKey: `spec-disable-${label}`,
        authorization: { kind: "access-envelope", envelope: admin.envelope },
        kind: "disable-actor",
        organizationId: target.organizationId,
        actorId: target.actorId,
      };
      return runtime.command(command);
    };

    return { issue, refresh, disable };
  };

  return { world, expect, expectFailure };
};
