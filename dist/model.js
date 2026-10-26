// The v1 organization model — the smallest reusable statement of who may
// act, with which hat, over which team or site, and where.
//
// The v0.4 model lives on `main` at its tags; nothing here copies it. What
// survives is the rule, not the shape:
//
//     may act = role carries the action × grant reaches the target
//
// What changed, deliberately (docs/migration-v1.md):
// - an organization is independent and may participate in many operations;
// - an actor is organization-scoped, named by the stable pair
//   `(organizationId, actorId)`;
// - grants, and primary/worn-hat selection, are operation-local;
// - roles and their actions come from a policy bundle, not from entities or
//   ad-hoc tables;
// - reach is discrete — a grant reaches a team or a site and its teams.
//   There is no path hierarchy and no inheritance walk.
//
// This module is data and pure functions: no I/O, no storage, no clock, no
// Cloudflare, compiled with `types: []`.
import { actionsOf } from "./policy.js";
/** The named narrowing behind the revocation filter. This is the runtime
 * check the type records — the predicate is where the claim is made, and
 * `wearableGrants` routes every grant through it. */
export const isActiveGrant = (grant) => grant.revoked !== true;
/** The visible, retryable workflow — never a distributed transaction. The
 * operation invites and activates (activation is canonical); the
 * organization accepts; either side may revoke, terminally. */
export const transitionParticipation = (organizationId, operationId, current, event) => {
    if (event.kind === "invite") {
        if (event.by !== "operation")
            return { ok: false, problem: "only the operation invites" };
        if (current !== undefined)
            return { ok: false, problem: "the organization is already participating" };
        return {
            ok: true,
            participation: { organizationId, operationId, status: "invited" },
        };
    }
    if (current === undefined)
        return { ok: false, problem: "the organization is not participating" };
    if (event.kind === "revoke") {
        if (current.status === "revoked")
            return { ok: false, problem: "participation is already revoked" };
        return { ok: true, participation: { ...current, status: "revoked" } };
    }
    if (event.kind === "accept") {
        if (event.by !== "organization")
            return { ok: false, problem: "only the organization accepts" };
        if (current.status !== "invited")
            return { ok: false, problem: `cannot accept from ${current.status}` };
        return { ok: true, participation: { ...current, status: "accepted" } };
    }
    if (event.by !== "operation")
        return { ok: false, problem: "only the operation activates" };
    if (current.status !== "accepted")
        return { ok: false, problem: `cannot activate from ${current.status}` };
    return { ok: true, participation: { ...current, status: "active" } };
};
/** Apply an event to a participation list: find the current standing, decide
 * with `transitionParticipation`, and return the new list. This is the only
 * way a participation status should move — an adapter that writes the status
 * directly is an adapter that can flip `revoked` back to `active`, which the
 * state machine above refuses by construction.
 *
 * Seeding is not transitioning: bootstrap and restore install a declared
 * status and must not come through here. */
export const applyParticipationEvent = (participations, organizationId, operationId, event) => {
    const current = participations.find((p) => p.organizationId === organizationId && p.operationId === operationId);
    const transition = transitionParticipation(organizationId, operationId, current, event);
    if (!transition.ok)
        return transition;
    const participation = transition.participation;
    const next = current === undefined
        ? [...participations, participation]
        : participations.map((p) => (p === current ? participation : p));
    return { ok: true, participations: next, participation };
};
/** Looks up by a plain string: the team id comes from a caller-supplied
 * `TargetRef`, which the host builds from its own records. Comparing it
 * against stored ids is the point; it is not itself a domain id yet. */
const siteOfTeam = (snapshot, teamId) => snapshot.teams.find((t) => t.teamId === teamId)?.siteId;
/** A grant reaches its own team; a site grant reaches the site and every
 * team at it. Nothing reaches a whole operation. */
