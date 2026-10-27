/**
 * The documented service-binding smoke, as a workerd test asset.
 *
 * This is deliberately not `runConformance()`: it consumes a dedicated,
 * pre-bootstrapped operation, never resets it, and claims only the subset in
 * docs/binding-conformance.md.  The runtime calls go through the dependency
 * seam the host supplies; the verifier is `org-hats/access` with the
 * deployment's distributed key set.
 *
 * The runner is test-only.  It is not a published surface and carries no
 * host name, address, or fixture.
 */

import {
  verify,
  verificationKeysFrom,
  type Failure,
} from "org-hats/access";
import {
  AUTHORITY_INTERFACE_VERSION,
  type AuthorityRuntime,
  type PrincipalEvidence,
} from "org-hats/authority";

export interface AuthoritySmokeInput {
  readonly operationId: string;
  readonly siteId: string;
  readonly teamId: string;
  readonly otherOperationId: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly evidence: PrincipalEvidence;
}

export interface AuthoritySmokeDeps {
  readonly runtime: AuthorityRuntime;
  readonly keySet: string;
  readonly operationStatus: () => Promise<{ readonly disabledOrgActors?: number }>;
  /** Direct organization disable, without the runtime's post-command drain.
   * That is what leaves the operation projection stale for the final case. */
  readonly disableActor: (input: {
    readonly organizationId: string;
    readonly actorId: string;
    readonly byActorId: string;
  }) => Promise<{ readonly ok: boolean; readonly detail?: string }>;
  readonly now?: () => number;
}

export interface SmokeCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface SmokeReport {
  readonly ok: boolean;
  readonly checks: readonly SmokeCheck[];
  readonly failure?: Failure;
}

const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

export function validateAuthoritySmokeInput(value: unknown): AuthoritySmokeInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("the smoke input must be an object");
  }
  const body = value as Record<string, unknown>;
  for (const field of ["operationId", "siteId", "teamId", "otherOperationId", "organizationId", "actorId"]) {
    if (!isId(body[field])) throw new Error(`${field} must be a deployment id`);
  }
  const evidence = body.evidence;
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("evidence must be an object");
  }
  const candidate = evidence as Record<string, unknown>;
  if (typeof candidate.provider !== "string" || candidate.provider.length === 0) {
    throw new Error("evidence.provider is required");
  }
  if (typeof candidate.subject !== "string" || candidate.subject.length === 0) {
    throw new Error("evidence.subject is required");
  }
  if (body.operationId === body.otherOperationId) {
    throw new Error("otherOperationId must differ from operationId");
  }
  return {
    operationId: body.operationId as string,
    siteId: body.siteId as string,
    teamId: body.teamId as string,
    otherOperationId: body.otherOperationId as string,
    organizationId: body.organizationId as string,
    actorId: body.actorId as string,
    evidence: {
      provider: candidate.provider,
      subject: candidate.subject,
    },
  };
}

const failureReport = (checks: readonly SmokeCheck[], failure: Failure): SmokeReport => ({
  ok: false,
  checks,
  failure,
});

const failureKind = (value: unknown): string | undefined => {
  if (value === null || typeof value !== "object") return undefined;
  const failure = (value as { failure?: { kind?: unknown } }).failure;
  return typeof failure?.kind === "string" ? failure.kind : undefined;
};

