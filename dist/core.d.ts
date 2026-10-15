/** Every id is caller-supplied and opaque — a UUID or a slug. */
export type Id = string;
/** What a grant reaches: a team, or a scope, each identified by its scope path. */
export type Target = {
    kind: "team";
    team: Id;
    scopePath: string;
} | {
    kind: "scope";
    scopePath: string;
};
export declare const onTeam: (team: Id, scopePath: string) => Target;
export declare const atScope: (scopePath: string) => Target;
/** The application's actions. The model reads `AUTHOR` by name: it is the
 * affiliation bit. */
export declare const AUTHOR = "author";
export declare const READ = "read_reports";
export declare const RESOLVE = "resolve";
export declare const CONFIGURE = "configure";
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
export declare const childPath: (parentPath: string, id: Id) => string;
export declare const scopeCovers: (ancestorPath: string, descendantPath: string) => boolean;
/** The reading half of the path rules: `childPath` builds, these parse. The
 * format is the model's, and a host that reimplements its parsing gets it
 * wrong the day the format changes — so the pair lives here, beside the
 * builder. */
/** The id of the scope a path names — its last segment. A root path names
 * its root; `/` names nothing. */
export declare const leafScopeId: (scopePath: string) => string;
/** The path of a scope's parent — the same path less its last segment. A
 * root's parent is `/`, the outermost boundary; `/` is its own parent. */
export declare const parentPath: (scopePath: string) => string;
/** Does this hat act on this target? A team grant reaches its team; a
 * scope-bound grant reaches a scope and never a team. */
export declare function reach(hat: HeldHat, target: Target): boolean;
/** Can the active hat do this action, on this target? */
export declare function can(hat: HeldHat | null, action: string, target: Target): boolean;
/** The two-edge rule: speaking for a team needs the worn hat to reach it and a
 * *held* grant over it whose role may author. The worn hat need not itself
 * carry AUTHOR, so a lead files on their own team without switching hats. */
export declare function maySpeak(worn: HeldHat | null, target: Target, held: readonly HeldHat[]): boolean;
/** What a session claims: the worn hat's grant id, or a matcher. A
 * name-keyed claim — a UUID does not survive a re-seed, a name does — passes
 * `(hat) => ...` and never translates through a shim. */
export type HatClaim = Id | ((hat: HeldHat) => boolean);
/** The hats offered at a scope: those whose anchor covers it. Selects from
 * the array it is given, so it is generic in the hat type — a host's
 * extended hat comes back as itself, not as `HeldHat`. */
export declare function wearableAt<H extends HeldHat>(hats: readonly H[], scopePath: string): H[];
/** Is the actor admitted here at all? Any wearable hat admits. */
export declare function admitted(hats: readonly HeldHat[], scopePath: string): boolean;
/** The hat in force: the claimed one if still held and wearable, else the
 * default, else the primary, else the first. `wearable` is already filtered to
 * this scope, so a revoked claim cannot be returned — the re-validation.
 * `claim` is a grant **id** or a matcher (a host whose session claim is
 * name-keyed matches on the name here instead of translating ids). */
export declare function wornHat<H extends HeldHat>(wearable: readonly H[], claim?: HatClaim | null): H | null;
/** The organizations an actor is in *through a team* — the read boundary. A
 * scope-bound configuring grant names an organization but adds no read reach.
 *
 * Read reach is **team-bearing** (this function); *authoring* affiliation is
 * **capability-derived** (`maySpeak`). Two correct rules one word apart: this
 * one answers "whose teams may I read", the other "may I speak for this". */
export declare function organizationsOf(hats: readonly HeldHat[]): Id[];
export declare const SCHEMA = "\n  PRAGMA foreign_keys = ON;\n\n  -- Every id is TEXT and caller-supplied. A scope id must not contain \"/\".\n  CREATE TABLE scope (\n    id        TEXT PRIMARY KEY,\n    parent_id TEXT REFERENCES scope(id),\n    name      TEXT NOT NULL,\n    path      TEXT NOT NULL\n  );\n  CREATE UNIQUE INDEX scope_identity ON scope (COALESCE(parent_id, ''), name);\n\n  -- An organization belongs to one operation (a root scope).\n  CREATE TABLE organization (\n    id       TEXT PRIMARY KEY,\n    scope_id TEXT NOT NULL REFERENCES scope(id),\n    name     TEXT NOT NULL,\n    UNIQUE (scope_id, name)\n  );\n\n  -- A label, not a key.\n  CREATE TABLE actor (\n    id   TEXT PRIMARY KEY,\n    name TEXT NOT NULL\n  );\n\n  CREATE TABLE team (\n    id              TEXT PRIMARY KEY,\n    organization_id TEXT NOT NULL REFERENCES organization(id),\n    scope_id        TEXT NOT NULL REFERENCES scope(id),\n    name            TEXT NOT NULL,\n    UNIQUE (scope_id, name)\n  );\n  CREATE INDEX team_by_org ON team (organization_id);\n\n  CREATE TABLE role (\n    id   TEXT PRIMARY KEY,\n    name TEXT NOT NULL UNIQUE\n  );\n\n  CREATE TABLE capability (\n    role_id TEXT NOT NULL REFERENCES role(id),\n    action  TEXT NOT NULL\n  );\n  CREATE UNIQUE INDEX capability_identity ON capability (role_id, action);\n\n  CREATE TABLE grant (\n    id              TEXT PRIMARY KEY,\n    actor_id        TEXT NOT NULL REFERENCES actor(id),\n    role_id         TEXT NOT NULL REFERENCES role(id),\n    organization_id TEXT NOT NULL REFERENCES organization(id),\n    team_id         TEXT REFERENCES team(id),\n    scope_id        TEXT REFERENCES scope(id),\n    is_primary      INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),\n    is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),\n    CHECK ((team_id IS NULL) <> (scope_id IS NULL))\n  );\n  CREATE INDEX grant_by_actor ON grant (actor_id);\n  CREATE INDEX grant_by_team ON grant (team_id);\n  CREATE INDEX grant_by_scope ON grant (scope_id);\n  CREATE UNIQUE INDEX grant_one_primary ON grant (actor_id, organization_id) WHERE is_primary = 1;\n  CREATE UNIQUE INDEX grant_one_default ON grant (actor_id, organization_id) WHERE is_default = 1;\n  CREATE UNIQUE INDEX grant_identity\n    ON grant (actor_id, organization_id, role_id, COALESCE(team_id, ''), COALESCE(scope_id, ''));\n";
