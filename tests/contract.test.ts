// M1 tests: the envelope contract's executable half — canonical JSON is the
// encoding both issuer and verifier will call (M3/M4); determinism is the
// property that makes signatures stable across implementations.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ACCESS_ENVELOPE_FORMAT,
  ACCESS_ENVELOPE_VERSION,
  AUTHORITY_INTERFACE_VERSION,
  base64UrlDecode,
  base64UrlEncode,
  canonicalJson,
} from "../src/contract.ts";

test("canonicalJson is independent of key order, recursively", () => {
  const a = canonicalJson({ b: 1, a: { d: [3, { z: null, c: true }], e: "x" } });
  const b = canonicalJson({ a: { e: "x", d: [3, { z: null, c: true }] }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"d":[3,{"c":true,"z":null}],"e":"x"},"b":1}');
});

test("array order is semantic — canonicalJson does not sort arrays", () => {
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test("canonicalJson renders scalars, arrays, and nesting without whitespace", () => {
  assert.equal(canonicalJson(null), "null");
  assert.equal(canonicalJson(true), "true");
  assert.equal(canonicalJson(42), "42");
  assert.equal(canonicalJson("s"), '"s"');
  assert.equal(canonicalJson([1, "two", false]), '[1,"two",false]');
  assert.equal(canonicalJson({}), "{}");
  assert.equal(canonicalJson([]), "[]");
});

test("the format constants are stable strings — changing one is a format change", () => {
  assert.equal(ACCESS_ENVELOPE_FORMAT, "org-hats.access");
  assert.equal(ACCESS_ENVELOPE_VERSION, 1);
  assert.equal(AUTHORITY_INTERFACE_VERSION, 1);
});

test("signature transport is unpadded base64url and round-trips", () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const encoded = base64UrlEncode(bytes);
  assert.doesNotMatch(encoded, /[+/=]/);
  assert.deepEqual(base64UrlDecode(encoded), bytes);
});
