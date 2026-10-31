// The access conformance family.

import { CONFORMANCE_PRINCIPALS, EAST, FESTIVAL_OP, MERIDIAN, WEST } from "./world.ts";
import { assert, expectFailure, issue, verifyOk } from "./helpers.ts";
import { runtimeCase, type ConformanceCase } from "./case.ts";
import { isFailed, organizationId, type SignedAccessEnvelope } from "../contract.ts";
import { verify } from "../access/verify.ts";

export const ACCESS_CASES: readonly ConformanceCase[] = [
  runtimeCase("OH-ACCESS-01", "wrong operation or site binding fails closed", async (world) => {
    const issued = await issue(world, CONFORMANCE_PRINCIPALS.dana, MERIDIAN);
    const now = issued.envelope.claims.iat + 1;
    const wrongOperation = await verify(issued.envelope, world.keys, {
      now,
      expectedOperationId: FESTIVAL_OP,
    });
    expectFailure(wrongOperation, "wrong-binding", "wrong operation");
    const wrongSite = await verify(issued.envelope, world.keys, {
      now,
      expectedOperationId: MERIDIAN,
      expectedSiteId: EAST,
    });
    expectFailure(wrongSite, "wrong-binding", "wrong site");
    await verifyOk(world, issued.envelope, { now, expectedOperationId: MERIDIAN, expectedSiteId: WEST });
  }),

  runtimeCase("OH-ACCESS-02", "expiry is bounded and fails closed", async (world) => {
    const issued = await issue(world, CONFORMANCE_PRINCIPALS.dana, MERIDIAN);
    const before = await verify(issued.envelope, world.keys, {
      now: issued.envelope.claims.exp - 1,
      expectedOperationId: MERIDIAN,
    });
    assert(!isFailed(before), "one second before expiry verifies");
    const at = await verify(issued.envelope, world.keys, {
      now: issued.envelope.claims.exp,
      expectedOperationId: MERIDIAN,
    });
    expectFailure(at, "expired", "at expiry");
  }),

  runtimeCase("OH-ACCESS-03", "unknown keys and tampered claims are invalid signatures", async (world) => {
    const issued = await issue(world, CONFORMANCE_PRINCIPALS.dana, MERIDIAN);
    const now = issued.envelope.claims.iat + 1;
    const unknown = await verify(issued.envelope, new Map(), { now, expectedOperationId: MERIDIAN });
    expectFailure(unknown, "invalid-signature", "unknown key id");
    const tampered: SignedAccessEnvelope = {
      ...issued.envelope,
      claims: { ...issued.envelope.claims, readableOrganizationIds: [organizationId("org-everything")] },
    };
    const bad = await verify(tampered, world.keys, { now, expectedOperationId: MERIDIAN });
    expectFailure(bad, "invalid-signature", "tampered claims");
  }),

  runtimeCase("OH-ACCESS-04", "the envelope version pair gates reading; the interface version is provenance", async (world) => {
    const issued = await issue(world, CONFORMANCE_PRINCIPALS.dana, MERIDIAN);
    const now = issued.envelope.claims.iat + 1;
    const wrongEnvelopeVersion: SignedAccessEnvelope = { ...issued.envelope, v: 2 as never };
    expectFailure(await verify(wrongEnvelopeVersion, world.keys, { now }), "wrong-interface-version", "envelope version");
    const wrongFormat: SignedAccessEnvelope = { ...issued.envelope, format: "not-ours" as never };
    expectFailure(await verify(wrongFormat, world.keys, { now }), "wrong-interface-version", "envelope format");
    const wrongClaimsVersion: SignedAccessEnvelope = {
      ...issued.envelope,
      claims: { ...issued.envelope.claims, v: 2 as never },
    };
    expectFailure(await verify(wrongClaimsVersion, world.keys, { now }), "wrong-interface-version", "claims version");

    // The claims also record which interface issued them, and that is
    // provenance, not a gate. Editing it after signing must therefore reach
    // the signature check rather than be rejected as a version: an envelope
    // outlives the call signatures that produced it. A genuinely re-signed
    // envelope with a different interface version still reads;
    // tests/access.test.ts covers that, since this inventory holds no issuer
    // key with which to re-sign.
    const differentInterface: SignedAccessEnvelope = {
      ...issued.envelope,
      // interface 1 was the previous call surface; this runtime declares 2.
      // The claims field is provenance (`IssuerInterfaceVersion`), so a
      // historical literal needs no cast.
      claims: { ...issued.envelope.claims, interfaceVersion: 1 },
    };
    expectFailure(await verify(differentInterface, world.keys, { now }), "invalid-signature", "interface version is not a version gate");
  }),
];