export const grantReaches = (snapshot, grant, target) => {
    if (target.kind === "operation")
        return false;
    if (grant.target.kind === "site") {
        if (target.kind === "site")
            return grant.target.siteId === target.siteId;
        return siteOfTeam(snapshot, target.teamId) === grant.target.siteId;
    }
    if (target.kind === "team")
        return grant.target.teamId === target.teamId;
    return false;
};
/** The grants an actor could wear at this operation right now: not revoked,
 * actor enabled, and the organization's participation active. The return
 * type says the revocation filter ran: every element is an `ActiveGrant`. */
export const wearableGrants = (snapshot, organizationId, actorId, operationId) => {
    const actor = snapshot.actors.find((a) => a.organizationId === organizationId && a.actorId === actorId);
    if (actor === undefined || actor.disabled)
        return [];
    const participating = snapshot.participations.some((p) => p.organizationId === organizationId &&
        p.operationId === operationId &&
        p.status === "active");
    if (!participating)
        return [];
    return snapshot.grants
        .filter((g) => g.operationId === operationId &&
        g.organizationId === organizationId &&
        g.actorId === actorId)
        .filter(isActiveGrant);
};
/** The one ranked selection: the primary first, then the deterministic
 * order by (role, target id, grant id). Every caller that must choose a
 * default hat reads it — worn-hat selection, the decision rule, and envelope
 * issuance — so the rule is written once. Only active grants enter; the
 * revocation filter happened upstream in `wearableGrants`. */
export const firstByRank = (grants) => {
    const targetId = (g) => g.target.kind === "team" ? g.target.teamId : g.target.siteId;
    return [...grants].sort((a, b) => {
        const primaryA = a.primary === true ? 0 : 1;
        const primaryB = b.primary === true ? 0 : 1;
        if (primaryA !== primaryB)
            return primaryA - primaryB;
        if (a.role !== b.role)
            return a.role < b.role ? -1 : 1;
        const targetA = targetId(a);
        const targetB = targetId(b);
        if (targetA !== targetB)
            return targetA < targetB ? -1 : 1;
        if (a.grantId !== b.grantId)
            return a.grantId < b.grantId ? -1 : 1;
        return 0;
    })[0];
};
/** A hat the bundle can describe. `undefined` when the grant names a role
 * the bundle does not carry: that is a snapshot inconsistency
 * (`invariantProblems` reports it), never a role with no actions. */
const hatOf = (bundle, grant) => {
    const role = actionsOf(bundle, grant.role);
    if (!role.found)
        return undefined;
    return {
        grantId: grant.grantId,
        role: grant.role,
        actions: role.actions,
        target: grant.target,
    };
};
/** Worn-hat selection, operation-local: the primary when it is wearable at
 * the target, otherwise the deterministic first by (role, target id, grant
 * id). A revoked or disabled primary never blocks the fallback. */
export const selectWornHat = (snapshot, bundle, organizationId, actorId, operationId, target) => {
    const wearable = wearableGrants(snapshot, organizationId, actorId, operationId).filter((g) => grantReaches(snapshot, g, target));
    const chosen = firstByRank(wearable);
    if (chosen === undefined)
        return undefined;
    return hatOf(bundle, chosen);
};
/**
 * The rule, in the model's order: wear the hat first (primary or fallback),
 * then ask whether its role carries the action. The formula stays an
 * implementation rule — application callers ask the authority runtime or the
 * access module, not this function directly.
 */
export const decide = (snapshot, bundle, organizationId, actorId, operationId, action, target) => {
    const wearable = wearableGrants(snapshot, organizationId, actorId, operationId);
    if (wearable.length === 0)
        return { allowed: false, reason: "not-admitted" };
    const reaching = wearable.filter((g) => grantReaches(snapshot, g, target));
    const chosen = firstByRank(reaching);
    if (chosen === undefined)
        return { allowed: false, reason: "out-of-reach" };
    // An unknown role is not a hat with no actions. Collapsing the two is
    // what `actionsOf`'s contract forbids: it would deny with
    // `no-capability`, describing the actor, when the fault is that the
    // snapshot and the bundle disagree.
    const hat = hatOf(bundle, chosen);
    if (hat === undefined)
        return { allowed: false, reason: "policy-inconsistent" };
    if (!hat.actions.includes(action))
        return { allowed: false, reason: "no-capability" };
    return { allowed: true, hat };
};
;
/** What the issuer will place in an envelope, computed here so the verifier
 * never rebuilds it. Each read-policy axis contributes independently; v1 has
 * only the organization axis (`granted-teams`: the organizations of the
 * teams the actor's wearable grants reach; `all-participating`: every
 * organization actively participating). A future team-read axis composes
 * here without changing what this axis means. */
