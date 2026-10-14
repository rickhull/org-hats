// The reference adapter: SQLite (Node's built-in) behind OrgHatsRepository.
//
// This is the only file that imports a driver. It also carries the small
// write surface the walkthroughs and tests build fixtures with — a host owns
// its own writes, so they are not part of the port.

import { childPath, organizationsOf, SCHEMA, type Grant, type HeldHat, type Id } from "./core.ts";
import type { OrgHatsRepository } from "./port.ts";
import { Db } from "./db.ts";

export { Db };

export function installSchema(db: Db): void {
  db.exec(SCHEMA);
}

interface GrantRow {
  id: string;
  actor_id: string;
  role_id: string;
  organization_id: string;
  team_id: string | null;
  scope_id: string | null;
  prim: number;
  dflt: number;
  anchor_path: string;
}

export interface GrantInput {
  team?: Id;
  scope?: Id;
  primary?: boolean;
  default?: boolean;
}

export class SqliteRepository implements OrgHatsRepository {
  readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  // --- reads (the port) -----------------------------------------------------

  async hatsOf(actorId: Id, operationId: Id): Promise<HeldHat[]> {
    const rows = this.db.all<GrantRow>(
      `SELECT g.id, g.actor_id, g.role_id, g.organization_id, g.team_id, g.scope_id,
              g.is_primary AS prim, g.is_default AS dflt,
              COALESCE(ts.path, ss.path) AS anchor_path
         FROM grant g
         JOIN organization o ON o.id = g.organization_id
         LEFT JOIN team  t ON t.id = g.team_id
         LEFT JOIN scope ts ON ts.id = t.scope_id
         LEFT JOIN scope ss ON ss.id = g.scope_id
        WHERE g.actor_id = ? AND o.scope_id = ?`,
      actorId,
      operationId,
    );

    const actionsByRole = new Map<string, string[]>();
    const caps = this.db.all<{ role_id: string; action: string }>(
      `SELECT c.role_id AS role_id, c.action AS action
         FROM capability c
        WHERE c.role_id IN (SELECT DISTINCT role_id FROM grant WHERE actor_id = ?)`,
      actorId,
    );
    for (const c of caps) {
      const list = actionsByRole.get(c.role_id) ?? [];
      list.push(c.action);
      actionsByRole.set(c.role_id, list);
    }

    return rows.map((r) => ({
      grant: {
        id: r.id,
        actorId: r.actor_id,
        roleId: r.role_id,
        organizationId: r.organization_id,
        teamId: r.team_id,
        scopeId: r.scope_id,
        primary: r.prim === 1,
        default: r.dflt === 1,
      },
      actions: actionsByRole.get(r.role_id) ?? [],
      anchorPath: r.anchor_path,
    }));
  }

  // The organization-side read rule. A host adapter unions its peers on top to
  // own the whole answer.
  async readableTeamsAt(hats: readonly HeldHat[], _operationId: Id, scopePath: string): Promise<string[]> {
    const orgs = organizationsOf(hats);
    if (orgs.length === 0) return [];
    const marks = orgs.map(() => "?").join(",");
    return this.db
      .all<{ id: string }>(
        `SELECT t.id FROM team t JOIN scope s ON s.id = t.scope_id
          WHERE t.organization_id IN (${marks}) AND ? LIKE s.path || '%'`,
        ...orgs,
        scopePath,
      )
      .map((r) => r.id);
  }

  // --- writes (reference fixtures only) -------------------------------------

  scopePath(scopeId: Id): string | null {
    return this.db.get<{ path: string }>("SELECT path FROM scope WHERE id = ?", scopeId)?.path ?? null;
  }

  addScope(id: Id, parent: Id | null = null, name: Id = id): Id {
    const parentPath = parent === null ? "/" : (this.scopePath(parent) ?? "/");
    this.db.run(
      "INSERT INTO scope (id, parent_id, name, path) VALUES (?, ?, ?, ?)",
      id,
      parent,
      name,
      childPath(parentPath, id),
    );
    return id;
  }

  addOrg(id: Id, operationId: Id, name: string): Id {
    this.db.run("INSERT INTO organization (id, scope_id, name) VALUES (?, ?, ?)", id, operationId, name);
    return id;
  }

  addActor(id: Id, name: string): Id {
    this.db.run("INSERT INTO actor (id, name) VALUES (?, ?)", id, name);
    return id;
  }

  addRole(id: Id, name: string): Id {
    this.db.run("INSERT INTO role (id, name) VALUES (?, ?)", id, name);
    return id;
  }

  addTeam(id: Id, orgId: Id, scopeId: Id, name: string): Id {
    this.db.run("INSERT INTO team (id, organization_id, scope_id, name) VALUES (?, ?, ?, ?)", id, orgId, scopeId, name);
    return id;
  }

  grantCapability(roleId: Id, action: string): void {
    this.db.run("INSERT INTO capability (role_id, action) VALUES (?, ?)", roleId, action);
  }

  // Read-then-write invariants live here. Safe under one serialized writer; a
  // D1 adapter must make them atomic (a transaction or a constraint).
  addGrant(id: Id, actorId: Id, roleId: Id, orgId: Id, input: GrantInput): Grant {
    const team = input.team ?? null;
    const scope = input.scope ?? null;
    if (team === null && scope === null) throw new Error("a grant needs a subject: a team or a scope");
    if (team !== null && scope !== null) throw new Error("a grant is over a team or a scope, not both");
    if (team !== null && this.orgOfTeam(team) !== orgId) throw new Error("a grant may not cross organizations");
    const held = this.db.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM grant WHERE actor_id = ? AND organization_id = ?",
      actorId,
      orgId,
    );
    if (input.primary !== true && (held[0]?.n ?? 0) === 0) {
      throw new Error("an actor's first grant in an organization must be their primary");
    }
    this.db.run(
      "INSERT INTO grant (id, actor_id, role_id, organization_id, team_id, scope_id, is_primary, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      actorId,
      roleId,
      orgId,
      team,
      scope,
      input.primary === true ? 1 : 0,
      input.default === true ? 1 : 0,
    );
    return {
      id,
      actorId,
      roleId,
      organizationId: orgId,
      teamId: team,
      scopeId: scope,
      primary: input.primary === true,
      default: input.default === true,
    };
  }

  revokeGrant(id: Id): void {
    this.db.run("DELETE FROM grant WHERE id = ?", id);
  }

  private orgOfTeam(teamId: Id): Id | null {
    return this.db.get<{ o: string }>("SELECT organization_id AS o FROM team WHERE id = ?", teamId)?.o ?? null;
  }
}
