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
// over it whose role may author.
export const onTeam = (team, scopePath) => ({ kind: "team", team, scopePath });
export const atScope = (scopePath) => ({ kind: "scope", scopePath });
/** The application's actions. The model reads `AUTHOR` by name: it is the
 * affiliation bit. */
export const AUTHOR = "author";
export const READ = "read_reports";
export const RESOLVE = "resolve";
export const CONFIGURE = "configure";
// --- scope paths -------------------------------------------------------------
//
// A scope's materialized path joins ids with "/", so a scope id must not
// contain "/". Coverage is a prefix test, never a recursive walk.
export const childPath = (parentPath, id) => `${parentPath}${id}/`;
export const scopeCovers = (ancestorPath, descendantPath) => descendantPath.startsWith(ancestorPath);
// --- the predicates ----------------------------------------------------------
/** Does this hat act on this target? A team grant reaches its team; a
 * scope-bound grant reaches a scope and never a team. */
export function reach(hat, target) {
    if (!scopeCovers(hat.anchorPath, target.scopePath))
        return false;
    return target.kind === "team" ? hat.grant.teamId === target.team : hat.grant.teamId === null;
}
/** Can the active hat do this action, on this target? */
export function can(hat, action, target) {
    if (hat === null)
        return false;
    if (!hat.actions.includes(action))
        return false;
    return reach(hat, target);
}
/** The two-edge rule: speaking for a team needs the worn hat to reach it and a
 * *held* grant over it whose role may author. The worn hat need not itself
 * carry AUTHOR, so a lead files on their own team without switching hats. */
export function maySpeak(worn, target, held) {
    if (worn === null || !reach(worn, target))
        return false;
    return held.some((h) => reach(h, target) && h.actions.includes(AUTHOR));
}
/** The hats offered at a scope: those whose anchor covers it. */
export function wearableAt(hats, scopePath) {
    return hats.filter((h) => scopeCovers(h.anchorPath, scopePath));
}
/** Is the actor admitted here at all? Any wearable hat admits. */
export function admitted(hats, scopePath) {
    return wearableAt(hats, scopePath).length > 0;
}
/** The hat in force: the claimed one if still held and wearable, else the
 * default, else the primary, else the first. `wearable` is already filtered to
 * this scope, so a revoked claim cannot be returned — the re-validation.
 * `claimedId` is an **id**; a host whose session claim is name-keyed (a UUID
 * does not survive a re-seed, a name does) maps name → id against the loaded
 * set before calling. */
export function wornHat(wearable, claimedId = null) {
    if (claimedId !== null) {
        const held = wearable.find((h) => h.grant.id === claimedId);
        if (held)
            return held;
    }
    return wearable.find((h) => h.grant.default) ?? wearable.find((h) => h.grant.primary) ?? wearable[0] ?? null;
}
/** The organizations an actor is in *through a team* — the read boundary. A
 * scope-bound configuring grant names an organization but adds no read reach.
 *
 * Read reach is **team-bearing** (this function); *authoring* affiliation is
 * **capability-derived** (`maySpeak`). Two correct rules one word apart: this
 * one answers "whose teams may I read", the other "may I speak for this". */
export function organizationsOf(hats) {
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