export async function runAuthoritySmoke(
  input: AuthoritySmokeInput,
  deps: AuthoritySmokeDeps,
): Promise<SmokeReport> {
  const checks: SmokeCheck[] = [];
  const pass = (name: string, detail?: string): void => {
    checks.push({ name, ok: true, ...(detail === undefined ? {} : { detail }) });
  };
  const fail = (name: string, failure: Failure): SmokeReport => {
    checks.push({ name, ok: false, detail: failure.detail ?? failure.kind });
    return failureReport(checks, failure);
  };
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  let keys;
  try {
    keys = await verificationKeysFrom(deps.keySet);
  } catch (error) {
    return fail("keys", { kind: "invalid-command", detail: String((error as Error).message ?? error) });
  }

  // 1. Issue from the linked principal's evidence.
  const issued = await deps.runtime.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: input.operationId,
    evidence: input.evidence,
  });
  if ("failure" in issued) return fail("issue", issued.failure);
  if (issued.refresh.kind !== "rotated") {
    return fail("issue-refresh", { kind: "invalid-command", detail: "issuance did not rotate a refresh handle" });
  }
  const first = issued.envelope;
  const firstHandle = issued.refresh.handle;
  const issuedCheck = await verify(first, keys, {
    now: now(),
    expectedOperationId: input.operationId,
    expectedSiteId: input.siteId,
  });
  if ("failure" in issuedCheck) return fail("verify-issued", issuedCheck.failure);
  if (issuedCheck.claims.actor.actorId !== input.actorId) {
    return fail("verify-issued-actor", { kind: "wrong-binding", detail: "the envelope names another actor" });
  }
  pass("issue-and-verify");

  // 2. Refresh, verify the replacement, and replay the old handle.
  const refreshed = await deps.runtime.refresh({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: input.operationId,
    handle: firstHandle,
  });
  if ("failure" in refreshed) return fail("refresh", refreshed.failure);
  if (refreshed.refresh.kind !== "rotated") {
    return fail("refresh-rotation", { kind: "invalid-command", detail: "refresh did not rotate a handle" });
  }
  const refreshedCheck = await verify(refreshed.envelope, keys, {
    now: now(),
    expectedOperationId: input.operationId,
    expectedSiteId: input.siteId,
  });
  if ("failure" in refreshedCheck) return fail("verify-refreshed", refreshedCheck.failure);

  const replayed = await deps.runtime.refresh({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: input.operationId,
    handle: firstHandle,
  });
  if (failureKind(replayed) !== "unauthenticated") {
    return fail("replay-old-handle", { kind: "invalid-command", detail: "the superseded handle was accepted" });
  }
  pass("refresh-and-supersede");

  // 3. Presentation context.
  const context = await deps.runtime.context({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    envelope: refreshed.envelope,
  });
  if ("failure" in context) return fail("context", context.failure);
  if (
    context.operationId !== input.operationId ||
    context.actor.actorId !== input.actorId ||
    !context.sites.some((site) => site.siteId === input.siteId) ||
    context.wearableHats.length === 0 ||
    context.selectedHat === undefined
  ) {
    return fail("context-facts", { kind: "wrong-binding", detail: "context omitted the dedicated actor, site, or hat" });
  }
  pass("context");

  // 4. A valid command the policy refuses, authorized by the non-admin actor.
  const denied = await deps.runtime.command({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    idempotencyKey: `authority-smoke-denied-${input.actorId}`,
    authorization: { kind: "access-envelope", envelope: refreshed.envelope },
    kind: "grant-hat",
    operationId: input.operationId,
    organizationId: input.organizationId,
    actorId: input.actorId,
    role: "field",
    target: { kind: "team", teamId: input.teamId },
  });
  if (denied.ok !== false || denied.failure.kind !== "denied") {
    return fail("denied-command", { kind: "invalid-command", detail: "the non-admin grant was not denied" });
  }
  pass("denied-command");

  // 5. Wrong operation and expired envelope.
  const wrong = await verify(refreshed.envelope, keys, {
    now: now(),
    expectedOperationId: input.otherOperationId,
    expectedSiteId: input.siteId,
  });
  if (failureKind(wrong) !== "wrong-binding") {
    return fail("wrong-operation", { kind: "wrong-binding", detail: "wrong-operation verification did not fail wrong-binding" });
  }
  const expired = await verify(refreshed.envelope, keys, {
    now: refreshed.envelope.claims.exp,
    expectedOperationId: input.operationId,
    expectedSiteId: input.siteId,
  });
  if (failureKind(expired) !== "expired") {
    return fail("expired", { kind: "expired", detail: "an envelope at exp did not fail expired" });
  }
  pass("wrong-binding-and-expired");

  // 6. Disable at the organization directly, without the runtime command's
  //    post-drain.  The operation projection stays enabled; the live
  //    organization read must make refresh refuse.
  const disabled = await deps.disableActor({
    organizationId: input.organizationId,
    actorId: input.actorId,
    byActorId: input.actorId,
  });
  if (!disabled.ok) {
    return fail("disable-actor", { kind: "unavailable", detail: disabled.detail ?? "organization refused the disable" });
  }
  const status = await deps.operationStatus();
  if (status.disabledOrgActors !== 0) {
    return fail("stale-projection", {
      kind: "invalid-command",
      detail: "the operation projection already saw the disable; the stale case was not exercised",
    });
  }
  const rejected = await deps.runtime.refresh({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: input.operationId,
    handle: refreshed.refresh.handle,
  });
  if (failureKind(rejected) !== "not-admitted") {
    return fail("disabled-refresh", {
      kind: "not-admitted",
      detail: "refresh from a disabled actor did not fail not-admitted",
    });
  }
  pass("stale-projection-refresh");

  return { ok: true, checks };
}
