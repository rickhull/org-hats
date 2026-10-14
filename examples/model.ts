// The core walkthrough — the same rules and planner bounds as the reference,
// exercised through the async port and the SQLite adapter.
//
//   node examples/model.ts            build, walk through, assert
//   node examples/model.ts --keep     leave org_hats.db behind

import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";
import {
  AUTHOR,
  READ,
  RESOLVE,
  CONFIGURE,
  onTeam,
  atScope,
  scopeCovers,
  can,
  maySpeak,
  wearableAt,
  admitted,
  wornHat,
  organizationsOf,
  type HeldHat,
} from "../src/index.ts";
import { Db, SqliteRepository, installSchema } from "../src/node.ts";

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}
function refuses(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}
function same(a: readonly string[], b: readonly string[]): boolean {
  return [...a].sort().join() === [...b].sort().join();
}
const hat = (hats: readonly HeldHat[], id: string): HeldHat => hats.find((h) => h.grant.id === id)!;

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

    const acme = repo.addScope("acme");
    const north = repo.addScope("north", acme);
    const south = repo.addScope("south", acme);
    const northPath = repo.scopePath(north)!;
    const southPath = repo.scopePath(south)!;

    const atlas = repo.addOrg("atlas", acme, "Atlas");
    const cobalt = repo.addOrg("cobalt", acme, "Cobalt");
    const drive = repo.addTeam("drive", atlas, north, "drive");
    const logistics = repo.addTeam("logistics", atlas, north, "logistics");
    const workshop = repo.addTeam("workshop", cobalt, north, "workshop");
    const delivery = repo.addTeam("delivery", atlas, south, "delivery");
    const driveSouth = repo.addTeam("drive-south", atlas, south, "drive"); // same name, other scope

    const coach = repo.addRole("coach", "Coach");
    const supervisor = repo.addRole("supervisor", "Supervisor");
    const config = repo.addRole("config", "Config");
    repo.grantCapability(coach, AUTHOR);
    repo.grantCapability(supervisor, READ);
    repo.grantCapability(supervisor, RESOLVE);
    repo.grantCapability(config, CONFIGURE);

    const avery = repo.addActor("avery", "Avery Quinn");
    repo.addGrant("g-avery", avery, coach, atlas, { team: drive, primary: true, default: true });

    const blake = repo.addActor("blake", "Blake Rivera");
    repo.addGrant("g-blake-lead", blake, supervisor, atlas, { team: drive, primary: true });
    repo.addGrant("g-blake-coach", blake, coach, atlas, { team: drive, default: true });

    const robin = repo.addActor("robin", "Robin Sato");
    repo.addGrant("g-man-log", robin, supervisor, atlas, { team: logistics, primary: true });
    repo.addGrant("g-man-drive", robin, supervisor, atlas, { team: drive });

    const drew = repo.addActor("drew", "Drew Alvarez");
    repo.addGrant("g-drew-north", drew, supervisor, atlas, { team: drive, primary: true });
    repo.addGrant("g-drew-south", drew, supervisor, atlas, { team: delivery });

    const frankie = repo.addActor("frankie", "Frankie Cho");
    repo.addGrant("g-frankie-cfg", frankie, config, cobalt, { scope: acme, primary: true });

    const hatsOf = (actor: string): Promise<HeldHat[]> => repo.hatsOf(actor, acme);

    const averyHats = await hatsOf(avery);
    const blakeHats = await hatsOf(blake);
    const robinHats = await hatsOf(robin);
    const drewHats = await hatsOf(drew);
    const frankieHats = await hatsOf(frankie);

    const averyHat = hat(averyHats, "g-avery");
    const blakeLead = hat(blakeHats, "g-blake-lead");
    const blakeCoach = hat(blakeHats, "g-blake-coach");
    const manDrive = hat(robinHats, "g-man-drive");
    const drewNorth = hat(drewHats, "g-drew-north");
    const drewSouth = hat(drewHats, "g-drew-south");
    const frankieCfg = hat(frankieHats, "g-frankie-cfg");

    console.log("== the directory: five entities, two relationships ==");
    console.log(`scopes: acme -> north, south   orgs: Atlas (drive, logistics, delivery), Cobalt (workshop)`);
    console.log(`Avery holds ${averyHats.length} grant; worn = ${wornHat(wearableAt(averyHats, northPath))?.grant.id}`);
    console.log(`Frankie reads Cobalt at north: [${await repo.readableTeamsAt(frankieHats, acme, northPath)}] (none — configuring never reads)`);
    console.log(`roster (drive): ${driveRoster(repo, drive).join(", ")}`);

    console.log("\n== the stated bounds, as the planner sees them ==");
    const checks: Record<string, [string, string]> = {
      "an actor's grants": ["SELECT * FROM grant WHERE actor_id = 'blake'", "grant_by_actor"],
      "the primary grant": ["SELECT * FROM grant WHERE actor_id = 'blake' AND organization_id = 'atlas' AND is_primary = 1", "grant_one_primary"],
      "the default grant": ["SELECT * FROM grant WHERE actor_id = 'blake' AND organization_id = 'atlas' AND is_default = 1", "grant_one_default"],
      "a team's grants": ["SELECT * FROM grant WHERE team_id = 'drive'", "grant_by_team"],
      "a grant's actions": ["SELECT * FROM capability WHERE role_id = 'supervisor'", "capability_identity"],
      "an org's teams": ["SELECT id FROM team WHERE organization_id = 'atlas'", "team_by_org"],
    };
    for (const [label, [sql, index]] of Object.entries(checks)) {
      const detail = db.plan(sql);
      console.log(`${label.padEnd(20)} ${detail.includes(index) ? "index" : "SCAN!"}  ${detail}`);
      assert(detail.includes(index), `expected ${index} for ${label}, got: ${detail}`);
    }

    // --- assertions (the same contract as the reference) --------------------
    assert(averyHats.length === 1, "Avery holds one grant");
    assert(averyHat.grant.primary && averyHat.grant.default, "Avery's primary is also his default");
    assert(!can(averyHat, RESOLVE, onTeam(drive, northPath)), "Coach must not resolve");
    assert(maySpeak(wornHat(wearableAt(averyHats, northPath)), onTeam(drive, northPath), averyHats), "Coach must speak with a held author grant");
    assert(can(blakeLead, RESOLVE, onTeam(drive, northPath)), "Supervisor resolves its team");
    assert(can(blakeLead, READ, onTeam(drive, northPath)), "a supervisor reads its team");
    assert(maySpeak(blakeLead, onTeam(drive, northPath), blakeHats), "a held coach grant lets the lead file without switching");
    assert(maySpeak(blakeCoach, onTeam(drive, northPath), blakeHats), "a member's coach hat must speak");
    assert(!maySpeak(blakeLead, onTeam(logistics, northPath), blakeHats), "a grant reaches only its team");
    assert(can(manDrive, RESOLVE, onTeam(drive, northPath)), "supervision needs no affiliation");
    assert(!maySpeak(manDrive, onTeam(drive, northPath), robinHats), "a non-affiliate must not speak");
    assert(!maySpeak(drewNorth, onTeam(drive, northPath), drewHats), "Drew supervises without speaking");
    assert(!can(drewSouth, RESOLVE, onTeam(drive, northPath)), "a team-bound grant reaches one team");
    assert(can(frankieCfg, CONFIGURE, atScope(northPath)), "a scope grant covers nested scopes");
    assert(!can(frankieCfg, RESOLVE, onTeam(drive, northPath)), "configure must not resolve");
    assert(scopeCovers(northPath, northPath) && !scopeCovers(northPath, southPath), "a nested scope does not cover its sibling");
    assert(!scopeCovers("/acme/north/", "/acme/"), "a nested scope must not cover its parent");
    assert((await repo.readableTeamsAt(frankieHats, acme, northPath)).length === 0, "configuring must not read");
    assert(wearableAt(blakeHats, southPath).length === 0, "an north hat is not wearable at south");
    assert(admitted(frankieHats, northPath) && admitted(frankieHats, southPath), "an operation hat admits at every site");
    assert(admitted(averyHats, northPath) && !admitted(averyHats, southPath), "a site hat admits only at its site");
    assert(same(await repo.readableTeamsAt(blakeHats, acme, northPath), [drive, logistics]), "reach follows the organization");
    assert(same(await repo.readableTeamsAt(blakeHats, acme, southPath), [delivery, driveSouth]), "reach is scoped to the site");
    assert(organizationsOf(blakeHats).join() === atlas, "organizations come from team-bearing grants");
    assert(refuses(() => repo.addGrant("g-dup", avery, supervisor, atlas, { team: drive, primary: true })), "a duplicate primary must be refused");
    assert(refuses(() => repo.addTeam("dup", atlas, north, "drive")), "a duplicate team at one scope must be refused");
    assert(refuses(() => repo.addGrant("g-mix", avery, config, atlas, { team: drive, scope: north })), "a team- and a scope-bound grant must not mix");
    assert(refuses(() => repo.addGrant("g-cross", avery, supervisor, atlas, { team: workshop })), "a grant may not cross organizations");
    assert(refuses(() => repo.addGrant("g-first", repo.addActor("rookie", "Rookie"), coach, atlas, { team: drive })), "the first grant in an org must be primary");
    assert(driveSouth !== drive, "drive@north and drive@south are distinct teams");

    // --- re-validation (rule 7) ----------------------------------------------
    const before = wornHat(wearableAt(drewHats, southPath), "g-drew-south");
    repo.revokeGrant("g-drew-south");
    const after = await hatsOf(drew);
    const revoked = wornHat(wearableAt(after, southPath), "g-drew-south");
    console.log(`\n== re-validation: held=${before !== null} after revoke=${revoked !== null} ==`);
    assert(revoked === null, "a revoked hat must not be worn");

    // --- the seam ------------------------------------------------------------
    db.run("DELETE FROM capability");
    const blakeAfter = await hatsOf(blake);
    const frankieAfter = await hatsOf(frankie);
    const directorySurvives = blakeAfter.length > 0;
    const everyCheckFalse =
      !can(hat(blakeAfter, "g-blake-lead"), RESOLVE, onTeam(drive, northPath)) &&
      !maySpeak(wornHat(wearableAt(blakeAfter, northPath)), onTeam(drive, northPath), blakeAfter) &&
      !can(hat(frankieAfter, "g-frankie-cfg"), CONFIGURE, atScope(northPath));
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

function driveRoster(repo: SqliteRepository, drive: string): string[] {
  return repo.db
    .all<{ actor_id: string }>(
      `SELECT DISTINCT g.actor_id FROM grant g
         JOIN capability c ON c.role_id = g.role_id AND c.action = 'author'
        WHERE g.team_id = ? ORDER BY g.actor_id`,
      drive,
    )
    .map((r) => r.actor_id);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runModel(process.argv.includes("--keep"));
}
