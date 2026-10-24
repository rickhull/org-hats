// M0 smoke: the fence placeholders exist, compile, and load.
//
// The real suites arrive with M2 and later (plans/v1.md); this file proves
// the node:test harness runs inside bin/check and that the portable modules
// stay loadable without node-only or Cloudflare types.

import test from "node:test";
import assert from "node:assert/strict";

test("the authority and access modules load inside the portable fence", async () => {
  await import("../src/authority/index.ts");
  await import("../src/access/index.ts");
  assert.ok(true, "both placeholder modules resolve");
});
