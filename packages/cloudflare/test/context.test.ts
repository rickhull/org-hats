import { env } from "cloudflare:test";
import { AUTHORITY_INTERFACE_VERSION, isFailed } from "org-hats/authority";
import { CONFORMANCE_PRINCIPALS } from "org-hats/conformance";
import { describe, expect, it } from "vitest";
import { createCloudflareConformanceWorld } from "../src/conformance";

describe("context presentation", () => {
  it("resolves the selected hat by grant, not by first role match", async () => {
    const world = await createCloudflareConformanceWorld(env);
    const sam = CONFORMANCE_PRINCIPALS.sam!;
    const len = CONFORMANCE_PRINCIPALS.len!;
    const issue = async (evidence: typeof sam.evidence) => {
      const issued = await world.runtime.accessFromEvidence({
        interfaceVersion: AUTHORITY_INTERFACE_VERSION,
        operationId: "op-9f2e6ad4",
        evidence,
      });
      if (isFailed(issued)) throw new Error(`issuance failed: ${issued.failure.kind}`);
      return issued;
    };

    // A second hat of the same role: sam holds field at the yard team;
    // the operation administrator grants field at the east site.
    const admin = await issue(len.evidence);
    const granted = await world.runtime.command({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      idempotencyKey: "grant-second-field",
      authorization: { kind: "access-envelope", envelope: admin.envelope },
      kind: "grant-hat",
      operationId: "op-9f2e6ad4",
      organizationId: "org-4c1f9a2e",
      actorId: sam.actorId,
      role: "field",
      target: { kind: "site", siteId: "site-e4a1c9b3" },
    });
    if (!granted.ok) throw new Error(`grant-hat failed: ${JSON.stringify(granted)}`);

    // Whatever the new grant's id sorts as, select the hat that is NOT
    // first in wearable order, so a first-match resolution cannot pass.
    const first = await issue(sam.evidence);
    const before = await world.runtime.context({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      envelope: first.envelope,
    });
    if (isFailed(before)) throw new Error(`context failed: ${before.failure.kind}`);
    expect(before.wearableHats).toHaveLength(2);
    const chosen = before.wearableHats[1]!;

    const selected = await world.runtime.command({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      idempotencyKey: "select-site-hat",
      authorization: { kind: "fresh-evidence", evidence: sam.evidence, operationId: "op-9f2e6ad4" },
      kind: "select-hat",
      operationId: "op-9f2e6ad4",
      grantId: chosen.grantId,
    });
    if (!selected.ok) throw new Error(`select-hat failed: ${JSON.stringify(selected)}`);

    const issued = await issue(sam.evidence);
    const context = await world.runtime.context({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      envelope: issued.envelope,
    });
    if (isFailed(context)) throw new Error(`context failed: ${context.failure.kind}`);

    expect(context.selectedHat?.grantId).toBe(chosen.grantId);
    expect(context.selectedHat?.target).toEqual(chosen.target);
    expect(context.selectedHat?.primary).toBe(true);
  }, 30_000);

  it("returns names, wearable hats, and the selected hat from both coordinators", async () => {
    const world = await createCloudflareConformanceWorld(env);
    const issued = await world.runtime.accessFromEvidence({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: "op-9f2e6ad4",
      evidence: CONFORMANCE_PRINCIPALS.dana.evidence,
    });
    if (isFailed(issued)) throw new Error(`issuance failed: ${issued.failure.kind}`);

    const context = await world.runtime.context({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      envelope: issued.envelope,
    });
    if (isFailed(context)) throw new Error(`context failed: ${context.failure.kind}`);

    expect(context.actor.displayName).toBe("Dana Okafor");
    expect(context.organizationLongName).toBe("Harbor Logistics");
    expect(context.operationLongName).toBe("Meridian Field Services");
    expect(context.participation).toBe("active");
    expect(context.wearableHats).toHaveLength(1);
    expect(context.wearableHats[0]?.role).toBe("coordinator");
    expect(context.wearableHats[0]?.grantId).toBe("g-mer-3");
    expect(context.wearableHats[0]?.targetDisplayName).toBe("Yard crew");
    expect(context.selectedHat?.role).toBe("coordinator");
    expect(context.selectedHat?.grantId).toBe("g-mer-3");
    expect(context.selectedHat?.primary).toBe(true);
    expect(context.selectedHat?.targetDisplayName).toBe("Yard crew");
    expect(context.sites.map((site) => site.siteId)).toEqual(["site-b8d620fa"]);
  }, 30_000);
});
