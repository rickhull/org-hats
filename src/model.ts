// The v1 organization model — the smallest reusable statement of who may
// act, in what capacity, over which group, and where.
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
//   capability tables;
// - reach is discrete — a grant reaches a team or a site and its teams.
//   There is no scope-path hierarchy and no coverage walk.
//
// This module is data and pure functions: no I/O, no storage, no clock, no
// Cloudflare, compiled with `types: []`.

import type { ActorId, OperationId, OrganizationId, SiteId, TeamId } from "./contract.ts";
import type { PolicyBundle } from "./policy.ts";
import { actionsOf } from "./policy.ts";

// --- entities ------------------------------------------------------------------

export interface Organization {
  readonly organizationId: OrganizationId;
  readonly displayName?: string;
}

/** An actor is a person known to one organization. The pair with
 * `organizationId` is the actor's stable identity across every operation
 * that organization joins; equal emails never merge two actors. */
export interface Actor {
  readonly organizationId: OrganizationId;
  readonly actorId: ActorId;
  readonly displayName?: string;
  /** A disabled actor holds no wearable hat and issues no new access; the
   * flag is organization-owned and binds every operation. */
  readonly disabled?: boolean;
}

export interface Operation {
  readonly operationId: OperationId;
  readonly displayName?: string;
  /** `true` marks a time-boxed undertaking whose access closes on a
   * schedule rather than by revocation alone. */
  readonly bounded?: boolean;
}

/** A site is an independently administered place inside one operation; a
 * team always belongs to exactly one site, which is what makes site
 * independence structural. */
export interface Site {
  readonly siteId: SiteId;
  readonly operationId: OperationId;
  readonly displayName?: string;
  readonly aliases: readonly string[];
}

export interface Team {
  readonly teamId: TeamId;
  readonly siteId: SiteId;
  readonly organizationId: OrganizationId;
  readonly displayName?: string;
}

/** What a grant reaches: one team, or a site and every team at it. */
export type GrantTarget =
  | { readonly kind: "team"; readonly teamId: TeamId }
  | { readonly kind: "site"; readonly siteId: SiteId };

/** A hat is an operation-local grant: this organization's actor may act in
 * this role over this target. `primary` marks the actor's default hat at
 * the operation; one per actor per operation. */
export interface Grant {
  readonly grantId: string;
  readonly operationId: OperationId;
  readonly organizationId: OrganizationId;
  readonly actorId: ActorId;
  /** A role title from the operation's active policy bundle. */
  readonly role: string;
  readonly target: GrantTarget;
  readonly primary?: boolean;
  /** A revoked grant is retained for audit and never wearable; revocation
   * is immediate for new issuance. */
  readonly revoked?: boolean;
}

/** One organization's standing at one operation. `active` is canonical —
 * recorded by the operation, and the only state under which hats are
 * wearable. */
export interface Participation {
  readonly organizationId: OrganizationId;
  readonly operationId: OperationId;
  readonly status: "invited" | "accepted" | "active" | "revoked";
}

/** The whole organizational state one operation's authority owns, plus the
 * shared organization directory it references. */
export interface Snapshot {
  readonly organizations: readonly Organization[];
  readonly actors: readonly Actor[];
  readonly operations: readonly Operation[];
  readonly sites: readonly Site[];
  readonly teams: readonly Team[];
  readonly grants: readonly Grant[];
  readonly participations: readonly Participation[];
}

// --- participation: the pure state machine ---------------------------------------

export type ParticipationEvent =
  | { readonly kind: "invite"; readonly by: "operation" }
  | { readonly kind: "accept"; readonly by: "organization" }
  | { readonly kind: "activate"; readonly by: "operation" }
  | { readonly kind: "revoke"; readonly by: "operation" | "organization" };

export type ParticipationTransition =
  | { readonly ok: true; readonly participation: Participation }
  | { readonly ok: false; readonly problem: string };

/** The visible, retryable workflow — never a distributed transaction. The
 * operation invites and activates (activation is canonical); the
 * organization accepts; either side may revoke, terminally. */
