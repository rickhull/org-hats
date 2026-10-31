// The commands conformance family.
import { CONFORMANCE_PRINCIPALS, INVITEE_ACTOR, INVITEE_ORG, MARCO, MERIDIAN, NOBODY, NORTH_ORG, NORTH_TEAM } from "./world.js";
import { assert, command, envelopeAuth, expectFailure, freshAuth, issue } from "./helpers.js";
import { runtimeCase } from "./case.js";
import { invariantProblems } from "../model.js";
import { AUTHORITY_INTERFACE_VERSION, actorId, operationId, organizationId, teamId } from "../contract.js";
export const COMMAND_CASES = [
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
];
