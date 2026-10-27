// The documented binding smoke against the real coordinators.
//
// The fixture is the conformance world's Professional Operation: one
// operation-local hat, one organization administrator who is not an
// operation administrator, and a second operation for the wrong-binding
// case.  The runner consumes a pre-bootstrapped operation and never resets
// it, so this suite bootstraps once and runs the six groups in order.

import { env } from "cloudflare:test";
import { CONFORMANCE_PRINCIPALS, CONFORMANCE_WORLD } from "org-hats/conformance";
import { describe, expect, it } from "vitest";
import { createCloudflareConformanceWorld } from "../src/conformance";
import {
  createCloudflareRuntime,
  createEphemeralSigner,
  serializedVerificationKeys,
  verificationKeyOf,
} from "../src/runtime";
import {
  runAuthoritySmoke,
  validateAuthoritySmokeInput,
  type AuthoritySmokeDeps,
} from "./binding-smoke";
import { call } from "./helpers";

const MERIDIAN = "op-9f2e6ad4";
const FESTIVAL = "op-61a8e3f2";
const WEST = "site-b8d620fa";
const YARD_TEAM = "team-2e8c64b9";
const HARBOR = "org-4c1f9a2e";
const DANA = "actor-8d3b77c1";

const organizationIds = [...new Set(
  CONFORMANCE_WORLD.fixtures.flatMap((fixture) =>
    fixture.snapshot.organizations.map((organization) => organization.organizationId),
  ),
)];

describe("the binding conformance smoke", () => {
  it("passes the six documented groups", async () => {
    // Bootstrap through the coordinators, then sign with a key whose public
    // half is the set the verifier receives.
    await createCloudflareConformanceWorld(env);
    const signer = await createEphemeralSigner();
    const key = await verificationKeyOf(signer);
    const runtime = createCloudflareRuntime({
      env,
      signer,
      keys: new Map([[key.keyId, key]]),
      organizationIds,
    });

    const operationStub = env.OPERATION.get(env.OPERATION.idFromName(MERIDIAN));
    const deps: AuthoritySmokeDeps = {
      runtime,
      keySet: await serializedVerificationKeys(env, signer),
      operationStatus: async () => {
        const result = await call<Record<string, unknown>>(operationStub, "GET", "/status");
        const disabled = result.body.value?.["disabledOrgActors"];
        return typeof disabled === "number" ? { disabledOrgActors: disabled } : {};
      },
      disableActor: async ({ organizationId, actorId, byActorId }) => {
        const stub = env.ORGANIZATION.get(env.ORGANIZATION.idFromName(organizationId));
        const result = await call<{ applied: boolean }>(stub, "POST", "/disable", {
          actorId,
          byActorId,
          idempotencyKey: `binding-smoke-disable-${actorId}`,
        });
        const detail = result.body.failure?.detail ?? result.body.failure?.kind;
        return result.body.ok
          ? { ok: true }
          : { ok: false, ...(detail === undefined ? {} : { detail }) };
      },
    };

    const input = validateAuthoritySmokeInput({
      operationId: MERIDIAN,
      siteId: WEST,
      teamId: YARD_TEAM,
      otherOperationId: FESTIVAL,
      organizationId: HARBOR,
      actorId: DANA,
      evidence: CONFORMANCE_PRINCIPALS.dana.evidence,
    });

    const report = await runAuthoritySmoke(input, deps);
    expect(report.failure).toBeUndefined();
    expect(report.checks.map((check) => `${check.ok ? "ok" : "fail"} ${check.name}`)).toEqual([
      "ok issue-and-verify",
      "ok refresh-and-supersede",
      "ok context",
      "ok denied-command",
      "ok wrong-binding-and-expired",
      "ok stale-projection-refresh",
    ]);
    expect(report.ok).toBe(true);
  }, 30_000);
});
