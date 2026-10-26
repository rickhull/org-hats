// The public conformance inventory — the executable specification of the
// portable authority and access behaviour (docs/authority_redesign.md
// § Verification strategy).
//
// Every case runs through the public surface only: the model, the
// AuthorityRuntime, the synthetic twins, and the access verifier. A case
// that cannot be expressed here is a design bug, not a test gap. The same
// inventory runs against another runtime by supplying a different
// ConformanceWorld factory (the Cloudflare adapter in M6).
//
// The inventory world is the two consumer-design twins plus the invitee
// fixture below; the Berlin Airlift twin is deliberately excluded — it is
// public-history data for the coalition shape, exercised by the portable
// suites, not part of the runtime inventory's world.
//
// The ids are a fresh scheme (`OH-*`), not the frozen v0.4 `OH-QM-*` ids.
import { AUTHORITY_INTERFACE_VERSION, actorId, isFailed, operationId, organizationId, siteId, teamId, } from "./contract.js";
import { createInMemoryAuthority } from "./authority/engine.js";
import { DANA_OKAFOR, FESTIVAL, FESTIVAL_BOOTH_COUNT, HARBOR_LOGISTICS, MERIDIAN, PROFESSIONAL_OPERATION, } from "./authority/twins.js";
import { decide, grantReaches, invariantProblems, readReach } from "./model.js";
import { ed25519VerifyKey, verify, } from "./access/verify.js";
// --- the world ---------------------------------------------------------------------
const IDP = "conformance-idp";
const FESTIVAL_OP = operationId("op-61a8e3f2");
const HOME_OP = operationId("op-conformance-home");
const NORTH_ORG = organizationId("org-2b7c41de");
const ATLAS_ORG = organizationId("org-a53e90f7");
const CIDERS_ORG = organizationId("org-d94b1c6e");
const PARK_ORG = organizationId("org-08f7a2b5");
const INVITEE_ORG = organizationId("org-invitee");
const INVITEE_ACTOR = actorId("actor-inv-lead");
const EAST = siteId("site-e4a1c9b3");
const WEST = siteId("site-b8d620fa");
const ROW = siteId("site-5c2f87ad");
const GATE = siteId("site-a9e05c41");
const HARBOR_TEAM = teamId("team-2e8c64b9");
const NORTH_TEAM = teamId("team-c7d9e2a1");
const NORTH_FLOOR = teamId("team-f5b3a08d");
const GATE_CREW = teamId("team-3f8b52d6");
const BOOTH_001 = teamId("team-booth-001");
// the actors conformance cases name directly, rather than through a
// principal: one declaration each, so a case reads the name not the id
const PRIYA = actorId("actor-11c2f8ab");
const MARCO = actorId("actor-6e0d94b2");
const SAM = actorId("actor-3a91c4d8");
const LEN = actorId("actor-77f2b0e5");
const NOBODY = actorId("actor-nobody");
const principal = (label, subject, organizationId, actorId) => ({
    label,
    evidence: { provider: IDP, subject },
    organizationId,
    actorId,
});
/** The synthetic principals the inventory resolves. A host bootstraps the
 * matching links before running the cases. */
export const CONFORMANCE_PRINCIPALS = {
    dana: principal("Dana Okafor", "dana", HARBOR_LOGISTICS, DANA_OKAFOR),
    priya: principal("Priya Nandi", "priya", NORTH_ORG, actorId("actor-11c2f8ab")),
    marco: principal("Marco Reyes", "marco", NORTH_ORG, actorId("actor-6e0d94b2")),
    sam: principal("Sam Whitfield", "sam", HARBOR_LOGISTICS, actorId("actor-3a91c4d8")),
    len: principal("Len Chu", "len", ATLAS_ORG, actorId("actor-77f2b0e5")),
    iris: principal("Iris Bell", "iris", CIDERS_ORG, actorId("actor-40e9d1a7")),
    rosa: principal("Rosa Quill", "rosa", PARK_ORG, actorId("actor-b17d39e8")),
    inviteeLead: principal("Nia Fields", "invitee-lead", INVITEE_ORG, INVITEE_ACTOR),
};
/** An organization that exists but does not participate in Meridian — the
 * invite target. It is conformance data, not a customer fixture. */
