// The claims an envelope carries, assembled once — the issuer's only copy of
// the shape.
//
// The in-memory engine and the Cloudflare operation coordinator each own
// their preconditions (does the actor exist, is it disabled, is the
// operation bootstrapped) but neither owns the claim shape: the hat, its
// action list, the teams the wearable grants reach, routing sites, read
// reach, configuration reach, the lifetime, and the preserved authentication
// facts are computed here from a model snapshot and the active bundle. Two copies drifted once; one
// function cannot.
//
// Pure: the caller supplies the issued-at instant, the lifetime, and the
// configure-action vocabulary. No clock, signer, or storage.
import { ACCESS_ENVELOPE_VERSION, AUTHORITY_INTERFACE_VERSION, } from "../contract.js";
import { firstByRank, readReach, wearableGrants, } from "../model.js";
import { actionsOf } from "../policy.js";
/** Copy the facts a source carried, dropping absent ones rather than
 * inventing a value. The evidence-to-claims and refresh-record-to-claims
 * paths share this so an absent `amr` never becomes `[]` and an absent
 * `auth_time` never becomes zero. */
export const authenticationFactsOf = (source) => source === undefined || (source.amr === undefined && source.authTime === undefined)
    ? undefined
    : {
        ...(source.amr !== undefined ? { amr: [...source.amr] } : {}),
        ...(source.authTime !== undefined ? { authTime: source.authTime } : {}),
    };
/** The complete claims payload, or the reason no honest hat exists: the
 * actor wears no grant (`not-admitted`) or the grant names a role the bundle
 * does not carry (`unavailable` — an administrator's inconsistency, never an
 * empty action list describing the actor). */
export const assembleAccessClaims = (input) => {
    const { snapshot, policy, operationId, organizationId, actorId, configureActions, issuedAt } = input;
    const wearable = wearableGrants(snapshot, organizationId, actorId, operationId);
    if (wearable.length === 0)
        return { kind: "not-admitted" };
    const hatGrant = firstByRank(wearable);
    if (hatGrant === undefined)
        return { kind: "not-admitted" };
    const role = actionsOf(policy, hatGrant.role);
    if (!role.found) {
        return { kind: "unavailable", detail: `the policy bundle no longer carries the role "${hatGrant.role}"` };
    }
    const hatTeamIds = new Set();
    const hatSiteIds = new Set();
    if (hatGrant.target.kind === "site") {
        hatSiteIds.add(hatGrant.target.siteId);
        for (const team of snapshot.teams) {
            if (team.siteId === hatGrant.target.siteId)
                hatTeamIds.add(team.teamId);
        }
    }
    else {
        hatTeamIds.add(hatGrant.target.teamId);
    }
    const siteIds = new Set();
    const memberTeams = new Set();
    for (const grant of wearable) {
        if (grant.target.kind === "site") {
            siteIds.add(grant.target.siteId);
            for (const team of snapshot.teams) {
                if (team.siteId === grant.target.siteId)
                    memberTeams.add(team.teamId);
            }
        }
        else {
            const teamId = grant.target.teamId;
            memberTeams.add(teamId);
            const siteId = snapshot.teams.find((team) => team.teamId === teamId)?.siteId;
            if (siteId !== undefined)
                siteIds.add(siteId);
        }
    }
    const sites = snapshot.sites
        .filter((site) => siteIds.has(site.siteId))
        .map((site) => ({ siteId: site.siteId, aliases: [...site.aliases] }));
    const reach = readReach(snapshot, policy, organizationId, actorId, operationId);
    const configurableSiteIds = snapshot.sites
        .filter((site) => wearable.some((grant) => {
        const carried = actionsOf(policy, grant.role);
        if (!carried.found || !carried.actions.some((action) => configureActions.includes(action))) {
            return false;
        }
        if (grant.target.kind === "site")
            return grant.target.siteId === site.siteId;
        const teamId = grant.target.teamId;
        return snapshot.teams.find((team) => team.teamId === teamId)?.siteId === site.siteId;
    }))
        .map((site) => site.siteId);
    return {
        v: ACCESS_ENVELOPE_VERSION,
        interfaceVersion: AUTHORITY_INTERFACE_VERSION,
        operationId,
        actor: { organizationId, actorId },
        hat: {
            role: hatGrant.role,
            actions: [...role.actions],
            teamIds: [...hatTeamIds],
            siteIds: [...hatSiteIds],
        },
        memberTeamIds: [...memberTeams],
        sites,
        readableOrganizationIds: reach.readableOrganizationIds,
        readableTeamIds: reach.readableTeamIds,
        configurableSiteIds,
        iat: issuedAt,
        exp: issuedAt + input.envelopeLifetimeSeconds,
        // Optional facts emit conditionally: exactOptionalPropertyTypes keeps
        // absence off the wire — a present-but-undefined field would change the
        // canonical bytes and with them the signature.
        ...(input.auth?.amr !== undefined ? { amr: [...input.auth.amr] } : {}),
        ...(input.auth?.authTime !== undefined ? { auth_time: input.auth.authTime } : {}),
    };
};