export const readReach = (snapshot, bundle, organizationId, actorId, operationId) => {
    const teamsAt = (siteId) => snapshot.teams.filter((t) => t.siteId === siteId);
    const reached = new Set();
    for (const grant of wearableGrants(snapshot, organizationId, actorId, operationId)) {
        if (grant.target.kind === "team")
            reached.add(grant.target.teamId);
        else
            for (const team of teamsAt(grant.target.siteId))
                reached.add(team.teamId);
    }
    const organizationPolicy = bundle.readPolicy.organizations;
    const orgs = organizationPolicy === "all-participating"
        ? snapshot.participations
            .filter((p) => p.operationId === operationId && p.status === "active")
            .map((p) => p.organizationId)
        : [...reached].map((teamId) => snapshot.teams.find((t) => t.teamId === teamId))
            .filter((t) => t !== undefined)
            .map((t) => t.organizationId);
    const readableOrganizationIds = [...new Set(orgs)];
    const readableTeamIds = [...reached].filter((teamId) => {
        const team = snapshot.teams.find((t) => t.teamId === teamId);
        return team !== undefined && !readableOrganizationIds.includes(team.organizationId);
    });
    return { readableOrganizationIds, readableTeamIds };
};
// --- routing facts -------------------------------------------------------------------
/** One DNS label, lower-case, no empty hyphen groups; `www` is the apex
 * reservation, so it is never an operation slug or alias label. */
const ROUTING_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const isHostnameLabel = (value) => value !== "www" && ROUTING_LABEL.test(value);
/** A site path is one segment; it is a path, not a hostname, so `www` is not
 * reserved there. */
