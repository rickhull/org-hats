import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const increment = async (): Promise<number> => {
  const response = await SELF.fetch("http://example.com/increment");
  expect(response.status).toBe(200);
  const body = (await response.json()) as { count: number };
  return body.count;
};

describe("the workerd harness", () => {
  it("runs a request through a SQLite-backed Durable Object", async () => {
    // The plugin has no `isolatedStorage` option. Assert the durable delta
    // rather than a fresh-store absolute value, so the harness does not
    // depend on storage being reset between runs.
    const first = await increment();
    const second = await increment();
    expect(second).toBe(first + 1);
  });
});
