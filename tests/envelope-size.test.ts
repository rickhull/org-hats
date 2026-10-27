// The carriage boundary, measured on the synthetic envelopes.
//
// `docs/consumer-session.md` states the size table and the host budget.  A
// fixture or envelope-shape change must move the document and this test in
// the same commit, or the host budget stops describing a real envelope.

import test from "node:test";
import assert from "node:assert/strict";

import { AUTHORITY_INTERFACE_VERSION } from "../src/contract.ts";
import { createInMemoryAuthority } from "../src/authority/engine.ts";
import { FESTIVAL, MERIDIAN } from "../src/authority/twins.ts";
import { CONFORMANCE_PRINCIPALS, CONFORMANCE_WORLD } from "../src/conformance.ts";

const HOST_BUDGET = 3_800;

const FESTIVAL_OPERATION = FESTIVAL.snapshot.operations[0]?.operationId;
if (FESTIVAL_OPERATION === undefined) throw new Error("the festival twin has no operation");

interface Size {
  readonly json: number;
  readonly encoded: number;
}

const sizes = async (): Promise<ReadonlyMap<string, Size>> => {
  const handle = await createInMemoryAuthority({
    fixtures: CONFORMANCE_WORLD.fixtures,
    principalLinks: CONFORMANCE_WORLD.principalLinks,
    orgAdmins: CONFORMANCE_WORLD.orgAdmins,
  });

  const measure = async (label: string, operationId: string, principal: string): Promise<[string, Size]> => {
    const evidence = CONFORMANCE_PRINCIPALS[principal as keyof typeof CONFORMANCE_PRINCIPALS]?.evidence;
    if (evidence === undefined) throw new Error(`no principal ${principal}`);
    const issued = await handle.runtime.accessFromEvidence({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId,
      evidence,
    });
    if ("failure" in issued) throw new Error(`${label} failed to issue: ${issued.failure.kind}`);
    const json = JSON.stringify(issued.envelope);
    return [label, { json: json.length, encoded: encodeURIComponent(json).length }];
  };

  return new Map([
    await measure("dana/meridian", MERIDIAN, "dana"),
    await measure("dana/festival", FESTIVAL_OPERATION, "dana"),
    await measure("iris/festival", FESTIVAL_OPERATION, "iris"),
  ]);
};

test("the documented carriage sizes match the synthetic envelopes", async () => {
  const measured = await sizes();
  assert.deepEqual(measured.get("dana/meridian"), { json: 600, encoded: 904 });
  assert.deepEqual(measured.get("dana/festival"), { json: 706, encoded: 1054 });
  assert.deepEqual(measured.get("iris/festival"), { json: 5_723, encoded: 7_843 });
});

test("the host budget covers the professional envelopes and not the festival's site reach", async () => {
  const measured = await sizes();
  const meridian = measured.get("dana/meridian");
  const festival = measured.get("iris/festival");
  assert.ok(meridian !== undefined && festival !== undefined);
  assert.ok(meridian.encoded < HOST_BUDGET, "a professional coordinator must fit the cookie budget");
  assert.ok(festival.encoded > HOST_BUDGET, "the festival's site-wide reach is why the host refuses at issuance");
  assert.ok(festival.encoded >= festival.json, "the encoded value is what the host measures");
});
