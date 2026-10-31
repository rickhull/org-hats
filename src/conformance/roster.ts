// The roster conformance family.

import { CONFORMANCE_PRINCIPALS, DANA_OKAFOR, HARBOR_LOGISTICS, HOME_OP, IDP, INVITEE_ACTOR, INVITEE_ORG, MERIDIAN } from "./world.ts";
import { assert, command, equal, expectFailure, freshAuth, issue } from "./helpers.ts";
import { runtimeCase, type ConformanceCase } from "./case.ts";
import { AUTHORITY_INTERFACE_VERSION, actorId, isFailed, operationId, organizationId } from "../contract.ts";

export const ROSTER_CASES: readonly ConformanceCase[] = [
  runtimeCase("OH-ROSTER-01", "an administrator creates an actor once, without a link", async (world) => {
    const admin = CONFORMANCE_PRINCIPALS.inviteeAdmin;
    const body = {
      kind: "create-actor" as const,
      organizationId: INVITEE_ORG,
      actorId: "actor-conformance-created",
      displayName: "Created Person",
    };
    const created = await command(world, body, freshAuth(admin, HOME_OP), "roster-01-create");
    assert(created.ok && created.receipt.applied, "the first creation applies");
    const replay = await command(world, body, freshAuth(admin, HOME_OP), "roster-01-create");
    assert(replay.ok && !replay.receipt.applied, "a retry replays its claim");

    const duplicate = await command(
      world,
      { kind: "create-actor", organizationId: INVITEE_ORG, actorId: "actor-conformance-created" },
      freshAuth(admin, HOME_OP),
      "roster-01-duplicate",
    );
    expectFailure(duplicate, "invalid-command", "a duplicate id");

    // creation binds no evidence: a plausible subject still resolves to nobody
    const unlinked = await world.runtime.accessFromEvidence({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: HOME_OP,
      evidence: { provider: IDP, subject: "created-person" },
    });
    expectFailure(unlinked, "unauthenticated", "creating an actor is not activation");
  }),

  runtimeCase("OH-ROSTER-02", "a display name is presentation: set, visible, cleared", async (world) => {
    const dana = CONFORMANCE_PRINCIPALS.dana;
    const set = await command(
      world,
      { kind: "update-actor", organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR, displayName: "Coordinator Renamed" },
      freshAuth(dana, MERIDIAN),
      "roster-02-set",
    );
    assert(set.ok, "the rename applies");

    const issued = await issue(world, dana, MERIDIAN);
    const shown = await world.runtime.context({ interfaceVersion: AUTHORITY_INTERFACE_VERSION, envelope: issued.envelope });
    if (isFailed(shown)) throw new Error(`context after rename: ${shown.failure.kind}`);
    equal(shown.actor.displayName, "Coordinator Renamed", "the context reads the current name");

    const cleared = await command(
      world,
      { kind: "update-actor", organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR, displayName: null },
      freshAuth(dana, MERIDIAN),
      "roster-02-clear",
    );
    assert(cleared.ok, "the clear applies");
    const hidden = await world.runtime.context({ interfaceVersion: AUTHORITY_INTERFACE_VERSION, envelope: issued.envelope });
    if (isFailed(hidden)) throw new Error(`context after clear: ${hidden.failure.kind}`);
    equal(hidden.actor.displayName, undefined, "the cleared name is absent");

    const empty = await command(
      world,
      { kind: "update-actor", organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR, displayName: "" },
      freshAuth(dana, MERIDIAN),
      "roster-02-empty",
    );
    expectFailure(empty, "invalid-command", "an empty display name");
  }),

  runtimeCase("OH-ROSTER-03", "an unclaimed successor does not permit retirement", async (world) => {
    const dana = CONFORMANCE_PRINCIPALS.dana;
    const created = await command(
      world,
      { kind: "create-actor", organizationId: HARBOR_LOGISTICS, actorId: "actor-roster-successor" },
      freshAuth(dana, MERIDIAN),
      "roster-03-create",
    );
    assert(created.ok, "the successor is created");
    const appointed = await command(
      world,
      { kind: "appoint-administrator", organizationId: HARBOR_LOGISTICS, actorId: "actor-roster-successor" },
      freshAuth(dana, MERIDIAN),
      "roster-03-appoint",
    );
    assert(appointed.ok, "an unclaimed successor may be appointed");
    const refused = await command(
      world,
      { kind: "retire-administrator", organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR },
      freshAuth(dana, MERIDIAN),
      "roster-03-retire",
    );
    expectFailure(refused, "denied", "no other usable administrator remains");
  }),

  runtimeCase("OH-ROSTER-04", "a linked successor takes over and the retired caller loses standing", async (world) => {
    const lead = CONFORMANCE_PRINCIPALS.inviteeLead;
    const admin = CONFORMANCE_PRINCIPALS.inviteeAdmin;
    const retired = await command(
      world,
      { kind: "retire-administrator", organizationId: INVITEE_ORG, actorId: INVITEE_ACTOR },
      freshAuth(lead, HOME_OP),
      "roster-04-retire",
    );
    assert(retired.ok, "a linked successor permits the retirement");

    const denied = await command(
      world,
      { kind: "create-actor", organizationId: INVITEE_ORG, actorId: "actor-roster-after" },
      freshAuth(lead, HOME_OP),
      "roster-04-after",
    );
    expectFailure(denied, "denied", "the retired caller no longer administers");

    const successor = await command(
      world,
      { kind: "create-actor", organizationId: INVITEE_ORG, actorId: "actor-roster-after" },
      freshAuth(admin, HOME_OP),
      "roster-04-successor",
    );
    assert(successor.ok, "the remaining administrator takes over");
  }),

  runtimeCase("OH-ROSTER-05", "disable remains the departing administrator's offboarding act", async (world) => {
    const dana = CONFORMANCE_PRINCIPALS.dana;
    const disabled = await command(
      world,
      { kind: "disable-actor", organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR },
      freshAuth(dana, MERIDIAN),
      "roster-05-disable",
    );
    assert(disabled.ok, "the last administrator may disable herself");
    const blocked = await world.runtime.accessFromEvidence({
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: MERIDIAN,
      evidence: dana.evidence,
    });
    expectFailure(blocked, "not-admitted", "a disabled actor issues nothing");
  }),
];
