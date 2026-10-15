// The organization model — types and predicates, and nothing else.
//
// This file is compiled with `types: []` (see tsconfig.core.json), so an
// accidental `node:*` import fails to compile. The model is data and pure
// predicates; persistence lives behind `OrgHatsRepository` (./port.ts) and the
// SQLite reference adapter (./node.ts).
//
// The model has five entities — Actor, Role, Team, Organization, Scope — and
// two relationships: a **grant** (an actor may wear a role over a team or a
// scope) and a **capability** (a role may perform an action). Affiliation is
// not a third edge: an actor is affiliated with a team when they hold a grant
// over it whose role carries the application's speech act.

/** Every id is caller-supplied and opaque — a UUID or a slug. */
export type Id = string;

/** What a grant reaches: a team, or a scope, each identified by its scope path. */
export type Target =
  | { kind: "team"; team: Id; scopePath: string }
  | { kind: "scope"; scopePath: string };

export const onTeam = (team: Id, scopePath: string): Target => ({ kind: "team", team, scopePath });
export const atScope = (scopePath: string): Target => ({ kind: "scope", scopePath });

// The application names every action — this module names none. Speaking is
// the one act the model knows *of* without naming: a team is a group that
// acts through its members, and the membership questions (`affiliated`,
// `maySpeak`) take the speech act as a parameter — send, author, post.

export interface Grant {
  id: Id;
  actorId: Id;
  roleId: Id;
  organizationId: Id;
  teamId: Id | null;
  scopeId: Id | null;
  primary: boolean;
  default: boolean;
}

/** A grant resolved to what the predicates need: its role's actions and where
 * it is anchored. The adapter joins `role → capability` and `team → scope` to
 * fill these, which is what keeps every predicate below pure and
 * synchronous.
 *
 * **Structural and open.** A consumer may extend a hat and the predicates
 * accept any object with these fields. It is an interface on purpose: do not
 * seal it with an exact type, a nominal brand, or a class. */
export interface HeldHat {
  readonly grant: Grant;
  readonly actions: readonly string[];
  /** The scope this hat is anchored at: the team's scope, or the grant's own.
   * A hat is wearable where its anchor covers, and reaches a scope target the
   * same way. */
  readonly anchorPath: string;
  /** Display names for the legible snapshot (OH-QM-05): `supervisor:drive@north`
   * is words, and ids cannot produce them. Optional and adapter-filled, from
   * joins the adapter already makes; read by the predicates never. A host
   * that needs more still extends — the interface stays open. */
  readonly roleName?: string;
  /** The team's name, for a team-bound hat. */
  readonly teamName?: string;
  /** The anchor scope's name — where the hat lives, whichever kind of grant. */
  readonly scopeName?: string;
}

// --- scope paths -------------------------------------------------------------
//
// A scope's materialized path joins ids with "/", so a scope id must not
// contain "/". Coverage is a prefix test, never a recursive walk.

export const childPath = (parentPath: string, id: Id): string => `${parentPath}${id}/`;

export const scopeCovers = (ancestorPath: string, descendantPath: string): boolean =>
  descendantPath.startsWith(ancestorPath);

/** The reading half of the path rules: `childPath` builds, these parse. The
 * format is the model's, and a host that reimplements its parsing gets it
 * wrong the day the format changes — so the pair lives here, beside the
 * builder. */

/** The id of the scope a path names — its last segment. A root path names
 * its root; `/` names nothing. */
export const leafScopeId = (scopePath: string): string =>
  scopePath.split("/").filter((segment) => segment !== "").at(-1) ?? "";

/** The path of a scope's parent — the same path less its last segment. A
 * root's parent is `/`, the outermost boundary; `/` is its own parent. */
export const parentPath = (scopePath: string): string => {
  const leaf = leafScopeId(scopePath);
  return leaf === "" ? "/" : scopePath.slice(0, scopePath.length - leaf.length - 1);
};

// --- the predicates ----------------------------------------------------------

/** Does this hat act on this target? A team grant reaches its team; a
 * scope-bound grant reaches a scope and never a team. */
export function reach(hat: HeldHat, target: Target): boolean {
  if (!scopeCovers(hat.anchorPath, target.scopePath)) return false;
  return target.kind === "team" ? hat.grant.teamId === target.team : hat.grant.teamId === null;
}

/** Can the active hat do this action, on this target? */
export function can(hat: HeldHat | null, action: string, target: Target): boolean {
  if (hat === null) return false;
  if (!hat.actions.includes(action)) return false;
  return reach(hat, target);
}

/** Is this actor on the target's team — the roster predicate? A member
 * holds a grant over the target whose role carries the application's speech
 * act. Membership is a standing, checked against *held* grants; no hat need
 * be worn, and revoking the grant removes the member in one row. */
export function affiliated(hats: readonly HeldHat[], target: Target, action: string): boolean {
  return hats.some((h) => reach(h, target) && h.actions.includes(action));
}

/** May the actor speak on behalf of the target, wearing this hat? Speaking
 * for a team is inherent to teams — a team is a group that acts through its
 * members — and the test is two-edged: the worn hat must *reach* the target
 * (the session is there), and the actor must be *affiliated* (a held grant
 * over it carries the speech act). The worn hat need not itself carry the
 * action, so a working lead speaks for their own team without switching
 * hats. The application names the speech act — send, author, post. */