export const transitionParticipation = (
  organizationId: OrganizationId,
  operationId: OperationId,
  current: Participation | undefined,
  event: ParticipationEvent,
): ParticipationTransition => {
  if (event.kind === "invite") {
    if (event.by !== "operation") return { ok: false, problem: "only the operation invites" };
    if (current !== undefined) return { ok: false, problem: "the organization is already participating" };
    return {
      ok: true,
      participation: { organizationId, operationId, status: "invited" },
    };
  }
  if (current === undefined) return { ok: false, problem: "the organization is not participating" };
  if (event.kind === "revoke") {
    if (current.status === "revoked") return { ok: false, problem: "participation is already revoked" };
    return { ok: true, participation: { ...current, status: "revoked" } };
  }
  if (event.kind === "accept") {
    if (event.by !== "organization") return { ok: false, problem: "only the organization accepts" };
    if (current.status !== "invited") return { ok: false, problem: `cannot accept from ${current.status}` };
    return { ok: true, participation: { ...current, status: "accepted" } };
  }
  if (event.by !== "operation") return { ok: false, problem: "only the operation activates" };
  if (current.status !== "accepted") return { ok: false, problem: `cannot activate from ${current.status}` };
  return { ok: true, participation: { ...current, status: "active" } };
};

// --- reach and wearability --------------------------------------------------------

export type TargetRef =
  | { readonly kind: "operation" }
  | { readonly kind: "site"; readonly siteId: SiteId }
  | { readonly kind: "team"; readonly teamId: TeamId };

const siteOfTeam = (snapshot: Snapshot, teamId: TeamId): SiteId | undefined =>
  snapshot.teams.find((t) => t.teamId === teamId)?.siteId;

/** A grant reaches its own team; a site grant reaches the site and every
 * team at it. Nothing reaches a whole operation. */
export const grantReaches = (snapshot: Snapshot, grant: Grant, target: TargetRef): boolean => {
  if (target.kind === "operation") return false;
  if (grant.target.kind === "site") {
    if (target.kind === "site") return grant.target.siteId === target.siteId;
    return siteOfTeam(snapshot, target.teamId) === grant.target.siteId;
  }
  if (target.kind === "team") return grant.target.teamId === target.teamId;
  return false;
};

/** The grants an actor could wear at this operation right now: not revoked,
 * actor enabled, and the organization's participation active. */
export const wearableGrants = (
  snapshot: Snapshot,
  organizationId: OrganizationId,
  actorId: ActorId,
  operationId: OperationId,
): readonly Grant[] => {
  const actor = snapshot.actors.find(
    (a) => a.organizationId === organizationId && a.actorId === actorId,
  );
  if (actor === undefined || actor.disabled) return [];
  const participating = snapshot.participations.some(
    (p) =>
      p.organizationId === organizationId &&
      p.operationId === operationId &&
      p.status === "active",
  );
  if (!participating) return [];
  return snapshot.grants.filter(
    (g) =>
      g.operationId === operationId &&
      g.organizationId === organizationId &&
      g.actorId === actorId &&
      g.revoked !== true,
  );
};

/** A grant resolved to what a decision carries: the role's actions under the
 * bundle and where the hat reaches. Historical acts keep this snapshot. */
export interface WornHat {
  readonly grantId: string;
  readonly role: string;
  readonly actions: readonly string[];
  readonly target: GrantTarget;
}

const hatOf = (bundle: PolicyBundle, grant: Grant): WornHat => ({
  grantId: grant.grantId,
  role: grant.role,
  actions: actionsOf(bundle, grant.role) ?? [],
  target: grant.target,
});

/** Worn-hat selection, operation-local: the primary when it is wearable at
 * the target, otherwise the deterministic first by (role, target id, grant
 * id). A revoked or disabled primary never blocks the fallback. */
export const selectWornHat = (
  snapshot: Snapshot,
  bundle: PolicyBundle,
  organizationId: OrganizationId,
  actorId: ActorId,
  operationId: OperationId,
  target: TargetRef,
): WornHat | undefined => {
  const wearable = wearableGrants(snapshot, organizationId, actorId, operationId).filter((g) =>
    grantReaches(snapshot, g, target),
  );
  if (wearable.length === 0) return undefined;
  const rank = (g: Grant): string =>
    `${g.primary === true ? 0 : 1}|${g.role}|${g.target.kind === "team" ? g.target.teamId : g.target.siteId}|${g.grantId}`;
  const sorted = [...wearable].sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0));
  const chosen = sorted[0];
  if (chosen === undefined) return undefined;
  return hatOf(bundle, chosen);
};

// --- the decision -----------------------------------------------------------------

export type DenialReason =
  /** the actor holds no wearable hat here: unknown, disabled, not
   * participating, or every grant revoked */
  | "not-admitted"
  /** the worn hat reaches the target but its role does not carry the action */
  | "no-capability"
  /** no grant reaches the target at all */
  | "out-of-reach";

export type Decision =
  | { readonly allowed: true; readonly hat: WornHat }
  | { readonly allowed: false; readonly reason: DenialReason };

/**
 * The rule, in the model's order: wear the hat first (primary or fallback),
 * then ask whether its role carries the action. The formula stays an
 * implementation rule — application callers ask the authority runtime or the
 * access module, not this function directly.
 */
