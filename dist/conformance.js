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
// The ids are a fresh scheme (`OH-*`), not the frozen v0.4 `OH-QM-*` ids.
import { AUTHORITY_INTERFACE_VERSION, } from "./contract.js";
import { createInMemoryAuthority } from "./authority/engine.js";
import { DANA_OKAFOR, FESTIVAL, FESTIVAL_BOOTH_COUNT, HARBOR_LOGISTICS, PROFESSIONAL_OPERATION, } from "./authority/twins.js";
import { decide, grantReaches, invariantProblems, readReach } from "./model.js";
import { ed25519VerifyKey, verify, } from "./access/verify.js";
// --- the world ---------------------------------------------------------------------
const IDP = "conformance-idp";
const MERIDIAN = "op-9f2e6ad4";
const FESTIVAL_OP = "op-61a8e3f2";
const HOME_OP = "op-conformance-home";
const NORTH_ORG = "org-2b7c41de";
const ATLAS_ORG = "org-a53e90f7";
const CIDERS_ORG = "org-d94b1c6e";
const PARK_ORG = "org-08f7a2b5";
const INVITEE_ORG = "org-invitee";
const INVITEE_ACTOR = "actor-inv-admin";
const EAST = "site-e4a1c9b3";
const WEST = "site-b8d620fa";
const ROW = "site-5c2f87ad";
const GATE = "site-a9e05c41";
const HARBOR_TEAM = "team-2e8c64b9";
const NORTH_TEAM = "team-c7d9e2a1";
const NORTH_FLOOR = "team-f5b3a08d";
const GATE_CREW = "team-3f8b52d6";
const BOOTH_001 = "team-booth-001";
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
    priya: principal("Priya Nandi", "priya", NORTH_ORG, "actor-11c2f8ab"),
    marco: principal("Marco Reyes", "marco", NORTH_ORG, "actor-6e0d94b2"),
    sam: principal("Sam Whitfield", "sam", HARBOR_LOGISTICS, "actor-3a91c4d8"),
    len: principal("Len Chu", "len", ATLAS_ORG, "actor-77f2b0e5"),
    iris: principal("Iris Bell", "iris", CIDERS_ORG, "actor-40e9d1a7"),
    rosa: principal("Rosa Quill", "rosa", PARK_ORG, "actor-b17d39e8"),
    inviteeAdmin: principal("Nia Fields", "invitee-admin", INVITEE_ORG, INVITEE_ACTOR),
};
/** An organization that exists but does not participate in Meridian — the
 * invite target. It is conformance data, not a customer fixture. */