export const isSitePath = (value) => ROUTING_LABEL.test(value);
// --- invariants ---------------------------------------------------------------------
/** One sentence per violation. An empty list is the only healthy snapshot. */
export const invariantProblems = (snapshot, bundle) => {
    const problems = [];
    const orgs = new Set(snapshot.organizations.map((o) => o.organizationId));
    const actors = new Set(snapshot.actors.map((a) => `${a.organizationId}/${a.actorId}`));
    const sites = new Map(snapshot.sites.map((s) => [s.siteId, s]));
    const teams = new Map(snapshot.teams.map((t) => [t.teamId, t]));
    const operations = new Set(snapshot.operations.map((o) => o.operationId));
    for (const actor of snapshot.actors) {
        if (!orgs.has(actor.organizationId)) {
            problems.push(`actor ${actor.actorId} names the unknown organization ${actor.organizationId}`);
        }
    }
    for (const team of snapshot.teams) {
        const site = sites.get(team.siteId);
        if (site === undefined)
            problems.push(`team ${team.teamId} names the unknown site ${team.siteId}`);
        else if (!operations.has(site.operationId)) {
            problems.push(`site ${site.siteId} names the unknown operation ${site.operationId}`);
        }
        if (!orgs.has(team.organizationId)) {
            problems.push(`team ${team.teamId} names the unknown organization ${team.organizationId}`);
        }
    }
    for (const participation of snapshot.participations) {
        if (!orgs.has(participation.organizationId)) {
            problems.push(`a participation names the unknown organization ${participation.organizationId}`);
        }
        if (!operations.has(participation.operationId)) {
            problems.push(`a participation names the unknown operation ${participation.operationId}`);
        }
    }
    const primaries = new Map();
    for (const grant of snapshot.grants) {
        if (!operations.has(grant.operationId))
            problems.push(`grant ${grant.grantId} names an unknown operation`);
        if (!actors.has(`${grant.organizationId}/${grant.actorId}`)) {
            problems.push(`grant ${grant.grantId} names an unknown actor`);
        }
        if (!snapshot.participations.some((p) => p.organizationId === grant.organizationId &&
            p.operationId === grant.operationId &&
            p.status !== "revoked")) {
            problems.push(`grant ${grant.grantId} has no participation to stand on`);
        }
        if (!actionsOf(bundle, grant.role).found) {
            problems.push(`grant ${grant.grantId} names the unknown role "${grant.role}"`);
        }
        if (grant.target.kind === "team" && !teams.has(grant.target.teamId)) {
            problems.push(`grant ${grant.grantId} names an unknown team`);
        }
        if (grant.target.kind === "site" && !sites.has(grant.target.siteId)) {
            problems.push(`grant ${grant.grantId} names an unknown site`);
        }
        if (grant.target.kind === "site" && sites.get(grant.target.siteId)?.operationId !== grant.operationId) {
            problems.push(`grant ${grant.grantId} reaches a site outside its operation`);
        }
        if (grant.target.kind === "team") {
            const siteOfTarget = teams.get(grant.target.teamId)?.siteId;
            // an unknown team is already reported above; this asks only whether a
            // known team's site belongs to the grant's operation
            if (siteOfTarget !== undefined && sites.get(siteOfTarget)?.operationId !== grant.operationId) {
                problems.push(`grant ${grant.grantId} reaches a team outside its operation`);
            }
        }
        if (grant.primary === true) {
            const key = `${grant.operationId}/${grant.organizationId}/${grant.actorId}`;
            primaries.set(key, (primaries.get(key) ?? 0) + 1);
        }
    }
    for (const [key, count] of primaries) {
        if (count > 1)
            problems.push(`${key} has ${count} primary hats; one per actor per operation`);
    }
    // Routing facts are operation-authority facts. A snapshot may predate them
    // (no slug, no paths), but it may not carry half of the pair: a slug with a
    // pathless site, or a path with no slug, is a routing projection with no
    // source. Labels are checked here because the registry copies them into a
    // hostname namespace without reinterpreting them.
    const slugs = new Map();
    for (const operation of snapshot.operations) {
        const opSites = snapshot.sites.filter((site) => site.operationId === operation.operationId);
        const hasPath = opSites.some((site) => site.path !== undefined);
        if (operation.slug === undefined) {
            if (hasPath)
                problems.push(`operation ${operation.operationId} has site paths but no slug`);
        }
        else {
            if (!isHostnameLabel(operation.slug)) {
                problems.push(`operation ${operation.operationId} has an invalid slug "${operation.slug}"`);
            }
            const existing = slugs.get(operation.slug);
            if (existing !== undefined && existing !== operation.operationId) {
                problems.push(`operations ${existing} and ${operation.operationId} share the slug "${operation.slug}"`);
            }
            slugs.set(operation.slug, operation.operationId);
            if (opSites.some((site) => site.path === undefined)) {
                problems.push(`operation ${operation.operationId} has a slug but a site without a path`);
            }
        }
        const paths = new Map();
        const aliases = new Map();
        for (const site of opSites) {
            if (site.path !== undefined) {
                if (!isSitePath(site.path)) {
                    problems.push(`site ${site.siteId} has an invalid path "${site.path}"`);
                }
                const existingPath = paths.get(site.path);
                if (existingPath !== undefined) {
                    problems.push(`sites ${existingPath} and ${site.siteId} share the path "${site.path}"`);
                }
                paths.set(site.path, site.siteId);
            }
            for (const alias of site.aliases) {
                if (!isHostnameLabel(alias)) {
                    problems.push(`site ${site.siteId} has an invalid alias "${alias}"`);
                }
                if (operation.slug !== undefined && alias === operation.slug) {
                    problems.push(`site ${site.siteId} alias "${alias}" collides with the operation slug`);
                }
                const existingAlias = aliases.get(alias);
                if (existingAlias !== undefined && existingAlias !== site.siteId) {
                    problems.push(`sites ${existingAlias} and ${site.siteId} share the alias "${alias}"`);
                }
                aliases.set(alias, site.siteId);
            }
        }
    }
    return problems;
};
