// The operations layer — an example, not part of the module. It shows a host
// adding an operation, a site-local peer edge, and a read rule that unions
// peers on top of the core's organization rule. The world stays the festival:
// at the big park, the Council's stage ops cooperates with Ampwire's board
// team, and Long Table's coffee cart beyond it — one hop, never a chain.
//
//   node examples/operations.ts

import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";
import {
  onTeam,
  can,
  maySpeak,
  wearableAt,
  wornHat,
  type HeldHat,
} from "../src/index.ts";
import { Db, SqliteRepository, installSchema } from "../src/node.ts";

// The dispatch board's actions — this application's vocabulary.
const SEND = "send";
const READ_LOG = "read_log";
const RESOLVE = "resolve";

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
      .filter((h) => h.grant.teamId !== null && h.actions.includes(READ_LOG) && scopePath.startsWith(h.anchorPath))
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

    const riverbend = repo.addScope("riverbend");
    const bigpark = repo.addScope("bigpark", riverbend);
    const eaststage = repo.addScope("eaststage", riverbend);
    const bigparkPath = repo.scopePath(bigpark)!;
    o.addOperation(riverbend, "Riverbend Festival", "auth.riverbend.example");

    const council = repo.addOrg("council", riverbend, "Riverbend Arts Council");
    const ampwire = repo.addOrg("ampwire", riverbend, "Ampwire Sound");
    const longtable = repo.addOrg("longtable", riverbend, "Long Table");
    const gate = repo.addTeam("gate", council, bigpark, "gate crew");
    const stageops = repo.addTeam("stageops", council, bigpark, "stage ops");
    const board = repo.addTeam("board", ampwire, bigpark, "board");
    const cart = repo.addTeam("cart", longtable, bigpark, "cart");
    const booth = repo.addTeam("booth", council, eaststage, "booth");

    const volunteer = repo.addRole("volunteer", "Volunteer");
    const concession = repo.addRole("concession", "Concessionaire");
    const stagemanager = repo.addRole("stagemanager", "Stage Manager");
    repo.grantCapability(volunteer, SEND);
    repo.grantCapability(concession, SEND);
    repo.grantCapability(stagemanager, READ_LOG);
    repo.grantCapability(stagemanager, RESOLVE);

    const avery = repo.addActor("avery", "Avery Quinn");
    repo.addGrant("g-avery", avery, volunteer, council, { team: gate, primary: true, default: true });

    const blake = repo.addActor("blake", "Blake Rivera");
    repo.addGrant("g-blake-lead", blake, stagemanager, council, { team: stageops, primary: true });

    const casey = repo.addActor("casey", "Casey Morgan");
    repo.addGrant("g-casey", casey, stagemanager, ampwire, { team: board, primary: true });

    const drew = repo.addActor("drew", "Drew Alvarez");
    repo.addGrant("g-drew-bigpark", drew, stagemanager, council, { team: stageops, primary: true });
    repo.addGrant("g-drew-east", drew, stagemanager, council, { team: booth });

    const ellis = repo.addActor("ellis", "Ellis Novak");
    repo.addGrant("g-ellis-council", ellis, volunteer, council, { team: gate, primary: true });
    repo.addGrant("g-ellis-longtable", ellis, concession, longtable, { team: cart, primary: true });

    o.linkTeams(stageops, board, bigpark);
    o.linkTeams(board, cart, bigpark);

    const hatsOf = (actor: string): Promise<HeldHat[]> => repo.hatsOf(actor, riverbend);
    const averyHats = await hatsOf(avery);
    const blakeHats = await hatsOf(blake);
    const blakeLead = blakeHats[0]!;

    console.log("== an operation is a root scope; a site is a nested one ==");
    console.log(`operation ${repo.scopePath(riverbend)} -> sites big park, east stage`);
    console.log(`stage ops peers: ${o.peersOf(stageops).join(", ")};  board peers: ${o.peersOf(board).join(", ")}`);
    console.log(`Avery reads:     ${(await o.readableTeamsAt(averyHats, riverbend, bigparkPath)).join(", ")}`);
    console.log(`Blake reads:     ${(await o.readableTeamsAt(blakeHats, riverbend, bigparkPath)).join(", ")}`);
    console.log(`Casey reads:     ${(await o.readableTeamsAt(await hatsOf(casey), riverbend, bigparkPath)).join(", ")}`);
    console.log(`Ellis reads:     ${(await o.readableTeamsAt(await hatsOf(ellis), riverbend, bigparkPath)).join(", ")}`);

    console.log("\n== the stated bounds, as the planner sees them ==");
    const checks: Record<string, [string, string]> = {
      "a team's peers (by a)": ["SELECT team_b FROM team_link WHERE team_a = 'stageops'", "team_link_identity"],
      "a team's peers (by b)": ["SELECT team_a FROM team_link WHERE team_b = 'board'", "team_link_by_b"],
      "are A and B peers": ["SELECT * FROM team_link WHERE team_a = 'board' AND team_b = 'stageops' AND kind = 'peer'", "team_link_identity"],
      "a site's teams": ["SELECT id FROM team WHERE scope_id = 'bigpark'", "team_by_scope"],
      "the operation": ["SELECT * FROM operation WHERE scope_id = 'riverbend'", "operation"],
    };
    for (const [label, [sql, index]] of Object.entries(checks)) {
      const detail = db.plan(sql);
      console.log(`${label.padEnd(22)} ${detail.includes(index) ? "index" : "SCAN!"}  ${detail}`);
      assert(detail.includes(index), `expected ${index} for ${label}, got: ${detail}`);
    }

    assert(o.peersOf(stageops).join() === board, "peers are mutual by canonical row");
    assert(same(await o.readableTeamsAt(averyHats, riverbend, bigparkPath), [gate, stageops]), "the organization is the read boundary");
    assert(same(await o.readableTeamsAt(blakeHats, riverbend, bigparkPath), [gate, stageops, board]), "cooperation widens a supervisor's read");
    assert(!(await o.readableTeamsAt(averyHats, riverbend, bigparkPath)).includes(cart), "a peer edge is supervisors-only");
    assert(!(await o.readableTeamsAt(blakeHats, riverbend, bigparkPath)).includes(cart), "cooperation is not transitive");
    assert(can(blakeLead, RESOLVE, onTeam(stageops, bigparkPath)), "acting is unchanged by cooperation");
    assert(!can(blakeLead, RESOLVE, onTeam(board, bigparkPath)), "cooperation is read-only");
    assert(!maySpeak(wornHat(wearableAt(await hatsOf(drew), bigparkPath)), onTeam(stageops, bigparkPath), await hatsOf(drew), SEND), "a non-affiliate supervises without speaking");
    assert(same(await o.readableTeamsAt(await hatsOf(ellis), riverbend, bigparkPath), [gate, stageops, cart]), "an actor spanning orgs reads both");

    let refused = 0;
    try {
      o.linkTeams(stageops, gate, bigpark);
    } catch {
      refused++;
    }
    try {
      o.linkTeams(board, booth, bigpark);
    } catch {
      refused++;
    }
    assert(refused === 2, "intra-organization and cross-site edges must be refused");

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