export const CONFORMANCE_INVITEE = {
    name: "invitee",
    policy: PROFESSIONAL_OPERATION.policy,
    snapshot: {
        operations: [{ operationId: HOME_OP, displayName: "Conformance Home", slug: "conformance-home" }],
        organizations: [{ organizationId: INVITEE_ORG, displayName: "Cedar Works" }],
        actors: [{ organizationId: INVITEE_ORG, actorId: INVITEE_ACTOR, displayName: "Nia Fields" }],
        sites: [],
        teams: [],
        grants: [],
        participations: [{ organizationId: INVITEE_ORG, operationId: HOME_OP, status: "active" }],
    },
};
export const CONFORMANCE_FIXTURES = [
    PROFESSIONAL_OPERATION,
    FESTIVAL,
    CONFORMANCE_INVITEE,
];
/** The world every adapter bootstraps before running the inventory. */
export const CONFORMANCE_WORLD = {
    fixtures: CONFORMANCE_FIXTURES,
    principalLinks: Object.values(CONFORMANCE_PRINCIPALS).map((entry) => ({
        provider: entry.evidence.provider,
        subject: entry.evidence.subject,
        organizationId: entry.organizationId,
        actorId: entry.actorId,
    })),
    orgAdmins: {
        [HARBOR_LOGISTICS]: [DANA_OKAFOR],
        [INVITEE_ORG]: [INVITEE_ACTOR],
    },
};
/** The in-memory world, used by the default runner and by tests. */
export const createInMemoryConformanceWorld = async () => {
    const engine = await createInMemoryAuthority({
        fixtures: CONFORMANCE_WORLD.fixtures,
        principalLinks: CONFORMANCE_WORLD.principalLinks,
        orgAdmins: CONFORMANCE_WORLD.orgAdmins,
    });
    const material = await engine.verificationKey();
    const key = await ed25519VerifyKey(material.keyId, material.publicKey);
    return { runtime: engine.runtime, keys: new Map([[key.keyId, key]]) };
};
// --- assertions --------------------------------------------------------------------
const assert = (condition, message) => {
    if (!condition)
        throw new Error(message);
};
const equal = (actual, expected, message) => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
};
const deepEqual = (actual, expected, message) => {
    const left = JSON.stringify(actual);
    const right = JSON.stringify(expected);
    if (left !== right)
        throw new Error(`${message}: expected ${right}, got ${left}`);
};
const expectFailure = (result, kind, message) => {
    if (!isFailed(result))
        throw new Error(`${message}: expected ${kind}, got success`);
    equal(result.failure.kind, kind, message);
};
const command = (world, body, authorization, key) => world.runtime.command({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    idempotencyKey: key,
    authorization,
    ...body,
});
const envelopeAuth = (envelope) => ({
    kind: "access-envelope",
    envelope,
});
const freshAuth = (entry, operationId) => ({
    kind: "fresh-evidence",
    evidence: entry.evidence,
    operationId,
});
const issue = async (world, entry, operationId) => {
    const result = await world.runtime.accessFromEvidence({
        interfaceVersion: AUTHORITY_INTERFACE_VERSION,
        operationId,
        evidence: entry.evidence,
    });
    if (isFailed(result)) {
        throw new Error(`issuance for ${entry.label} at ${operationId}: ${result.failure.kind}`);
    }
    return result;
};
const verifyOk = async (world, envelope, context) => {
    const result = await verify(envelope, world.keys, context);
    if (isFailed(result))
        throw new Error(`verification: ${result.failure.kind}`);
    return result;
};
/** Invite, accept, and grant the invitee's first hat; returns the operation
 * administrator's envelope for the rest of the case. */
