// The core walkthrough — the same rules and planner bounds as the reference,
// exercised through the async port and the SQLite adapter. The world is a
// festival: one non-profit fields its crews, an audio subcontractor works
// beside it, and the application is the dispatch board — a member is one who
// may `send` as their crew.
//
//   node examples/model.ts            build, walk through, assert
//   node examples/model.ts --keep     leave org_hats.db behind

import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";
import {
  onTeam,
  atScope,
  reach,
  heldCarries,
  scopeCovers,
  can,
  wearableAt,
  admitted,
  wornHat,
  organizationsOf,
  type HeldHat,
  type Target,
} from "../src/index.ts";
import { Db, SqliteRepository, installSchema } from "../src/node.ts";
import { assert, refuses, same } from "./_assert.ts";

// The dispatch board's actions — this application's vocabulary, not the
// model's. `send` is the board's *membership action* — its own policy: to be
// on a crew is to may send as it. The model is indifferent.
const SEND = "send";
const READ_LOG = "read_log";
const RESOLVE = "resolve";
const CONFIGURE = "configure";

const hat = (hats: readonly HeldHat[], id: string): HeldHat => hats.find((h) => h.grant.id === id)!;

// The board's membership policy — the *application's*, composed from the
// model's primitives: a member is one who may send as the crew, and sending
// needs the worn hat to reach the crew (presence) and a held grant over it
// to carry `send` (standing). Org-hats ships the halves; the policy is ours.
const speaksAs = (worn: HeldHat | null, target: Target, held: readonly HeldHat[]): boolean =>
  worn !== null && reach(worn, target) && heldCarries(held, target, SEND);

