// The operations layer — an example, not part of the module. It shows a host
// adding an operation, a site-local peer edge, and a read rule that unions
// peers on top of the core's organization rule.
//
//   node examples/operations.ts

import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";
import {
  READ,
  RESOLVE,
  AUTHOR,
  onTeam,
  atScope,
  can,
  maySpeak,
  wearableAt,
  wornHat,
  type HeldHat,
} from "../src/index.ts";
import { Db, SqliteRepository, installSchema } from "../src/node.ts";

export const OPS_SCHEMA = `
  CREATE INDEX team_by_scope ON team (scope_id);
  CREATE TABLE operation (
    scope_id TEXT PRIMARY KEY REFERENCES scope(id),
    name     TEXT NOT NULL,
    idp      TEXT
  );
  CREATE TABLE team_link (
    team_a   TEXT NOT NULL REFERENCES team(id),
    team_b   TEXT NOT NULL REFERENCES team(id),
    kind     TEXT NOT NULL,
    scope_id TEXT NOT NULL REFERENCES scope(id),
    CHECK (team_a < team_b)
  );
  CREATE UNIQUE INDEX team_link_identity ON team_link (team_a, team_b, kind);
  CREATE INDEX team_link_by_b ON team_link (team_b);
`;

const PEER = "peer";

export class Ops {
  readonly repo: SqliteRepository;
  readonly db: Db;

  constructor(db: Db) {
    this.db = db;
    this.repo = new SqliteRepository(db);
  }

  addOperation(scopeId: string, name: string, idp: string | null = null): void {
    this.db.run("INSERT INTO operation (scope_id, name, idp) VALUES (?, ?, ?)", scopeId, name, idp);
  }

  linkTeams(a: string, b: string, scopeId: string, kind = PEER): void {
    if (a === b) throw new Error("a team cannot cooperate with itself");
    const scopeOf = (t: string): string => this.db.get<{ s: string }>("SELECT scope_id AS s FROM team WHERE id = ?", t)!.s;
    const orgOf = (t: string): string => this.db.get<{ o: string }>("SELECT organization_id AS o FROM team WHERE id = ?", t)!.o;
    if (orgOf(a) === orgOf(b)) {
      throw new Error("cooperation already spans organizations; an intra-organization edge is redundant");
    }
    if (scopeOf(a) !== scopeId || scopeOf(b) !== scopeId) throw new Error("cooperation is site-local");
    const [lo, hi] = a < b ? [a, b] : [b, a];
    this.db.run("INSERT INTO team_link (team_a, team_b, kind, scope_id) VALUES (?, ?, ?, ?)", lo, hi, kind, scopeId);
  }

  peersOf(teamId: string, kind = PEER): string[] {
    return this.db
      .all<{ p: string }>(
        `SELECT team_b AS p FROM team_link WHERE team_a = ? AND kind = ?
         UNION ALL
         SELECT team_a AS p FROM team_link WHERE team_b = ? AND kind = ?`,
        teamId,
        kind,
        teamId,
        kind,
      )
      .map((r) => r.p);
  }

  // The core organization rule, plus the peers of teams the actor supervises.
  async readableTeamsAt(hats: readonly HeldHat[], operationId: string, scopePath: string): Promise<string[]> {
    const own = await this.repo.readableTeamsAt(hats, operationId, scopePath);
    const supervised = hats
      .filter((h) => h.grant.teamId !== null && h.actions.includes(READ) && scopePath.startsWith(h.anchorPath))
      .map((h) => h.grant.teamId!);
    const peer = supervised.flatMap((t) => this.peersOf(t));
    return [...new Set([...own, ...peer])].sort();
  }
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}
function same(a: readonly string[], b: readonly string[]): boolean {
  return [...a].sort().join() === [...b].sort().join();
}

