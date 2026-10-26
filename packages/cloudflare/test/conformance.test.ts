import { env } from "cloudflare:test";
import { CONFORMANCE_CASES, runConformance } from "org-hats/conformance";
import { describe, expect, it } from "vitest";
import { createCloudflareConformanceWorld } from "../src/conformance";

describe("the portable conformance inventory", () => {
  it("passes against the Cloudflare coordinators", async () => {
    const results = await runConformance(() => createCloudflareConformanceWorld(env));
    const failures = results.filter((result) => !result.ok);
    expect(failures.map((failure) => `${failure.id} ${failure.title}: ${failure.error ?? "failed"}`)).toEqual([]);
    expect(results.map((result) => result.id)).toEqual(CONFORMANCE_CASES.map((conformanceCase) => conformanceCase.id));
  }, 60_000);
});
