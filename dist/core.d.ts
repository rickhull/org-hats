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
 * seal it with an exact type, a nominal brand, or a class. An extension
 * beyond the fields here survives the generic selectors (`wearableAt`,
 * `wornHat`) but not the port or the spine — both speak `HeldHat`, and
 * `Decision.hat` is one — so the three names below are what a decision
 * carries. */
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
 * root's parent is `/`, the outermost boundary; `/` is its own parent. Total
 * in its input: a path that lacks the canonical trailing slash is treated as
 * naming its own leaf, so the result is still a canonical path rather than a
 * truncated string. */
export declare const parentPath: (scopePath: string) => string;
/** Does this hat act on this target? A team grant reaches its team; a
 * scope-bound grant reaches a scope and never a team. */
export declare function reach(hat: HeldHat, target: Target): boolean;
/** Can the active hat do this action, on this target? */
export declare function can(hat: HeldHat | null, action: string, target: Target): boolean;
/** Does any *held* grant over the target carry the action — `can` lifted
 * from the worn hat to the held set? This is the standing half of a
 * two-edge rule (the worn hat supplies presence; a held grant supplies
 * standing), checked against what the actor holds rather than what is worn,
 * so the right survives switching hats. What the action *means* —
 * membership, filing, representation — is the application's policy; the
 * model makes the check atomic and testable. */
export declare function heldCarries(hats: readonly HeldHat[], target: Target, action: string): boolean;
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
export declare function wearableAt<H extends HeldHat>(hats: readonly H[], scopePath: string): H[];
/** Is the actor admitted here at all? Any wearable hat admits. */
export declare function admitted(hats: readonly HeldHat[], scopePath: string): boolean;
/** How the worn hat was chosen — rule 5's signal. A claim that did not
 * resolve reports `default` / `primary` / `first`, so the drift is auditable
 * (OH-QM-04: a revoked claim falls back; it does not fail). */
export type HatSource = "claimed" | "default" | "primary" | "first";
/** The hat in force and how it was chosen, in one place: the claimed one if
 * still held and wearable, else the default, else the primary, else the
 * first. `wearable` is already filtered to this scope, so a revoked claim
 * cannot be returned — the re-validation. `claim` is a grant **id** or a
 * matcher (a host whose session claim is name-keyed matches on the name here
 * instead of translating ids). The spine needs the provenance as well as the
 * hat, so both read this one ladder rather than re-deriving it. */
export declare function selectWorn<H extends HeldHat>(wearable: readonly H[], claim?: HatClaim | null): {
    readonly hat: H | null;
    readonly source: HatSource | null;
};
/** The hat in force. `selectWorn` without the provenance. */
export declare function wornHat<H extends HeldHat>(wearable: readonly H[], claim?: HatClaim | null): H | null;
/** The organizations an actor is in *through a team* — the read boundary. A
 * scope-bound configuring grant names an organization but adds no read reach.
 *
 * Read reach is **team-bearing** (this function); the application's roster
 * rule is **grant-derived** (`heldCarries`, commonly). Two correct rules one
 * word apart: this one answers "whose teams may I read"; the app's answers
 * "who is on this team". */
export declare function organizationsOf(hats: readonly HeldHat[]): Id[];
export declare const SCHEMA = "\n  PRAGMA foreign_keys = ON;\n\n  -- Every id is TEXT and caller-supplied. A scope id must not contain \"/\".\n  CREATE TABLE scope (\n    id        TEXT PRIMARY KEY,\n    parent_id TEXT REFERENCES scope(id),\n    name      TEXT NOT NULL,\n    path      TEXT NOT NULL\n  );\n  CREATE UNIQUE INDEX scope_identity ON scope (COALESCE(parent_id, ''), name);\n\n  -- An organization belongs to one operation (a root scope).\n  CREATE TABLE organization (\n    id       TEXT PRIMARY KEY,\n    scope_id TEXT NOT NULL REFERENCES scope(id),\n    name     TEXT NOT NULL,\n    UNIQUE (scope_id, name)\n  );\n\n  -- A label, not a key.\n  CREATE TABLE actor (\n    id   TEXT PRIMARY KEY,\n    name TEXT NOT NULL\n  );\n\n  CREATE TABLE team (\n    id              TEXT PRIMARY KEY,\n    organization_id TEXT NOT NULL REFERENCES organization(id),\n    scope_id        TEXT NOT NULL REFERENCES scope(id),\n    name            TEXT NOT NULL,\n    UNIQUE (scope_id, name)\n  );\n  CREATE INDEX team_by_org ON team (organization_id);\n\n  CREATE TABLE role (\n    id   TEXT PRIMARY KEY,\n    name TEXT NOT NULL UNIQUE\n  );\n\n  CREATE TABLE capability (\n    role_id TEXT NOT NULL REFERENCES role(id),\n    action  TEXT NOT NULL\n  );\n  CREATE UNIQUE INDEX capability_identity ON capability (role_id, action);\n\n  CREATE TABLE grant (\n    id              TEXT PRIMARY KEY,\n    actor_id        TEXT NOT NULL REFERENCES actor(id),\n    role_id         TEXT NOT NULL REFERENCES role(id),\n    organization_id TEXT NOT NULL REFERENCES organization(id),\n    team_id         TEXT REFERENCES team(id),\n    scope_id        TEXT REFERENCES scope(id),\n    is_primary      INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),\n    is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),\n    CHECK ((team_id IS NULL) <> (scope_id IS NULL))\n  );\n  CREATE INDEX grant_by_actor ON grant (actor_id);\n  CREATE INDEX grant_by_team ON grant (team_id);\n  CREATE INDEX grant_by_scope ON grant (scope_id);\n  CREATE UNIQUE INDEX grant_one_primary ON grant (actor_id, organization_id) WHERE is_primary = 1;\n  CREATE UNIQUE INDEX grant_one_default ON grant (actor_id, organization_id) WHERE is_default = 1;\n  CREATE UNIQUE INDEX grant_identity\n    ON grant (actor_id, organization_id, role_id, COALESCE(team_id, ''), COALESCE(scope_id, ''));\n";
