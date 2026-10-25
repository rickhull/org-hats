// A resolution smoke test: the node:test harness runs inside bin/check and
// the portable modules stay loadable under it. This is not the fence —
// the fence is bin/check's `types: []` compile; this file proves the
// modules resolve at runtime in the portable harness.

import test from "node:test";
import assert from "node:assert/strict";

test("the authority and access modules load inside the portable fence", async () => {
  const authority = await import("../src/authority/index.ts");
  const access = await import("../src/access/index.ts");
  assert.equal(typeof authority.createInMemoryAuthority, "function");
  assert.equal(typeof access.verify, "function");
});
