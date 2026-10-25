// The portable authority engine, in memory — the reference implementation of
// `AuthorityRuntime` (docs/authority_redesign.md § Authority).
//
// Two coordinators mirror the deployed shape: `organization.ts` owns actors,
// principal links, org-side participation, and invitations; `operation.ts`
// owns sites, teams, grants, policy, op-side participation, refresh records,
// and issuance. Between them is an outbox (`outbox.ts`) with visible partial
// states and retryable delivery — never a distributed transaction. This file
// is the wiring: bootstrap, the two coordinators, the version gate, and the
// dispatch that routes each command to the coordinator that owns it.
//
// Determinism: the clock and signer are injected; a fixed clock plus a
// fresh signer gives reproducible behavior (ids, failure kinds, receipts)
// without pinning signature bytes.
import { AUTHORITY_INTERFACE_VERSION, operationId, } from "../contract.js";
import { counter, systemClock, webCryptoSigner } from "./internal.js";
import { createOperationCoordinator } from "./operation.js";
import { createOrganizationCoordinator } from "./organization.js";
import { deliverPending } from "./outbox.js";
import { fail, failed } from "./result.js";
import { principalKey, snapshotOf as snapshotFrom, } from "./state.js";
const nextSigningKey = counter();
export const createInMemoryAuthority = async (config = {}) => {
    const clock = config.clock ?? systemClock();
    const signer = config.signer ?? (await webCryptoSigner(`key-${nextSigningKey()}`));
    const lifetime = config.envelopeLifetimeSeconds ?? 900;
    const configureActions = config.configureActions ?? ["configure"];
    const adminRoles = config.adminRoles ?? {};
    const orgAdmins = config.orgAdmins ?? {};
    let transportFailures = config.transportFailures ?? 0;
    const orgs = new Map();
    const ops = new Map();
    /** Verified-principal links, one engine-wide map keyed by the encoded
     * (provider, subject) pair: "a:b"/"c" and "a"/"b:c" are different links,
     * and one identity is never two actors — the guard must hold across
     * organizations, not just within one. */
    const principalLinks = new Map();
    const outbox = [];
    const delivered = new Set();
    const nextId = counter();
    const allOrganizations = [];
    const allActors = [];
    for (const fixture of config.fixtures ?? []) {
        const op = fixture.snapshot.operations[0];
        if (op === undefined)
            throw new Error("a twin fixture needs an operation");
        ops.set(op.operationId, {
            operationId: op.operationId,
            ...(op.displayName !== undefined ? { displayName: op.displayName } : {}),
            ...(op.slug !== undefined ? { slug: op.slug } : {}),
            ...(op.bounded !== undefined ? { bounded: op.bounded } : {}),
            policy: fixture.policy,
            sites: fixture.snapshot.sites.map((s) => ({ ...s })),
            teams: fixture.snapshot.teams.map((t) => ({ ...t })),
            grants: fixture.snapshot.grants.map((g) => ({ ...g })),
            participations: fixture.snapshot.participations.map((p) => ({ ...p })),
            invitations: new Map(),
            refreshRecords: [],
            accessRequests: [],
            audit: [{ at: clock.now(), by: "bootstrap", fact: `fixture ${fixture.snapshot.operations[0]?.operationId} loaded` }],
            claims: new Map(),
        });
        for (const organization of fixture.snapshot.organizations) {
            if (!orgs.has(organization.organizationId)) {
                orgs.set(organization.organizationId, {
                    organizationId: organization.organizationId,
                    ...(organization.displayName !== undefined ? { displayName: organization.displayName } : {}),
                    actors: [],
                    invitations: new Map(),
                    audit: [{ at: clock.now(), by: "bootstrap", fact: `organization ${organization.organizationId} created` }],
                    claims: new Map(),
                });
                allOrganizations.push({ organizationId: organization.organizationId, ...(organization.displayName !== undefined ? { displayName: organization.displayName } : {}) });
            }
        }
        for (const actor of fixture.snapshot.actors) {
            const org = orgs.get(actor.organizationId);
            if (org !== undefined && !org.actors.some((a) => a.actorId === actor.actorId)) {
                org.actors.push({ ...actor });
                if (!allActors.some((a) => a.organizationId === actor.organizationId && a.actorId === actor.actorId)) {
                    allActors.push({ ...actor });
                }
            }
        }
    }
    for (const link of config.principalLinks ?? []) {
        const org = orgs.get(link.organizationId);
        if (org === undefined || !org.actors.some((a) => a.actorId === link.actorId)) {
            throw new Error(`principal link names an unknown actor: ${link.organizationId}/${link.actorId}`);
        }
        // one identity is never two actors: a (provider, subject) may re-link
        // its own actor, never a different one — engine-wide, across
        // organizations
        const key = principalKey(link.provider, link.subject);
        const existing = principalLinks.get(key);
        if (existing !== undefined &&
            (existing.organizationId !== link.organizationId || existing.actorId !== link.actorId)) {
            throw new Error(`principal link ${key} already resolves to ${existing.organizationId}/${existing.actorId}, not ${link.organizationId}/${link.actorId}`);
        }
        principalLinks.set(key, {
            organizationId: link.organizationId,
            actorId: link.actorId,
        });
    }
    const snapshotOf = (operationOf) => snapshotFrom(ops, allOrganizations, allActors, operationOf);
    const operations = createOperationCoordinator({
        orgs,
        ops,
        principalLinks,
        outbox,
        clock,
        signer,
        nextId,
        lifetime,
        configureActions,
        snapshotOf,
    });
    const organizations = createOrganizationCoordinator({
        orgs,
        ops,
        principalLinks,
        outbox,
        clock,
        signer,
        nextId,
        adminRoles,
        orgAdmins,
        configureActions,
    });
    // The outbox drain. `failTransport` consumes the injected failures, so a
    // message whose attempt failed stays in the outbox for the next call.
    const deliver = () => deliverPending({
        orgs,
        ops,
        outbox,
        delivered,
        failTransport: () => {
            if (transportFailures > 0) {
                transportFailures -= 1;
                return true;
            }
            return false;
        },
        now: () => clock.now(),
    });
    const checkVersion = (v) => v !== AUTHORITY_INTERFACE_VERSION ? { kind: "wrong-interface-version" } : undefined;
    // --- the runtime ----------------------------------------------------------------------
    //
    // The version gate precedes the drain in every method: a call the runtime
    // refuses must not even deliver pending coordinator messages — a rejected
    // caller causes no side effects, and delivery is one.
    const runtime = {
        async accessFromEvidence(input) {
            const versionFail = checkVersion(input.interfaceVersion);
            if (versionFail !== undefined)
                return failed(versionFail);
            await deliver();
            return operations.accessFromEvidence(input);
        },
        async refresh(input) {
            const versionFail = checkVersion(input.interfaceVersion);
            if (versionFail !== undefined)
                return failed(versionFail);
            await deliver();
            return operations.refresh(input);
        },
        async context(input) {
            const versionFail = checkVersion(input.interfaceVersion);
            if (versionFail !== undefined)
                return failed(versionFail);
            await deliver();
            return operations.context(input);
        },
        async command(inputCommand) {
            const versionFail = checkVersion(inputCommand.interfaceVersion);
            if (versionFail !== undefined)
                return fail(versionFail.kind);
            await deliver();
            // request-access needs no administrator: the evidence is the request
            if (inputCommand.kind === "request-access")
                return operations.requestAccess(inputCommand);
            // which operation this command binds to, if any: `disable-actor` is
            // organization-scoped and binds to none
            const boundOperation = inputCommand.kind === "disable-actor"
                ? undefined
                : "operationId" in inputCommand
                    ? operationId(inputCommand.operationId)
                    : undefined;
            const principalOrFailure = await organizations.resolvePrincipal(inputCommand.authorization, boundOperation);
            if ("kind" in principalOrFailure)
                return fail(principalOrFailure.kind, principalOrFailure.detail);
            switch (inputCommand.kind) {
                case "participation-accept":
                case "disable-actor":
                    return organizations.command(inputCommand, principalOrFailure);
                case "participation-revoke":
                    return inputCommand.by === "operation"
                        ? operations.command(inputCommand, principalOrFailure)
                        : organizations.command(inputCommand, principalOrFailure);
                case "participation-invite":
                case "admit":
                case "grant-hat":
                case "revoke-grant":
                case "select-hat":
                    return operations.command(inputCommand, principalOrFailure);
                default: {
                    // The exhaustiveness witness: this arm is `never` when every
                    // command kind has a case, so adding one fails the build here
                    // instead of silently routing to invalid-command. The failure —
                    // not a throw — stays: a caller that bypasses the types (an
                    // untyped host, a structurally stale version) still gets the
                    // closed taxonomy, never an exception.
                    inputCommand;
                    return fail("invalid-command", "unknown command kind");
                }
            }
        },
    };
    return {
        runtime,
        verificationKey: async () => ({
            keyId: signer.keyId,
            algorithm: signer.algorithm,
            publicKey: await signer.publicKey(),
        }),
        drainOutbox: deliver,
        pendingOutbox: () => outbox.length,
        snapshotOf,
        invitationsOf: (organizationOf) => new Map([...(orgs.get(organizationOf)?.invitations.entries() ?? [])].map(([invitationId, invitation]) => [invitationId, { operationId: invitation.operationId, status: invitation.status }])),
        accessRequestsOf: (operationOf) => (ops.get(operationOf)?.accessRequests ?? []).map((request) => ({ ...request })),
    };
};
