// The policy-bundle vocabulary validates what the twins exercise and rejects
// what they do not.

import test from "node:test";
import assert from "node:assert/strict";

import type { PolicyBundle } from "../src/policy.ts";
import { validatePolicyBundle } from "../src/policy.ts";
import { FESTIVAL, PROFESSIONAL_OPERATION } from "../src/authority/twins.ts";
import { uncheckedPolicy } from "./helpers.ts";

test("both twin bundles validate cleanly", () => {
  assert.deepEqual(validatePolicyBundle(PROFESSIONAL_OPERATION.policy), []);
  assert.deepEqual(validatePolicyBundle(FESTIVAL.policy), []);
});

// The twins' read policies differ on purpose: this suite and the inventory
// exercise both axes of the organization read policy through them.
test("the twins exercise both read policies", () => {
  assert.equal(PROFESSIONAL_OPERATION.policy.readPolicy.organizations, "granted-teams");
  assert.equal(FESTIVAL.policy.readPolicy.organizations, "all-participating");
});

const base: PolicyBundle = PROFESSIONAL_OPERATION.policy;

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
  const bundle = uncheckedPolicy({ ...base, readPolicy: { organizations: "everyone-always" } });
  assert.ok(validatePolicyBundle(bundle).some((p) => p.includes("read policy")));
});

test("a wrong format number is rejected", () => {
  const bundle = uncheckedPolicy({ ...base, format: 2 });
  assert.ok(validatePolicyBundle(bundle).some((p) => p.includes("format")));
});

test("a role with no actions is rejected", () => {
  const bundle = {
    ...base,
    roles: [...base.roles, { title: "empty", actions: [] }],
  };
  assert.ok(validatePolicyBundle(bundle).some((p) => p.includes("carries no action")));
});

test("an empty role title is rejected", () => {
  const bundle = {
    ...base,
    roles: [...base.roles, { title: "", actions: ["observe"] }],
  };
  assert.ok(validatePolicyBundle(bundle).some((p) => p.includes("has no title")));
});

test("a duplicate role title is rejected", () => {
  const bundle = {
    ...base,
    roles: [...base.roles, { title: base.roles[0]!.title, actions: ["observe"] }],
  };
  assert.ok(validatePolicyBundle(bundle).some((p) => p.includes("appears twice")));
});

test("a missing read policy is rejected", () => {
  const bundle = uncheckedPolicy({ ...base, readPolicy: undefined });
  assert.ok(validatePolicyBundle(bundle).some((p) => p.includes("read policy is missing")));
});