export async function runOperations(keep: boolean): Promise<void> {
  const path = fileURLToPath(new URL("../ops.db", import.meta.url));
  try {
    rmSync(path);
  } catch {
    /* fresh */
  }
  const db = new Db(path);
  try {
    installSchema(db);
    db.exec(OPS_SCHEMA);
    const o = new Ops(db);
    const repo = o.repo;

    const acme = repo.addScope("acme");
    const north = repo.addScope("north", acme);
    const south = repo.addScope("south", acme);
    const northPath = repo.scopePath(north)!;
    const southPath = repo.scopePath(south)!;
    o.addOperation(acme, "Acme Freight", "auth.acme.example");

    const atlas = repo.addOrg("atlas", acme, "Atlas");
    const beacon = repo.addOrg("beacon", acme, "Beacon");
    const cobalt = repo.addOrg("cobalt", acme, "Cobalt");
    const drive = repo.addTeam("drive", atlas, north, "drive");
    const logistics = repo.addTeam("logistics", atlas, north, "logistics");
    const facilities = repo.addTeam("facilities", beacon, north, "facilities");
    const workshop = repo.addTeam("workshop", cobalt, north, "workshop");
    const delivery = repo.addTeam("delivery", atlas, south, "delivery");

    const coach = repo.addRole("coach", "Coach");
    const supervisor = repo.addRole("supervisor", "Supervisor");
    repo.grantCapability(coach, AUTHOR);
    repo.grantCapability(supervisor, READ);
    repo.grantCapability(supervisor, RESOLVE);

    const avery = repo.addActor("avery", "Avery Quinn");
    repo.addGrant("g-avery", avery, coach, atlas, { team: drive, primary: true, default: true });

    const blake = repo.addActor("blake", "Blake Rivera");
    repo.addGrant("g-blake-lead", blake, supervisor, atlas, { team: drive, primary: true });

    const casey = repo.addActor("casey", "Casey Morgan");
    repo.addGrant("g-casey", casey, supervisor, beacon, { team: facilities, primary: true });

    const drew = repo.addActor("drew", "Drew Alvarez");
    repo.addGrant("g-drew-north", drew, supervisor, atlas, { team: drive, primary: true });
    repo.addGrant("g-drew-south", drew, supervisor, atlas, { team: delivery });

    const ellis = repo.addActor("ellis", "Ellis Novak");
    repo.addGrant("g-ellis-atlas", ellis, coach, atlas, { team: drive, primary: true });
    repo.addGrant("g-ellis-beacon", ellis, coach, beacon, { team: facilities, primary: true });

    o.linkTeams(drive, facilities, north);
    o.linkTeams(facilities, workshop, north);

    const hatsOf = (actor: string): Promise<HeldHat[]> => repo.hatsOf(actor, acme);
    const averyHats = await hatsOf(avery);
    const blakeHats = await hatsOf(blake);
    const blakeLead = blakeHats[0]!;

    console.log("== an operation is a root scope; a site is a nested one ==");
    console.log(`operation ${repo.scopePath(acme)} -> sites north, south`);
    console.log(`drive peers: ${o.peersOf(drive).join(", ")};  facilities peers: ${o.peersOf(facilities).join(", ")}`);
    console.log(`Avery reads:    ${(await o.readableTeamsAt(averyHats, acme, northPath)).join(", ")}`);
    console.log(`Blake reads:  ${(await o.readableTeamsAt(blakeHats, acme, northPath)).join(", ")}`);
    console.log(`Casey reads:     ${(await o.readableTeamsAt(await hatsOf(casey), acme, northPath)).join(", ")}`);
    console.log(`Ellis reads:     ${(await o.readableTeamsAt(await hatsOf(ellis), acme, northPath)).join(", ")}`);

    console.log("\n== the stated bounds, as the planner sees them ==");
    const checks: Record<string, [string, string]> = {
      "a team's peers (by a)": ["SELECT team_b FROM team_link WHERE team_a = 'drive'", "team_link_identity"],
      "a team's peers (by b)": ["SELECT team_a FROM team_link WHERE team_b = 'facilities'", "team_link_by_b"],
      "are A and B peers": ["SELECT * FROM team_link WHERE team_a = 'drive' AND team_b = 'facilities' AND kind = 'peer'", "team_link_identity"],
      "a site's teams": ["SELECT id FROM team WHERE scope_id = 'north'", "team_by_scope"],
      "the operation": ["SELECT * FROM operation WHERE scope_id = 'acme'", "operation"],
    };
    for (const [label, [sql, index]] of Object.entries(checks)) {
      const detail = db.plan(sql);
      console.log(`${label.padEnd(22)} ${detail.includes(index) ? "index" : "SCAN!"}  ${detail}`);
      assert(detail.includes(index), `expected ${index} for ${label}, got: ${detail}`);
    }

    assert(o.peersOf(drive).join() === facilities, "peers are mutual by canonical row");
    assert(same(await o.readableTeamsAt(averyHats, acme, northPath), [drive, logistics]), "the organization is the read boundary");
    assert(same(await o.readableTeamsAt(blakeHats, acme, northPath), [drive, logistics, facilities]), "cooperation widens a supervisor's read");
    assert(!(await o.readableTeamsAt(averyHats, acme, northPath)).includes(workshop), "a peer edge is supervisors-only");
    assert(!(await o.readableTeamsAt(blakeHats, acme, northPath)).includes(workshop), "cooperation is not transitive");
    assert(can(blakeLead, RESOLVE, onTeam(drive, northPath)), "acting is unchanged by cooperation");
    assert(!can(blakeLead, RESOLVE, onTeam(facilities, northPath)), "cooperation is read-only");
    assert(!maySpeak(wornHat(wearableAt(await hatsOf(drew), northPath)), onTeam(drive, northPath), await hatsOf(drew)), "a non-affiliate supervises without speaking");
    assert(same(await o.readableTeamsAt(await hatsOf(ellis), acme, northPath), [drive, logistics, facilities]), "an actor spanning orgs reads both");

    let refused = 0;
    try {
      o.linkTeams(drive, logistics, north);
    } catch {
      refused++;
    }
    try {
      o.linkTeams(facilities, delivery, north);
    } catch {
      refused++;
    }
    assert(refused === 2, "intra-organization and cross-site edges must be refused");
    assert(southPath.length > 0, "south exists");

    console.log("\nall assertions passed (operations)");
  } finally {
    db.close();
    if (!keep) {
      try {
        rmSync(path);
      } catch {
        /* gone */
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runOperations(process.argv.includes("--keep"));
}