const admitInvitee = async (world) => {
    const invitee = CONFORMANCE_PRINCIPALS.inviteeLead;
    const admin = await issue(world, CONFORMANCE_PRINCIPALS.len, MERIDIAN);
    const invite = await command(world, { kind: "participation-invite", operationId: MERIDIAN, organizationId: INVITEE_ORG }, envelopeAuth(admin.envelope), "conf-invite");
    assert(invite.ok, `invite failed: ${invite.ok ? "" : invite.failure.kind}`);
    const accept = await command(world, { kind: "participation-accept", operationId: MERIDIAN }, freshAuth(invitee, MERIDIAN), "conf-accept");
    assert(accept.ok, `accept failed: ${accept.ok ? "" : accept.failure.kind}`);
    // the acceptance is delivered on the next runtime call; the grant then
    // admits the invitee with a wearable hat
    const grant = await command(world, {
        kind: "grant-hat",
        operationId: MERIDIAN,
        organizationId: INVITEE_ORG,
        actorId: invitee.actorId,
        role: "field",
        target: { kind: "team", teamId: NORTH_TEAM },
    }, envelopeAuth(admin.envelope), "conf-invitee-grant");
    assert(grant.ok, `grant failed: ${grant.ok ? "" : grant.failure.kind}`);
    return admin;
};
const modelCase = (id, title, run) => ({
    id,
    title,
    run: async () => {
        run();
    },
});
const runtimeCase = (id, title, run) => ({ id, title, run });
const professional = PROFESSIONAL_OPERATION.snapshot;
const festival = FESTIVAL.snapshot;
export const CONFORMANCE_CASES = [
    modelCase("OH-MODEL-01", "the professional twin is multi-organization and multi-site", () => {
        equal(professional.organizations.length, 3, "organizations");
        equal(professional.sites.length, 2, "sites");
        equal(professional.teams.length, 4, "teams");
        equal(professional.participations.length, 3, "participations");
        deepEqual(invariantProblems(professional, PROFESSIONAL_OPERATION.policy), [], "invariants");
    }),
    modelCase("OH-MODEL-02", "the festival is a bounded booth burst", () => {
        equal(festival.operations[0]?.bounded, true, "bounded operation");
        const booths = festival.teams.filter((team) => team.teamId.startsWith("team-booth-"));
        equal(booths.length, FESTIVAL_BOOTH_COUNT, "booth count");
        assert(booths.every((team) => team.siteId === ROW && team.organizationId === CIDERS_ORG), "every booth is at the tasting row under the ciders guild");
        deepEqual(invariantProblems(festival, FESTIVAL.policy), [], "invariants");
    }),
    modelCase("OH-MODEL-03", "a site grant reaches the site and every team at it, never another site", () => {
        const grant = festival.grants.find((candidate) => candidate.grantId === "g-fest-1");
        assert(grant !== undefined, "Iris's site grant exists");
        assert(grantReaches(festival, grant, { kind: "site", siteId: ROW }), "site target");
        assert(grantReaches(festival, grant, { kind: "team", teamId: BOOTH_001 }), "booth target");
        assert(!grantReaches(festival, grant, { kind: "team", teamId: GATE_CREW }), "gate team is outside");
        assert(!grantReaches(festival, grant, { kind: "site", siteId: GATE }), "gate site is outside");
    }),
    modelCase("OH-MODEL-04", "nothing reaches a whole operation", () => {
        for (const fixture of [PROFESSIONAL_OPERATION, FESTIVAL]) {
            for (const grant of fixture.snapshot.grants) {
                assert(!grantReaches(fixture.snapshot, grant, { kind: "operation" }), `${fixture.name}: ${grant.grantId}`);
            }
        }
    }),
    modelCase("OH-MODEL-05", "allow: the worn role carries the action and the grant reaches the target", () => {
        const decision = decide(professional, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, DANA_OKAFOR, MERIDIAN, "review", { kind: "team", teamId: HARBOR_TEAM });
        assert(decision.allowed, "expected allow");
        equal(decision.hat?.role, "coordinator", "worn role");
    }),
    modelCase("OH-MODEL-06", "deny/no-capability: the worn role does not carry the action", () => {
        const decision = decide(professional, PROFESSIONAL_OPERATION.policy, NORTH_ORG, PRIYA, MERIDIAN, "configure", { kind: "team", teamId: NORTH_TEAM });
        assert(!decision.allowed, "expected deny");
        equal(decision.reason, "no-capability", "denial reason");
    }),
    modelCase("OH-MODEL-07", "deny/out-of-reach: no grant reaches the target", () => {
        const decision = decide(professional, PROFESSIONAL_OPERATION.policy, NORTH_ORG, PRIYA, MERIDIAN, "review", { kind: "team", teamId: HARBOR_TEAM });
        assert(!decision.allowed, "expected deny");
        equal(decision.reason, "out-of-reach", "denial reason");
    }),
    modelCase("OH-MODEL-08", "deny/not-admitted: unknown, disabled, or non-participating actors", () => {
        const unknown = decide(professional, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, NOBODY, MERIDIAN, "observe", { kind: "team", teamId: HARBOR_TEAM });
        assert(!unknown.allowed && unknown.reason === "not-admitted", "unknown actor");
        const disabledSnapshot = {
            ...professional,
            actors: professional.actors.map((actor) => actor.actorId === SAM ? { ...actor, disabled: true } : actor),
        };
        const disabled = decide(disabledSnapshot, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, SAM, MERIDIAN, "observe", { kind: "team", teamId: HARBOR_TEAM });
        assert(!disabled.allowed && disabled.reason === "not-admitted", "disabled actor");
        const nonParticipating = {
            ...professional,
            participations: professional.participations.filter((participation) => participation.organizationId !== NORTH_ORG),
        };
        const noParticipation = decide(nonParticipating, PROFESSIONAL_OPERATION.policy, NORTH_ORG, PRIYA, MERIDIAN, "review", { kind: "team", teamId: NORTH_TEAM });
        assert(!noParticipation.allowed && noParticipation.reason === "not-admitted", "non-participating organization");
    }),
    modelCase("OH-MODEL-09", "fallback: a primary that does not reach the target stands aside", () => {
        const snapshot = {
            ...professional,
            grants: [
                ...professional.grants,
                {
                    grantId: "g-conformance-fallback",
                    operationId: MERIDIAN,
                    organizationId: NORTH_ORG,
                    actorId: PRIYA,
                    role: "admin",
                    target: { kind: "team", teamId: NORTH_FLOOR },
                },
            ],
        };
        const decision = decide(snapshot, PROFESSIONAL_OPERATION.policy, NORTH_ORG, PRIYA, MERIDIAN, "configure", { kind: "team", teamId: NORTH_FLOOR });
        assert(decision.allowed, "expected fallback allow");
        equal(decision.hat?.grantId, "g-conformance-fallback", "fallback grant");
    }),
    modelCase("OH-MODEL-10", "read reach: granted-teams follows the actor's reached teams", () => {
        const reach = readReach(professional, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, DANA_OKAFOR, MERIDIAN);
        deepEqual(reach.readableOrganizationIds, [HARBOR_LOGISTICS], "readable organizations");
        deepEqual(reach.readableTeamIds, [], "exceptional teams");
    }),
    modelCase("OH-MODEL-11", "read reach: all-participating spans the operation", () => {
        const reach = readReach(festival, FESTIVAL.policy, HARBOR_LOGISTICS, DANA_OKAFOR, FESTIVAL_OP);
        deepEqual([...reach.readableOrganizationIds].sort(), [PARK_ORG, HARBOR_LOGISTICS, CIDERS_ORG].sort(), "readable organizations");
        deepEqual(reach.readableTeamIds, [], "exceptional teams");
    }),
    modelCase("OH-MODEL-12", "read reach: a site grant reads every organization with a team at the site", () => {
        const reach = readReach(professional, PROFESSIONAL_OPERATION.policy, ATLAS_ORG, LEN, MERIDIAN);
        deepEqual([...reach.readableOrganizationIds].sort(), [HARBOR_LOGISTICS, ATLAS_ORG].sort(), "readable organizations");
    }),
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
        const disabled = await command(world, { kind: "disable-actor", organizationId: HARBOR_LOGISTICS, actorId: sam.actorId }, envelopeAuth(admin.envelope), "conf-disable-sam");
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
        if (isFailed(second))
            throw new Error(`refresh failed: ${second.failure.kind}`);
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
        if (isFailed(renewedResult))
            throw new Error(`refresh failed: ${renewedResult.failure.kind}`);
        const renewed = renewedResult;
        deepEqual(renewed.envelope.claims.amr, ["hwk", "pin"], "refresh preserves the methods");
        equal(renewed.envelope.claims.auth_time, AUTH_TIME, "refresh preserves the authentication time");
        assert(renewed.envelope.claims.iat >= issued.envelope.claims.iat, "envelope time moves on");
        const contextResult = await world.runtime.context({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            envelope: renewed.envelope,
        });
        if (isFailed(contextResult))
            throw new Error(`context failed: ${contextResult.failure.kind}`);
        const context = contextResult;
        deepEqual(context.amr, ["hwk", "pin"], "context surfaces the methods");
        equal(context.authTime, AUTH_TIME, "context surfaces the authentication time");
        const plain = await issue(world, entry, MERIDIAN);
        assert(!("amr" in plain.envelope.claims), "issuance without methods carries none");
        assert(!("auth_time" in plain.envelope.claims), "issuance without an authentication time carries none");
    }),
    runtimeCase("OH-AUTH-07", "wearable hats carry the grant id select-hat takes", async (world) => {
        const admin = await issue(world, CONFORMANCE_PRINCIPALS.len, MERIDIAN);
        const grant = await command(world, {
            kind: "grant-hat",
            operationId: MERIDIAN,
            organizationId: NORTH_ORG,
            actorId: MARCO,
            role: "reviewer",
            target: { kind: "team", teamId: NORTH_TEAM },
        }, envelopeAuth(admin.envelope), "auth-07-grant");
        assert(grant.ok && grant.receipt.applied, "second hat granted");
        const issued = await issue(world, CONFORMANCE_PRINCIPALS.marco, MERIDIAN);
        const contextResult = await world.runtime.context({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            envelope: issued.envelope,
        });
        if (isFailed(contextResult))
            throw new Error(`context failed: ${contextResult.failure.kind}`);
        const context = contextResult;
        equal(context.wearableHats.length, 2, "two wearable hats after the grant");
        const ids = context.wearableHats.map((hat) => hat.grantId);
        equal(new Set(ids).size, ids.length, "the grant ids are unique");
        assert(ids.includes("g-mer-2"), "the existing grant is listed");
        const reviewer = context.wearableHats.find((hat) => hat.role === "reviewer");
        assert(reviewer !== undefined, "the granted hat is listed");
        // the addressing round-trips: the id the context hands out is the id
        // the command takes, and the next envelope wears what it selected
        const select = await command(world, { kind: "select-hat", operationId: MERIDIAN, grantId: reviewer.grantId }, freshAuth(CONFORMANCE_PRINCIPALS.marco, MERIDIAN), "auth-07-select");
        assert(select.ok && select.receipt.applied, "select-hat accepts the listed grant id");
        const worn = await world.runtime.refresh({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            operationId: MERIDIAN,
            handle: issued.refresh.kind === "rotated" ? issued.refresh.handle : "",
        });
        if (isFailed(worn))
            throw new Error(`refresh after select failed: ${worn.failure.kind}`);
        equal(worn.envelope.claims.hat.role, "reviewer", "the next envelope wears the selected hat");
    }),
    runtimeCase("OH-PART-01", "invite, accept, admit: an invited organization receives a hat", async (world) => {
        await admitInvitee(world);
        const issued = await issue(world, CONFORMANCE_PRINCIPALS.inviteeLead, MERIDIAN);
        equal(issued.envelope.claims.hat.role, "field", "invitee hat");
        equal(issued.envelope.claims.hat.teamIds.length, 1, "invitee team reach");
        await verifyOk(world, issued.envelope, {
            now: issued.envelope.claims.iat + 1,
            expectedOperationId: MERIDIAN,
        });
    }),
    runtimeCase("OH-PART-02", "revoke is terminal: new issuance stops, the live envelope survives", async (world) => {
        const admin = await admitInvitee(world);
        const invitee = CONFORMANCE_PRINCIPALS.inviteeLead;
        const live = await issue(world, invitee, MERIDIAN);
        const revoke = await command(world, { kind: "participation-revoke", operationId: MERIDIAN, organizationId: INVITEE_ORG, by: "operation" }, envelopeAuth(admin.envelope), "conf-revoke");
        assert(revoke.ok, `revoke failed: ${revoke.ok ? "" : revoke.failure.kind}`);
        const stillLive = await verifyOk(world, live.envelope, {
            now: live.envelope.claims.iat + 1,
            expectedOperationId: MERIDIAN,
        });
        equal(stillLive.access.mayAct("observe", { kind: "team", teamId: NORTH_TEAM }), true, "live envelope survives revocation");
        const after = await world.runtime.accessFromEvidence({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            operationId: MERIDIAN,
            evidence: invitee.evidence,
        });
        expectFailure(after, "not-admitted", "revoked participation cannot be issued");
        const acceptAgain = await command(world, { kind: "participation-accept", operationId: MERIDIAN }, freshAuth(invitee, MERIDIAN), "conf-accept-again");
        expectFailure(acceptAgain, "denied", "an accepted invitation is terminal");
    }),
    runtimeCase("OH-CMD-01", "idempotent retry: a denial does not poison the key", async (world) => {
        const admin = await issue(world, CONFORMANCE_PRINCIPALS.len, MERIDIAN);
        const grant = {
            kind: "grant-hat",
            operationId: MERIDIAN,
            organizationId: NORTH_ORG,
            actorId: MARCO,
            role: "reviewer",
            target: { kind: "team", teamId: NORTH_TEAM },
        };
        const first = await command(world, grant, envelopeAuth(admin.envelope), "conf-grant-key");
        assert(first.ok && first.receipt.applied, "first grant applies");
        const retry = await command(world, grant, envelopeAuth(admin.envelope), "conf-grant-key");
        assert(retry.ok && !retry.receipt.applied, "retry claims the first result");
        const denied = await command(world, { ...grant, role: "wizard" }, envelopeAuth(admin.envelope), "conf-denied-key");
        expectFailure(denied, "invalid-command", "unknown role is denied");
        const reused = await command(world, grant, envelopeAuth(admin.envelope), "conf-denied-key");
        assert(reused.ok && reused.receipt.applied, "denial did not poison the key");
    }),
    runtimeCase("OH-CMD-03", "a grant stands on an actor and an active participation", async (world) => {
        const admin = await issue(world, CONFORMANCE_PRINCIPALS.len, MERIDIAN);
        const grant = {
            kind: "grant-hat",
            operationId: MERIDIAN,
            organizationId: NORTH_ORG,
            actorId: MARCO,
            role: "reviewer",
            target: { kind: "team", teamId: NORTH_TEAM },
        };
        // an actor nobody has heard of: a grant naming one is a snapshot
        // `invariantProblems` calls broken, so the command must refuse it rather
        // than commit it
        const stranger = await command(world, { ...grant, actorId: NOBODY }, envelopeAuth(admin.envelope), "conf-grant-stranger");
        expectFailure(stranger, "invalid-command", "a grant to an unknown actor is refused");
        // an organization with no participation here has nothing for a grant to
        // stand on
        const outsider = await command(world, { ...grant, organizationId: INVITEE_ORG, actorId: INVITEE_ACTOR }, envelopeAuth(admin.envelope), "conf-grant-outsider");
        assert(!outsider.ok, "a grant without a participation is refused");
        // the same grant, with both in place, applies
        const valid = await command(world, grant, envelopeAuth(admin.envelope), "conf-grant-valid");
        assert(valid.ok && valid.receipt.applied, `a well-founded grant applies: ${valid.ok ? "" : valid.failure.kind}`);
    }),
    runtimeCase("OH-CMD-04", "a wearable hat is not an administrator's hat", async (world) => {
        // A valid envelope whose role carries no configure action — and no
        // admin role is declared — must be refused the grant act. Administration
        // is deployment policy, never something a worn hat implies.
        const dana = await issue(world, CONFORMANCE_PRINCIPALS.dana, MERIDIAN);
        const grant = {
            kind: "grant-hat",
            operationId: MERIDIAN,
            organizationId: NORTH_ORG,
            actorId: MARCO,
            role: "reviewer",
            target: { kind: "team", teamId: NORTH_TEAM },
        };
        const denied = await command(world, grant, envelopeAuth(dana.envelope), "conf-grant-nonadmin");
        expectFailure(denied, "denied", "a non-administrator cannot grant hats");
        // and the refusal settles nothing: an administrator's identical grant
        // still applies under its own key
        const admin = await issue(world, CONFORMANCE_PRINCIPALS.len, MERIDIAN);
        const applied = await command(world, grant, envelopeAuth(admin.envelope), "conf-grant-nonadmin-2");
        assert(applied.ok && applied.receipt.applied, "the administrator's grant applies");
    }),
    runtimeCase("OH-CMD-02", "request-access asks; it does not admit", async (world) => {
        const invitee = CONFORMANCE_PRINCIPALS.inviteeLead;
        const request = await command(world, { kind: "request-access", operationId: MERIDIAN, evidence: invitee.evidence }, freshAuth(invitee, MERIDIAN), "conf-request");
        assert(request.ok, "request-access succeeds for a linked principal");
        const issued = await world.runtime.accessFromEvidence({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            operationId: MERIDIAN,
            evidence: invitee.evidence,
        });
        expectFailure(issued, "not-admitted", "requesting is not admission");
    }),
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
        const tampered = {
            ...issued.envelope,
            claims: { ...issued.envelope.claims, readableOrganizationIds: [organizationId("org-everything")] },
        };
        const bad = await verify(tampered, world.keys, { now, expectedOperationId: MERIDIAN });
        expectFailure(bad, "invalid-signature", "tampered claims");
    }),
    runtimeCase("OH-ACCESS-04", "the envelope version pair gates reading; the interface version is provenance", async (world) => {
        const issued = await issue(world, CONFORMANCE_PRINCIPALS.dana, MERIDIAN);
        const now = issued.envelope.claims.iat + 1;
        const wrongEnvelopeVersion = { ...issued.envelope, v: 2 };
        expectFailure(await verify(wrongEnvelopeVersion, world.keys, { now }), "wrong-interface-version", "envelope version");
        const wrongFormat = { ...issued.envelope, format: "not-ours" };
        expectFailure(await verify(wrongFormat, world.keys, { now }), "wrong-interface-version", "envelope format");
        const wrongClaimsVersion = {
            ...issued.envelope,
            claims: { ...issued.envelope.claims, v: 2 },
        };
        expectFailure(await verify(wrongClaimsVersion, world.keys, { now }), "wrong-interface-version", "claims version");
        // The claims also record which interface issued them, and that is
        // provenance, not a gate. Editing it after signing must therefore reach
        // the signature check rather than be rejected as a version: an envelope
        // outlives the call signatures that produced it. A genuinely re-signed
        // envelope with a different interface version still reads;
        // tests/access.test.ts covers that, since this inventory holds no issuer
        // key with which to re-sign.
        const differentInterface = {
            ...issued.envelope,
            // interface 1 was the previous call surface; this runtime declares 2.
            // The claims field is provenance (`IssuerInterfaceVersion`), so a
            // historical literal needs no cast.
            claims: { ...issued.envelope.claims, interfaceVersion: 1 },
        };
        expectFailure(await verify(differentInterface, world.keys, { now }), "invalid-signature", "interface version is not a version gate");
    }),
];
/** Run every case in a fresh world, so one case's mutations cannot mask
 * another's. The default world is the in-memory authority. */
export const runConformance = async (makeWorld = createInMemoryConformanceWorld) => {
    const results = [];
    for (const conformanceCase of CONFORMANCE_CASES) {
        try {
            await conformanceCase.run(await makeWorld());
            results.push({ id: conformanceCase.id, title: conformanceCase.title, ok: true });
        }
        catch (error) {
            results.push({
                id: conformanceCase.id,
                title: conformanceCase.title,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return results;
};
