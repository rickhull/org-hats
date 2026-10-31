// The auth conformance family.

import { CONFORMANCE_PRINCIPALS, DANA_OKAFOR, FESTIVAL_OP, GATE, HARBOR_LOGISTICS, HARBOR_TEAM, IDP, MARCO, MERIDIAN, NORTH_ORG, NORTH_TEAM, WEST } from "./world.ts";
import { assert, command, deepEqual, envelopeAuth, equal, expectFailure, freshAuth, issue, verifyOk } from "./helpers.ts";
import { runtimeCase, type ConformanceCase } from "./case.ts";
import { AUTHORITY_INTERFACE_VERSION, actorId, isFailed, operationId, organizationId, siteId, teamId } from "../contract.ts";

export const AUTH_CASES: readonly ConformanceCase[] = [
  runtimeCase("OH-AUTH-01", "evidence issues a signed envelope; verification yields neutral access", async (world) => {
    const entry = CONFORMANCE_PRINCIPALS.dana;
    const issued = await issue(world, entry, MERIDIAN);
    equal(issued.refresh.kind, "rotated", "refresh outcome");
    const { envelope } = issued;
    const claims = envelope.claims;
    equal(claims.actor.organizationId, HARBOR_LOGISTICS, "actor organization");
    equal(claims.actor.actorId, DANA_OKAFOR, "actor id");
    equal(claims.hat.role, "coordinator", "worn role");
    deepEqual(claims.hat.teamIds, [HARBOR_TEAM], "hat team reach");
    deepEqual(claims.hat.siteIds, [], "hat site reach");
    deepEqual(claims.readableOrganizationIds, [HARBOR_LOGISTICS], "readable organizations");
    equal(claims.exp - claims.iat, 900, "bounded lifetime");
    const verified = await verifyOk(world, envelope, {
      now: claims.iat + 1,
      expectedOperationId: MERIDIAN,
      expectedSiteId: WEST,
    });
    equal(verified.access.mayAct("review", { kind: "team", teamId: HARBOR_TEAM }), true, "allow review on the reached team");
    equal(verified.access.mayAct("configure", { kind: "team", teamId: HARBOR_TEAM }), false, "deny configure");
    equal(verified.access.mayAct("review", { kind: "team", teamId: NORTH_TEAM }), false, "deny outside reach");
    equal(verified.access.mayAct("review", { kind: "operation" }), false, "nothing reaches the operation");
    deepEqual([...verified.access.readableOrganizationIds()], [HARBOR_LOGISTICS], "verified read reach");
  }),

  runtimeCase("OH-AUTH-02", "one organization actor wears different hats in two operations", async (world) => {
    const entry = CONFORMANCE_PRINCIPALS.dana;
    const meridian = await issue(world, entry, MERIDIAN);
    const fest = await issue(world, entry, FESTIVAL_OP);
    equal(meridian.envelope.claims.hat.role, "coordinator", "Meridian hat");
    equal(fest.envelope.claims.hat.role, "admin", "Festival hat");
    const meridianVerified = await verifyOk(world, meridian.envelope, {
      now: meridian.envelope.claims.iat + 1,
      expectedOperationId: MERIDIAN,
      expectedSiteId: WEST,
    });
    const festivalVerified = await verifyOk(world, fest.envelope, {
      now: fest.envelope.claims.iat + 1,
      expectedOperationId: FESTIVAL_OP,
      expectedSiteId: GATE,
    });
    equal(meridianVerified.access.mayAct("configure", { kind: "site", siteId: WEST }), false, "Meridian coordinator cannot configure");
    equal(festivalVerified.access.mayAct("configure", { kind: "site", siteId: GATE }), true, "Festival admin configures the gate");
    equal(festivalVerified.access.readableOrganizationIds().length, 3, "festival-wide read");
  }),

  runtimeCase("OH-AUTH-03", "unknown evidence is unauthenticated", async (world) => {
    const result = await world.runtime.accessFromEvidence({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: MERIDIAN,
      evidence: { provider: IDP, subject: "nobody" },
    });
    expectFailure(result, "unauthenticated", "unknown evidence");
  }),

  runtimeCase("OH-AUTH-04", "disable stops new issuance while the live envelope verifies to expiry", async (world) => {
    const sam = CONFORMANCE_PRINCIPALS.sam;
    const admin = await issue(world, CONFORMANCE_PRINCIPALS.dana, MERIDIAN);
    const live = await issue(world, sam, MERIDIAN);
    const disabled = await command(
      world,
      { kind: "disable-actor", organizationId: HARBOR_LOGISTICS, actorId: sam.actorId },
      envelopeAuth(admin.envelope),
      "conf-disable-sam",
    );
    assert(disabled.ok, `disable failed: ${disabled.ok ? "" : disabled.failure.kind}`);
    const stillLive = await verifyOk(world, live.envelope, {
      now: live.envelope.claims.iat + 1,
      expectedOperationId: MERIDIAN,
    });
    equal(stillLive.access.mayAct("observe", { kind: "team", teamId: HARBOR_TEAM }), true, "live envelope still verifies");
    const after = await world.runtime.accessFromEvidence({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: MERIDIAN,
      evidence: sam.evidence,
    });
    expectFailure(after, "not-admitted", "disabled actor cannot be issued");
  }),

  runtimeCase("OH-AUTH-05", "refresh rotates the handle; a superseded handle is dead", async (world) => {
    const first = await issue(world, CONFORMANCE_PRINCIPALS.dana, MERIDIAN);
    assert(first.refresh.kind === "rotated", "first issuance rotates a refresh handle");
    const second = await world.runtime.refresh({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: MERIDIAN,
      handle: first.refresh.handle,
    });
    if (isFailed(second)) throw new Error(`refresh failed: ${second.failure.kind}`);
    equal(second.refresh.kind, "rotated", "second refresh outcome");
    const replay = await world.runtime.refresh({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: MERIDIAN,
      handle: first.refresh.handle,
    });
    expectFailure(replay, "unauthenticated", "superseded handle");
    await verifyOk(world, second.envelope, {
      now: second.envelope.claims.iat + 1,
      expectedOperationId: MERIDIAN,
    });
  }),

  runtimeCase("OH-AUTH-06", "authentication method references ride the envelope and survive refresh", async (world) => {
    const entry = CONFORMANCE_PRINCIPALS.dana;
    const AUTH_TIME = 1_700_000_000;
    const withMethods = await world.runtime.accessFromEvidence({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: MERIDIAN,
      evidence: { ...entry.evidence, amr: ["hwk", "pin"], authTime: AUTH_TIME },
    });
    if (isFailed(withMethods)) {
      throw new Error(`issuance with methods failed: ${withMethods.failure.kind}`);
    }
    const issued = withMethods;
    deepEqual(issued.envelope.claims.amr, ["hwk", "pin"], "methods copied from evidence");
    equal(issued.envelope.claims.auth_time, AUTH_TIME, "authentication time copied from evidence");
    assert(issued.envelope.claims.auth_time !== issued.envelope.claims.iat, "authentication time is not envelope time");
    assert(issued.refresh.kind === "rotated", "issuance rotates a refresh handle");
    const renewedResult = await world.runtime.refresh({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: MERIDIAN,
      handle: issued.refresh.kind === "rotated" ? issued.refresh.handle : "",
    });
    if (isFailed(renewedResult)) throw new Error(`refresh failed: ${renewedResult.failure.kind}`);
    const renewed = renewedResult;
    deepEqual(renewed.envelope.claims.amr, ["hwk", "pin"], "refresh preserves the methods");
    equal(renewed.envelope.claims.auth_time, AUTH_TIME, "refresh preserves the authentication time");
    assert(renewed.envelope.claims.iat >= issued.envelope.claims.iat, "envelope time moves on");
    const contextResult = await world.runtime.context({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      envelope: renewed.envelope,
    });
    if (isFailed(contextResult)) throw new Error(`context failed: ${contextResult.failure.kind}`);
    const context = contextResult;
    deepEqual(context.amr, ["hwk", "pin"], "context surfaces the methods");
    equal(context.authTime, AUTH_TIME, "context surfaces the authentication time");
    const plain = await issue(world, entry, MERIDIAN);
    assert(!("amr" in plain.envelope.claims), "issuance without methods carries none");
    assert(!("auth_time" in plain.envelope.claims), "issuance without an authentication time carries none");
  }),

  runtimeCase("OH-AUTH-07", "wearable hats carry the grant id select-hat takes", async (world) => {
    const admin = await issue(world, CONFORMANCE_PRINCIPALS.len, MERIDIAN);
    const grant = await command(
      world,
      {
        kind: "grant-hat",
        operationId: MERIDIAN,
        organizationId: NORTH_ORG,
        actorId: MARCO,
        role: "reviewer",
        target: { kind: "team" as const, teamId: NORTH_TEAM },
      },
      envelopeAuth(admin.envelope),
      "auth-07-grant",
    );
    assert(grant.ok && grant.receipt.applied, "second hat granted");

    const issued = await issue(world, CONFORMANCE_PRINCIPALS.marco, MERIDIAN);
    const contextResult = await world.runtime.context({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      envelope: issued.envelope,
    });
    if (isFailed(contextResult)) throw new Error(`context failed: ${contextResult.failure.kind}`);
    const context = contextResult;
    equal(context.wearableHats.length, 2, "two wearable hats after the grant");
    const ids = context.wearableHats.map((hat) => hat.grantId);
    equal(new Set(ids).size, ids.length, "the grant ids are unique");
    assert(ids.includes("g-mer-2"), "the existing grant is listed");
    const reviewer = context.wearableHats.find((hat) => hat.role === "reviewer");
    assert(reviewer !== undefined, "the granted hat is listed");

    // the addressing round-trips: the id the context hands out is the id
    // the command takes, and the next envelope wears what it selected
    const select = await command(
      world,
      { kind: "select-hat", operationId: MERIDIAN, grantId: reviewer.grantId },
      freshAuth(CONFORMANCE_PRINCIPALS.marco, MERIDIAN),
      "auth-07-select",
    );
    assert(select.ok && select.receipt.applied, "select-hat accepts the listed grant id");
    const worn = await world.runtime.refresh({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: MERIDIAN,
      handle: issued.refresh.kind === "rotated" ? issued.refresh.handle : "",
    });
    if (isFailed(worn)) throw new Error(`refresh after select failed: ${worn.failure.kind}`);
    equal(worn.envelope.claims.hat.role, "reviewer", "the next envelope wears the selected hat");
  }),
];