export function maySpeak(worn: HeldHat | null, target: Target, held: readonly HeldHat[], action: string): boolean {
  if (worn === null || !reach(worn, target)) return false;
  return affiliated(held, target, action);
}

/** What a session claims: the worn hat's grant id, or a matcher. A
 * name-keyed claim — a UUID does not survive a re-seed, a name does — passes
 * `(hat) => ...` and never translates through a shim. Compose enough names
 * to be unique: `roleName` alone is not — one actor may hold *Supervisor*
 * over two teams — while `role:team@scope` is, and the grant **id** is the
 * unique key when it is available. */
export type HatClaim = Id | ((hat: HeldHat) => boolean);

/** The hats offered at a scope: those whose anchor covers it. Selects from
 * the array it is given, so it is generic in the hat type — a host's
 * extended hat comes back as itself, not as `HeldHat`. */
export function wearableAt<H extends HeldHat>(hats: readonly H[], scopePath: string): H[] {
  return hats.filter((h) => scopeCovers(h.anchorPath, scopePath));
}

/** Is the actor admitted here at all? Any wearable hat admits. */
export function admitted(hats: readonly HeldHat[], scopePath: string): boolean {
  return wearableAt(hats, scopePath).length > 0;
}

/** The hat in force: the claimed one if still held and wearable, else the
 * default, else the primary, else the first. `wearable` is already filtered to
 * this scope, so a revoked claim cannot be returned — the re-validation.
 * `claim` is a grant **id** or a matcher (a host whose session claim is
 * name-keyed matches on the name here instead of translating ids). */
export function wornHat<H extends HeldHat>(wearable: readonly H[], claim: HatClaim | null = null): H | null {
  if (claim !== null) {
    const held = wearable.find(typeof claim === "string" ? (h) => h.grant.id === claim : claim);
    if (held) return held;
  }
  return wearable.find((h) => h.grant.default) ?? wearable.find((h) => h.grant.primary) ?? wearable[0] ?? null;
}

/** The organizations an actor is in *through a team* — the read boundary. A
 * scope-bound configuring grant names an organization but adds no read reach.
 *
 * Read reach is **team-bearing** (this function); *authoring* affiliation is
 * **capability-derived** (`maySpeak`). Two correct rules one word apart: this
 * one answers "whose teams may I read", the other "may I speak for this". */
export function organizationsOf(hats: readonly HeldHat[]): Id[] {
  return [...new Set(hats.filter((h) => h.grant.teamId !== null).map((h) => h.grant.organizationId))];
}

// --- the reference schema ----------------------------------------------------
//
// The canonical DDL. A host does not apply it — it owns its own migrations —
// but it is the shape a host diffs against, and it is what the reference
// adapter installs for the walkthroughs and tests.

export const SCHEMA = `
  PRAGMA foreign_keys = ON;

  -- Every id is TEXT and caller-supplied. A scope id must not contain "/".
  CREATE TABLE scope (
    id        TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES scope(id),
    name      TEXT NOT NULL,
    path      TEXT NOT NULL
  );
  CREATE UNIQUE INDEX scope_identity ON scope (COALESCE(parent_id, ''), name);

  -- An organization belongs to one operation (a root scope).
  CREATE TABLE organization (
    id       TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES scope(id),
    name     TEXT NOT NULL,
    UNIQUE (scope_id, name)
  );

  -- A label, not a key.
  CREATE TABLE actor (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE team (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organization(id),
    scope_id        TEXT NOT NULL REFERENCES scope(id),
    name            TEXT NOT NULL,
    UNIQUE (scope_id, name)
  );
  CREATE INDEX team_by_org ON team (organization_id);

  CREATE TABLE role (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE capability (
    role_id TEXT NOT NULL REFERENCES role(id),
    action  TEXT NOT NULL
  );
  CREATE UNIQUE INDEX capability_identity ON capability (role_id, action);

  CREATE TABLE grant (
    id              TEXT PRIMARY KEY,
    actor_id        TEXT NOT NULL REFERENCES actor(id),
    role_id         TEXT NOT NULL REFERENCES role(id),
    organization_id TEXT NOT NULL REFERENCES organization(id),
    team_id         TEXT REFERENCES team(id),
    scope_id        TEXT REFERENCES scope(id),
    is_primary      INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
    is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    CHECK ((team_id IS NULL) <> (scope_id IS NULL))
  );
  CREATE INDEX grant_by_actor ON grant (actor_id);
  CREATE INDEX grant_by_team ON grant (team_id);
  CREATE INDEX grant_by_scope ON grant (scope_id);
  CREATE UNIQUE INDEX grant_one_primary ON grant (actor_id, organization_id) WHERE is_primary = 1;
  CREATE UNIQUE INDEX grant_one_default ON grant (actor_id, organization_id) WHERE is_default = 1;
  CREATE UNIQUE INDEX grant_identity
    ON grant (actor_id, organization_id, role_id, COALESCE(team_id, ''), COALESCE(scope_id, ''));
`;