export const decide = (
  snapshot: Snapshot,
  bundle: PolicyBundle,
  organizationId: OrganizationId,
  actorId: ActorId,
  operationId: OperationId,
  action: string,
  target: TargetRef,
): Decision => {
  const wearable = wearableGrants(snapshot, organizationId, actorId, operationId);
  if (wearable.length === 0) return { allowed: false, reason: "not-admitted" };
  if (!wearable.some((g) => grantReaches(snapshot, g, target))) {
    return { allowed: false, reason: "out-of-reach" };
  }
  const hat = selectWornHat(snapshot, bundle, organizationId, actorId, operationId, target);
  if (hat === undefined) return { allowed: false, reason: "out-of-reach" };
  if (!hat.actions.includes(action)) return { allowed: false, reason: "no-capability" };
  return { allowed: true, hat };
};

// --- read reach (computed under the active bundle) ---------------------------------

export interface ReadReach {
  readonly readableOrganizationIds: readonly OrganizationId[];
  /** Exceptional team grants only — reached teams whose organization is
   * outside the readable organization set. Empty for the shipped twins; a
   * crossed-organization grant target can make it non-empty under either
   * policy. */
  readonly readableTeamIds: readonly TeamId[];
};

/** What the issuer will place in an envelope, computed here so the verifier
 * never rebuilds it. Each read-policy axis contributes independently; v1 has
 * only the organization axis (`granted-teams`: the organizations of the
 * teams the actor's wearable grants reach; `all-participating`: every
 * organization actively participating). A future team-audience axis composes
 * here without changing what this axis means. */
export const readReach = (
  snapshot: Snapshot,
  bundle: PolicyBundle,
  organizationId: OrganizationId,
  actorId: ActorId,
  operationId: OperationId,
): ReadReach => {
  const teamsAt = (siteId: SiteId): readonly Team[] => snapshot.teams.filter((t) => t.siteId === siteId);
  const reached = new Set<TeamId>();
  for (const grant of wearableGrants(snapshot, organizationId, actorId, operationId)) {
    if (grant.target.kind === "team") reached.add(grant.target.teamId);
    else for (const team of teamsAt(grant.target.siteId)) reached.add(team.teamId);
  }
  const organizationPolicy = bundle.readPolicy.organizations;
  const orgs =
    organizationPolicy === "all-participating"
      ? snapshot.participations
          .filter((p) => p.operationId === operationId && p.status === "active")
          .map((p) => p.organizationId)
      : [...reached].map((teamId) => snapshot.teams.find((t) => t.teamId === teamId))
          .filter((t): t is Team => t !== undefined)
          .map((t) => t.organizationId);
  const readableOrganizationIds = [...new Set(orgs)];
  const readableTeamIds = [...reached].filter((teamId) => {
    const team = snapshot.teams.find((t) => t.teamId === teamId);
    return team !== undefined && !readableOrganizationIds.includes(team.organizationId);
  });
  return { readableOrganizationIds, readableTeamIds };
};

// --- invariants ---------------------------------------------------------------------

/** One sentence per violation. An empty list is the only healthy snapshot. */
export const invariantProblems = (snapshot: Snapshot, bundle: PolicyBundle): readonly string[] => {
  const problems: string[] = [];
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
    if (site === undefined) problems.push(`team ${team.teamId} names the unknown site ${team.siteId}`);
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
  const primaries = new Map<string, number>();
  for (const grant of snapshot.grants) {
    if (!operations.has(grant.operationId)) problems.push(`grant ${grant.grantId} names an unknown operation`);
    if (!actors.has(`${grant.organizationId}/${grant.actorId}`)) {
      problems.push(`grant ${grant.grantId} names an unknown actor`);
    }
    if (!snapshot.participations.some(
      (p) =>
        p.organizationId === grant.organizationId &&
        p.operationId === grant.operationId &&
        p.status !== "revoked",
    )) {
      problems.push(`grant ${grant.grantId} has no participation to stand on`);
    }
    if (actionsOf(bundle, grant.role) === undefined) {
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
    if (grant.target.kind === "team" && teams.get(grant.target.teamId)?.siteId !== undefined) {
      const siteId = teams.get(grant.target.teamId)?.siteId;
      if (sites.get(siteId ?? "")?.operationId !== grant.operationId) {
        problems.push(`grant ${grant.grantId} reaches a team outside its operation`);
      }
    }
    if (grant.primary === true) {
      const key = `${grant.operationId}/${grant.organizationId}/${grant.actorId}`;
      primaries.set(key, (primaries.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of primaries) {
    if (count > 1) problems.push(`${key} has ${count} primary hats; one per actor per operation`);
  }
  return problems;
};
