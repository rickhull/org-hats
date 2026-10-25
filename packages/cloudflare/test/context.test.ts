import { env } from "cloudflare:test";
import { AUTHORITY_INTERFACE_VERSION } from "org-hats/authority";
import { CONFORMANCE_PRINCIPALS } from "org-hats/conformance";
import { describe, expect, it } from "vitest";
import { createCloudflareConformanceWorld } from "../src/conformance";

describe("context presentation", () => {
  it("returns names, wearable hats, and the selected hat from both coordinators", async () => {
    const world = await createCloudflareConformanceWorld(env);
    const issued = await world.runtime.accessFromEvidence({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: "op-9f2e6ad4",
      evidence: CONFORMANCE_PRINCIPALS.dana.evidence,
    });
    if ("failure" in issued) throw new Error(`issuance failed: ${issued.failure.kind}`);

    const context = await world.runtime.context({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      envelope: issued.envelope,
    });
    if ("failure" in context) throw new Error(`context failed: ${context.failure.kind}`);

    expect(context.actor.displayName).toBe("Dana Okafor");
    expect(context.organizationDisplayName).toBe("Harbor Logistics");
    expect(context.operationDisplayName).toBe("Meridian Field Services");
    expect(context.participation).toBe("active");
    expect(context.wearableHats).toHaveLength(1);
    expect(context.wearableHats[0]?.role).toBe("coordinator");
    expect(context.selectedHat?.role).toBe("coordinator");
    expect(context.selectedHat?.primary).toBe(true);
    expect(context.sites.map((site) => site.siteId)).toEqual(["site-b8d620fa"]);
  }, 30_000);
});