export const CONFORMANCE_INVITEE = {
    name: "professional",
    policy: PROFESSIONAL_OPERATION.policy,
    snapshot: {
        operations: [{ operationId: HOME_OP, displayName: "Conformance Home" }],
        organizations: [{ id: INVITEE_ORG, displayName: "Cedar Works" }],
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
const failureOf = (result) => {
    if (typeof result !== "object" || result === null || !("failure" in result))
        return undefined;
    return result.failure;
};
const expectFailure = (result, kind, message) => {
    equal(failureOf(result)?.kind, kind, message);
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
    const failure = failureOf(result);
    if (failure !== undefined) {
        throw new Error(`issuance for ${entry.label} at ${operationId}: ${failure.kind}`);
    }
    return result;
};
const verifyOk = async (world, envelope, context) => {
    const result = await verify(envelope, world.keys, context);
    const failure = failureOf(result);
    if (failure !== undefined)
        throw new Error(`verification: ${failure.kind}`);
    return result;
};
/** Invite, accept, and grant the invitee's first hat; returns the operation
 * administrator's envelope for the rest of the case. */
const admitInvitee = async (world) => {
    const invitee = CONFORMANCE_PRINCIPALS.inviteeAdmin;
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
        teamId: NORTH_TEAM,
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
        const decision = decide(professional, PROFESSIONAL_OPERATION.policy, NORTH_ORG, "actor-11c2f8ab", MERIDIAN, "configure", { kind: "team", teamId: NORTH_TEAM });
        assert(!decision.allowed, "expected deny");
        equal(decision.reason, "no-capability", "denial reason");
    }),
    modelCase("OH-MODEL-07", "deny/out-of-reach: no grant reaches the target", () => {
        const decision = decide(professional, PROFESSIONAL_OPERATION.policy, NORTH_ORG, "actor-11c2f8ab", MERIDIAN, "review", { kind: "team", teamId: HARBOR_TEAM });
        assert(!decision.allowed, "expected deny");
        equal(decision.reason, "out-of-reach", "denial reason");
    }),
    modelCase("OH-MODEL-08", "deny/not-admitted: unknown, disabled, or non-participating actors", () => {
        const unknown = decide(professional, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, "actor-nobody", MERIDIAN, "observe", { kind: "team", teamId: HARBOR_TEAM });
        assert(!unknown.allowed && unknown.reason === "not-admitted", "unknown actor");
        const disabledSnapshot = {
            ...professional,
            actors: professional.actors.map((actor) => actor.actorId === "actor-3a91c4d8" ? { ...actor, disabled: true } : actor),
        };
        const disabled = decide(disabledSnapshot, PROFESSIONAL_OPERATION.policy, HARBOR_LOGISTICS, "actor-3a91c4d8", MERIDIAN, "observe", { kind: "team", teamId: HARBOR_TEAM });
        assert(!disabled.allowed && disabled.reason === "not-admitted", "disabled actor");
        const nonParticipating = {
            ...professional,
            participations: professional.participations.filter((participation) => participation.organizationId !== NORTH_ORG),
        };
        const noParticipation = decide(nonParticipating, PROFESSIONAL_OPERATION.policy, NORTH_ORG, "actor-11c2f8ab", MERIDIAN, "review", { kind: "team", teamId: NORTH_TEAM });
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
                    actorId: "actor-11c2f8ab",
                    role: "admin",
                    target: { kind: "team", teamId: NORTH_FLOOR },
                },
            ],
        };
        const decision = decide(snapshot, PROFESSIONAL_OPERATION.policy, NORTH_ORG, "actor-11c2f8ab", MERIDIAN, "configure", { kind: "team", teamId: NORTH_FLOOR });
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
        const reach = readReach(professional, PROFESSIONAL_OPERATION.policy, ATLAS_ORG, "actor-77f2b0e5", MERIDIAN);
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
        const failure = failureOf(second);
        assert(failure === undefined, `refresh failed: ${failure?.kind ?? ""}`);
        const rotated = second;
        equal(rotated.refresh.kind, "rotated", "second refresh outcome");
        const replay = await world.runtime.refresh({
            interfaceVersion: AUTHORITY_INTERFACE_VERSION,
            operationId: MERIDIAN,
            handle: first.refresh.handle,
        });
        expectFailure(replay, "unauthenticated", "superseded handle");
        await verifyOk(world, rotated.envelope, {
            now: rotated.envelope.claims.iat + 1,
            expectedOperationId: MERIDIAN,
        });
    }),
    runtimeCase("OH-PART-01", "invite, accept, admit: an invited organization receives a hat", async (world) => {
        await admitInvitee(world);
        const issued = await issue(world, CONFORMANCE_PRINCIPALS.inviteeAdmin, MERIDIAN);
        equal(issued.envelope.claims.hat.role, "field", "invitee hat");
        equal(issued.envelope.claims.hat.teamIds.length, 1, "invitee team reach");
        await verifyOk(world, issued.envelope, {
            now: issued.envelope.claims.iat + 1,
            expectedOperationId: MERIDIAN,
        });
    }),
    runtimeCase("OH-PART-02", "revoke is terminal: new issuance stops, the live envelope survives", async (world) => {
        const admin = await admitInvitee(world);
        const invitee = CONFORMANCE_PRINCIPALS.inviteeAdmin;
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
            actorId: "actor-6e0d94b2",
            role: "reviewer",
            teamId: NORTH_TEAM,
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
    runtimeCase("OH-CMD-02", "request-access asks; it does not admit", async (world) => {
        const invitee = CONFORMANCE_PRINCIPALS.inviteeAdmin;
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
        assert(failureOf(before) === undefined, "one second before expiry verifies");
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
            claims: { ...issued.envelope.claims, readableOrganizationIds: ["org-everything"] },
        };
        const bad = await verify(tampered, world.keys, { now, expectedOperationId: MERIDIAN });
        expectFailure(bad, "invalid-signature", "tampered claims");
    }),
    runtimeCase("OH-ACCESS-04", "versions fail closed before interpretation", async (world) => {
        const issued = await issue(world, CONFORMANCE_PRINCIPALS.dana, MERIDIAN);
        const now = issued.envelope.claims.iat + 1;
        const wrongEnvelopeVersion = { ...issued.envelope, v: 2 };
        expectFailure(await verify(wrongEnvelopeVersion, world.keys, { now }), "wrong-interface-version", "envelope version");
        const wrongFormat = { ...issued.envelope, format: "not-ours" };
        expectFailure(await verify(wrongFormat, world.keys, { now }), "wrong-interface-version", "envelope format");
        const wrongInterface = {
            ...issued.envelope,
            claims: { ...issued.envelope.claims, interfaceVersion: 99 },
        };
        expectFailure(await verify(wrongInterface, world.keys, { now }), "wrong-interface-version", "interface version");
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
