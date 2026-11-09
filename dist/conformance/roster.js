// The roster conformance family.
import { CONFORMANCE_PRINCIPALS, DANA_OKAFOR, HARBOR_LOGISTICS, HOME_OP, IDP, INVITEE_ACTOR, INVITEE_ORG, MERIDIAN } from "./world.js";
import { assert, command, deepEqual, equal, expectFailure, freshAuth, issue } from "./helpers.js";
import { runtimeCase } from "./case.js";
import { AUTHORITY_INTERFACE_VERSION, actorId, isFailed, operationId, organizationId } from "../contract.js";
export const ROSTER_CASES = [
    runtimeCase("OH-ROSTER-01", "an administrator creates an actor once, without a link", async (world) => {
        const admin = CONFORMANCE_PRINCIPALS.inviteeAdmin;
        const body = {
            kind: "create-actor",
            organizationId: INVITEE_ORG,
            actorId: "actor-conformance-created",
            displayName: "Created Person",
        };
        const created = await command(world, body, freshAuth(admin, HOME_OP), "roster-01-create");
        assert(created.ok && created.receipt.applied, "the first creation applies");
        const replay = await command(world, body, freshAuth(admin, HOME_OP), "roster-01-create");
        assert(replay.ok && !replay.receipt.applied, "a retry replays its claim");
        const duplicate = await command(world, { kind: "create-actor", organizationId: INVITEE_ORG, actorId: "actor-conformance-created" }, freshAuth(admin, HOME_OP), "roster-01-duplicate");
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
        const set = await command(world, { kind: "update-actor", organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR, displayName: "Coordinator Renamed" }, freshAuth(dana, MERIDIAN), "roster-02-set");
        assert(set.ok, "the rename applies");
        const issued = await issue(world, dana, MERIDIAN);
        const shown = await world.runtime.context({ interfaceVersion: AUTHORITY_INTERFACE_VERSION, envelope: issued.envelope });
        if (isFailed(shown))
            throw new Error(`context after rename: ${shown.failure.kind}`);
        equal(shown.actor.displayName, "Coordinator Renamed", "the context reads the current name");
        const cleared = await command(world, { kind: "update-actor", organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR, displayName: null }, freshAuth(dana, MERIDIAN), "roster-02-clear");
        assert(cleared.ok, "the clear applies");
        const hidden = await world.runtime.context({ interfaceVersion: AUTHORITY_INTERFACE_VERSION, envelope: issued.envelope });
        if (isFailed(hidden))
            throw new Error(`context after clear: ${hidden.failure.kind}`);
        equal(hidden.actor.displayName, undefined, "the cleared name is absent");
        const empty = await command(world, { kind: "update-actor", organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR, displayName: "" }, freshAuth(dana, MERIDIAN), "roster-02-empty");
        expectFailure(empty, "invalid-command", "an empty display name");
    }),
    runtimeCase("OH-ROSTER-03", "an unclaimed successor does not permit retirement", async (world) => {
        const dana = CONFORMANCE_PRINCIPALS.dana;
        const created = await command(world, { kind: "create-actor", organizationId: HARBOR_LOGISTICS, actorId: "actor-roster-successor" }, freshAuth(dana, MERIDIAN), "roster-03-create");
        assert(created.ok, "the successor is created");
        const appointed = await command(world, { kind: "appoint-administrator", organizationId: HARBOR_LOGISTICS, actorId: "actor-roster-successor" }, freshAuth(dana, MERIDIAN), "roster-03-appoint");
        assert(appointed.ok, "an unclaimed successor may be appointed");
        const refused = await command(world, { kind: "retire-administrator", organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR }, freshAuth(dana, MERIDIAN), "roster-03-retire");
        expectFailure(refused, "denied", "no other usable administrator remains");
    }),
    runtimeCase("OH-ROSTER-04", "a linked successor takes over and the retired caller loses standing", async (world) => {
        const lead = CONFORMANCE_PRINCIPALS.inviteeLead;
        const admin = CONFORMANCE_PRINCIPALS.inviteeAdmin;
        const retired = await command(world, { kind: "retire-administrator", organizationId: INVITEE_ORG, actorId: INVITEE_ACTOR }, freshAuth(lead, HOME_OP), "roster-04-retire");
        assert(retired.ok, "a linked successor permits the retirement");
        const denied = await command(world, { kind: "create-actor", organizationId: INVITEE_ORG, actorId: "actor-roster-after" }, freshAuth(lead, HOME_OP), "roster-04-after");
        expectFailure(denied, "denied", "the retired caller no longer administers");
        const successor = await command(world, { kind: "create-actor", organizationId: INVITEE_ORG, actorId: "actor-roster-after" }, freshAuth(admin, HOME_OP), "roster-04-successor");
        assert(successor.ok, "the remaining administrator takes over");
    }),
    runtimeCase("OH-ROSTER-05", "disable remains the departing administrator's offboarding act", async (world) => {
        const dana = CONFORMANCE_PRINCIPALS.dana;
        const disabled = await command(world, { kind: "disable-actor", organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR }, freshAuth(dana, MERIDIAN), "roster-05-disable");
        assert(disabled.ok, "the last administrator may disable herself");
        const blocked = await world.runtime.accessFromEvidence({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            operationId: MERIDIAN,
            evidence: dana.evidence,
        });
        expectFailure(blocked, "not-admitted", "a disabled actor issues nothing");
    }),
    runtimeCase("OH-ROSTER-06", "the roster read lists the organization's actors, claimed or not", async (world) => {
        const dana = CONFORMANCE_PRINCIPALS.dana;
        const created = await command(world, { kind: "create-actor", organizationId: HARBOR_LOGISTICS, actorId: "actor-roster-wide", displayName: "No Grant At All" }, freshAuth(dana, MERIDIAN), "roster-06-create");
        assert(created.ok, "the actor is created");
        const issued = await issue(world, dana, MERIDIAN);
        const read = await world.runtime.roster({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            envelope: issued.envelope,
        });
        if (isFailed(read))
            throw new Error(`the administrator reads: ${read.failure.kind}`);
        equal(read.organizationId, HARBOR_LOGISTICS, "the read is scoped to the envelope's organization");
        deepEqual(read.actors.map((actor) => [actor.actorId, actor.displayName, actor.disabled]), [
            ["actor-3a91c4d8", "Sam Whitfield", false],
            ["actor-8d3b77c1", "Dana Okafor", false],
            ["actor-roster-wide", "No Grant At All", false],
        ], "the roster is organization-wide: the linked member, the administrator, and an actor with no grant and no participation");
        deepEqual(read.teams.map((team) => [team.teamId, team.displayName, team.status]), [["team-2e8c64b9", "Yard crew", "active"]], "the teams are the organization's own in the envelope's operation — not another organization's");
    }),
    runtimeCase("OH-ROSTER-07", "the roster read is standing-gated, and the context states standing", async (world) => {
        const sam = CONFORMANCE_PRINCIPALS.sam;
        const samIssued = await issue(world, sam, MERIDIAN);
        const refused = await world.runtime.roster({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            envelope: samIssued.envelope,
        });
        expectFailure(refused, "denied", "a member without standing cannot read the roster");
        const samShown = await world.runtime.context({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            envelope: samIssued.envelope,
        });
        if (isFailed(samShown))
            throw new Error(`context for the member: ${samShown.failure.kind}`);
        equal(samShown.administrator, false, "the member's context states no standing");
        const dana = CONFORMANCE_PRINCIPALS.dana;
        const danaShown = await world.runtime.context({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            envelope: (await issue(world, dana, MERIDIAN)).envelope,
        });
        if (isFailed(danaShown))
            throw new Error(`context for the administrator: ${danaShown.failure.kind}`);
        equal(danaShown.administrator, true, "the administrator's context states standing");
    }),
    runtimeCase("OH-ROSTER-08", "a retired administrator's envelope reads standing live and is refused", async (world) => {
        const dana = CONFORMANCE_PRINCIPALS.dana;
        const sam = CONFORMANCE_PRINCIPALS.sam;
        const danaIssued = await issue(world, dana, MERIDIAN);
        const appointed = await command(world, { kind: "appoint-administrator", organizationId: HARBOR_LOGISTICS, actorId: "actor-3a91c4d8" }, freshAuth(dana, MERIDIAN), "roster-08-appoint");
        assert(appointed.ok, "a linked member is appointed the usable successor");
        const retired = await command(world, { kind: "retire-administrator", organizationId: HARBOR_LOGISTICS, actorId: DANA_OKAFOR }, freshAuth(sam, MERIDIAN), "roster-08-retire");
        assert(retired.ok, "the successor retires the administrator");
        const after = await world.runtime.context({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            envelope: danaIssued.envelope,
        });
        if (isFailed(after))
            throw new Error(`context after retirement: ${after.failure.kind}`);
        equal(after.administrator, false, "the same envelope reads standing live, not as issued");
        const refused = await world.runtime.roster({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            envelope: danaIssued.envelope,
        });
        expectFailure(refused, "denied", "the retired administrator cannot read the roster");
    }),
];
