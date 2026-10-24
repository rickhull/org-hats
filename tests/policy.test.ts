// The policy-bundle vocabulary validates what the twins exercise and rejects
// what they do not.

import test from "node:test";
import assert from "node:assert/strict";

import type { PolicyBundle } from "../src/policy.ts";
import { validatePolicyBundle } from "../src/policy.ts";
import { FESTIVAL, PROFESSIONAL_OPERATION } from "../src/authority/twins.ts";

test("both twin bundles validate cleanly", () => {
  assert.deepEqual(validatePolicyBundle(PROFESSIONAL_OPERATION.policy), []);
  assert.deepEqual(validatePolicyBundle(FESTIVAL.policy), []);
});

test("the twins exercise both read policies", () => {
  assert.equal(PROFESSIONAL_OPERATION.policy.readPolicy.organizations, "granted-teams");
  assert.equal(FESTIVAL.policy.readPolicy.organizations, "all-participating");
});

const base: PolicyBundle = PROFESSIONAL_OPERATION.policy;

test("read policy is an axis structure, not a scalar", () => {
  assert.deepEqual(base.readPolicy, { organizations: "granted-teams" });
});

test("an unknown read policy axis fails closed", () => {
  const bundle = {
    ...base,
    readPolicy: { organizations: "granted-teams", teams: "audiences" },
  } as unknown as PolicyBundle;
  assert.ok(validatePolicyBundle(bundle).some((p) => p.includes("unknown axis")));
});

test("a role naming an unknown action is rejected", () => {
  const bundle = {
    ...base,
    roles: [...base.roles, { title: "rogue", actions: ["teleport"] }],
  };
  assert.ok(validatePolicyBundle(bundle).some((p) => p.includes("unknown action")));
});

test("a duplicate action in the vocabulary is rejected", () => {
  const bundle = { ...base, actions: [...base.actions, "observe"] };
  assert.ok(validatePolicyBundle(bundle).some((p) => p.includes("twice")));
});

test("an unknown read policy is rejected", () => {
  const bundle = { ...base, readPolicy: { organizations: "everyone-always" } };
  assert.ok(validatePolicyBundle(bundle).some((p) => p.includes("read policy")));
});

test("a wrong format number is rejected", () => {
  const bundle = { ...base, format: 2 };
  assert.ok(validatePolicyBundle(bundle).some((p) => p.includes("format")));
});