export async function runModel(keep: boolean): Promise<void> {
  const path = fileURLToPath(new URL("../org_hats.db", import.meta.url));
  try {
    rmSync(path);
  } catch {
    /* fresh */
  }
  const db = new Db(path);
  try {
    installSchema(db);
    const repo = new SqliteRepository(db);

    const riverbend = repo.addScope("riverbend");
    const bigpark = repo.addScope("bigpark", riverbend);
    const mainstage = repo.addScope("mainstage", bigpark);
    const eaststage = repo.addScope("eaststage", riverbend);
    const bigparkPath = repo.scopePath(bigpark)!;
    const eastPath = repo.scopePath(eaststage)!;
    const mainstagePath = repo.scopePath(mainstage)!;

    const council = repo.addOrg("council", riverbend, "Riverbend Arts Council");
    const ampwire = repo.addOrg("ampwire", riverbend, "Ampwire Sound");
    const gate = repo.addTeam("gate", council, bigpark, "gate crew");
    const stageops = repo.addTeam("stageops", council, bigpark, "stage ops");
    const board = repo.addTeam("board", ampwire, bigpark, "board");
    const gateEast = repo.addTeam("gate-east", council, eaststage, "gate crew"); // same name, other site
    const booth = repo.addTeam("booth", council, eaststage, "booth");
    const rig = repo.addTeam("rig", ampwire, eaststage, "rig crew");

    const volunteer = repo.addRole("volunteer", "Volunteer");
    const stagemanager = repo.addRole("stagemanager", "Stage Manager");
    const opsdirector = repo.addRole("opsdirector", "Ops Director");
    repo.grantCapability(volunteer, SEND);
    repo.grantCapability(stagemanager, READ_LOG);
    repo.grantCapability(stagemanager, RESOLVE);
    repo.grantCapability(opsdirector, CONFIGURE);

    const avery = repo.addActor("avery", "Avery Quinn");
    repo.addGrant("g-avery", avery, volunteer, council, { team: gate, primary: true, default: true });

    const blake = repo.addActor("blake", "Blake Rivera");
    repo.addGrant("g-blake-lead", blake, stagemanager, council, { team: stageops, primary: true });
    repo.addGrant("g-blake-vol", blake, volunteer, council, { team: stageops, default: true });

    const robin = repo.addActor("robin", "Robin Sato");
    repo.addGrant("g-robin-booth", robin, stagemanager, council, { team: booth, primary: true });
    repo.addGrant("g-robin-stage", robin, stagemanager, council, { team: stageops });

    const drew = repo.addActor("drew", "Drew Alvarez");
    repo.addGrant("g-drew-bigpark", drew, stagemanager, council, { team: stageops, primary: true });
    repo.addGrant("g-drew-east", drew, stagemanager, council, { team: gateEast });

    const frankie = repo.addActor("frankie", "Frankie Cho");
    repo.addGrant("g-frankie-cfg", frankie, opsdirector, council, { scope: riverbend, primary: true });

    const hatsOf = (actor: string): Promise<HeldHat[]> => repo.hatsOf(actor, riverbend);

    const averyHats = await hatsOf(avery);
    const blakeHats = await hatsOf(blake);
    const robinHats = await hatsOf(robin);
    const drewHats = await hatsOf(drew);
    const frankieHats = await hatsOf(frankie);

    const averyHat = hat(averyHats, "g-avery");
    const blakeLead = hat(blakeHats, "g-blake-lead");
    const blakeVol = hat(blakeHats, "g-blake-vol");
    const robinStage = hat(robinHats, "g-robin-stage");
    const drewBigpark = hat(drewHats, "g-drew-bigpark");
    const drewEast = hat(drewHats, "g-drew-east");
    const frankieCfg = hat(frankieHats, "g-frankie-cfg");

    console.log("== the directory: five entities, two relationships ==");
    console.log(`scopes: riverbend -> big park (main stage), east stage   orgs: Council (gate, stage ops, booth), Ampwire (board, rig)`);
    console.log(`Avery holds ${averyHats.length} grant; worn = ${wornHat(wearableAt(averyHats, bigparkPath))?.grant.id}`);
    console.log(`Frankie reads the Council at big park: [${await repo.readableTeamsAt(frankieHats, riverbend, bigparkPath)}] (none — configuring never reads)`);
    console.log(`gate crew roster: ${gateRoster(repo, gate).join(", ")}`);

    console.log("\n== the stated bounds, as the planner sees them ==");
    const checks: Record<string, [string, string]> = {
      "an actor's grants": ["SELECT * FROM grant WHERE actor_id = 'blake'", "grant_by_actor"],
      "the primary grant": ["SELECT * FROM grant WHERE actor_id = 'blake' AND organization_id = 'council' AND is_primary = 1", "grant_one_primary"],
      "the default grant": ["SELECT * FROM grant WHERE actor_id = 'blake' AND organization_id = 'council' AND is_default = 1", "grant_one_default"],
      "a team's grants": ["SELECT * FROM grant WHERE team_id = 'stageops'", "grant_by_team"],
      "a grant's actions": ["SELECT * FROM capability WHERE role_id = 'stagemanager'", "capability_identity"],
      "an org's teams": ["SELECT id FROM team WHERE organization_id = 'council'", "team_by_org"],
    };
    for (const [label, [sql, index]] of Object.entries(checks)) {
      const detail = db.plan(sql);
      console.log(`${label.padEnd(20)} ${detail.includes(index) ? "index" : "SCAN!"}  ${detail}`);
      assert(detail.includes(index), `expected ${index} for ${label}, got: ${detail}`);
    }

    // --- assertions (the same contract as the reference) --------------------
    assert(averyHats.length === 1, "Avery holds one grant");
    assert(averyHat.grant.primary && averyHat.grant.default, "Avery's primary is also his default");
    assert(!can(averyHat, RESOLVE, onTeam(gate, bigparkPath)), "a Volunteer must not resolve");
    assert(speaksAs(wornHat(wearableAt(averyHats, bigparkPath)), onTeam(gate, bigparkPath), averyHats), "a Volunteer must speak, with a held send grant");
    assert(can(blakeLead, RESOLVE, onTeam(stageops, bigparkPath)), "a Stage Manager resolves their crew's log");
    assert(can(blakeLead, READ_LOG, onTeam(stageops, bigparkPath)), "a Stage Manager reads the crew's log");
    assert(speaksAs(blakeLead, onTeam(stageops, bigparkPath), blakeHats), "a held volunteer grant lets the lead speak without switching");
    assert(speaksAs(blakeVol, onTeam(stageops, bigparkPath), blakeHats), "a member's volunteer hat must speak");
    assert(!speaksAs(blakeLead, onTeam(gate, bigparkPath), blakeHats), "a grant reaches only its team");
    assert(can(robinStage, RESOLVE, onTeam(stageops, bigparkPath)), "supervision needs no affiliation");
    assert(!speaksAs(robinStage, onTeam(stageops, bigparkPath), robinHats), "a non-affiliate must not speak");
    assert(!speaksAs(drewBigpark, onTeam(stageops, bigparkPath), drewHats), "a covering manager supervises without speaking");
    assert(!can(drewEast, RESOLVE, onTeam(stageops, bigparkPath)), "a team-bound grant reaches one team");
    assert(can(frankieCfg, CONFIGURE, atScope(mainstagePath)), "a festival-scope grant covers nested sites and stages");
    assert(!can(frankieCfg, RESOLVE, onTeam(gate, bigparkPath)), "configure must not resolve");
    assert(scopeCovers(bigparkPath, mainstagePath) && !scopeCovers(bigparkPath, eastPath), "a nested scope does not cover its sibling");
    assert(!scopeCovers(bigparkPath, "/riverbend/"), "a nested scope must not cover its parent");
    assert((await repo.readableTeamsAt(frankieHats, riverbend, bigparkPath)).length === 0, "configuring must not read");
    assert(wearableAt(blakeHats, eastPath).length === 0, "a big-park hat is not wearable at east stage");
    assert(admitted(frankieHats, bigparkPath) && admitted(frankieHats, eastPath), "a festival hat admits at every site");
    assert(admitted(averyHats, bigparkPath) && !admitted(averyHats, eastPath), "a site hat admits only at its site");
    assert(same(await repo.readableTeamsAt(blakeHats, riverbend, bigparkPath), [gate, stageops]), "reach follows the organization");
    assert(same(await repo.readableTeamsAt(blakeHats, riverbend, eastPath), [gateEast, booth]), "reach is scoped to the site");
    assert(organizationsOf(blakeHats).join() === council, "organizations come from team-bearing grants");
    assert(refuses(() => repo.addGrant("g-dup", avery, stagemanager, council, { team: gate, primary: true })), "a duplicate primary must be refused");
    assert(refuses(() => repo.addTeam("dup", council, bigpark, "gate crew")), "a duplicate team at one site must be refused");
    assert(refuses(() => repo.addGrant("g-mix", avery, opsdirector, council, { team: gate, scope: bigpark })), "a team- and a scope-bound grant must not mix");
    assert(refuses(() => repo.addGrant("g-cross", avery, stagemanager, council, { team: board })), "a grant may not cross organizations");
    assert(refuses(() => repo.addGrant("g-first", repo.addActor("rookie", "Rookie"), volunteer, council, { team: gate })), "the first grant in an org must be primary");
    assert(gateEast !== gate, "gate crew at big park and east stage are distinct teams");

    // --- re-validation (rule 7) ----------------------------------------------
    const before = wornHat(wearableAt(drewHats, eastPath), "g-drew-east");
    repo.revokeGrant("g-drew-east");
    const after = await hatsOf(drew);
    const revoked = wornHat(wearableAt(after, eastPath), "g-drew-east");
    console.log(`\n== re-validation: held=${before !== null} after revoke=${revoked !== null} ==`);
    assert(revoked === null, "a revoked hat must not be worn");

    // --- the seam ------------------------------------------------------------
    db.run("DELETE FROM capability");
    const blakeAfter = await hatsOf(blake);
    const frankieAfter = await hatsOf(frankie);
    const directorySurvives = blakeAfter.length > 0;
    const everyCheckFalse =
      !can(hat(blakeAfter, "g-blake-lead"), RESOLVE, onTeam(stageops, bigparkPath)) &&
      !speaksAs(wornHat(wearableAt(blakeAfter, bigparkPath)), onTeam(stageops, bigparkPath), blakeAfter) &&
      !can(hat(frankieAfter, "g-frankie-cfg"), CONFIGURE, atScope(bigparkPath));
    console.log(`== seam: directory answers=${directorySurvives}, every can? false=${everyCheckFalse} ==`);
    assert(directorySurvives, "the directory must survive an empty capability table");
    assert(everyCheckFalse, "an empty capability table makes every check false");

    console.log("\nall assertions passed (core)");
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

function gateRoster(repo: SqliteRepository, gate: string): string[] {
  return repo.db
    .all<{ actor_id: string }>(
      `SELECT DISTINCT g.actor_id FROM grant g
         JOIN capability c ON c.role_id = g.role_id AND c.action = 'send'
        WHERE g.team_id = ? ORDER BY g.actor_id`,
      gate,
    )
    .map((r) => r.actor_id);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runModel(process.argv.includes("--keep"));
}
