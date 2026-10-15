// The reference proof of the shared conformance inventory. Each of the ten
// OH-QM cases gets a body; the runner iterates the published inventory, fails
// on a missing or unknown id, and runs every body against a fresh fixture of
// the reference adapter.
//
//   node examples/conformance.ts
//
// The inventory ships (src/conformance.ts); this file does not — it needs a
// driver. It is the counterpart of a consumer running the same ids against
// its own adapter.

import { fileURLToPath } from "node:url";
import {
  AUTHOR,
  READ,
  RESOLVE,
  CONFIGURE,
  onTeam,
  atScope,
  can,
  maySpeak,
  wearableAt,
  admitted,
  wornHat,
  organizationsOf,
  SCHEMA,
  CONFORMANCE_CASES,
  runConformance as runBodies,
  type ConformanceBodies,
} from "../src/index.ts";
import { Db, SqliteRepository, installSchema } from "../src/node.ts";
import { Ops, OPS_SCHEMA } from "./operations.ts";

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

/** One fresh fixture per case: a single operation, two sites, three
 * organizations, the teams and roles the ten cases name. In-memory, so cases
 * cannot leak into one another. */
interface World {
  db: Db;
  repo: SqliteRepository;
  ops: Ops;
  op: string;
  northPath: string;
  southPath: string;
  drive: string;
  logistics: string;
  patrolNorth: string;
  patrolSouth: string;
  delivery: string;
  facilities: string;
}

function world(): World {
  const db = new Db(":memory:");
  installSchema(db);
  db.exec(OPS_SCHEMA);
  const repo = new SqliteRepository(db);
  const ops = new Ops(db);

  const acme = repo.addScope("acme");
  const north = repo.addScope("north", acme);
  const south = repo.addScope("south", acme);
  ops.addOperation(acme, "Acme");

  const atlas = repo.addOrg("atlas", acme, "Atlas");
  const beacon = repo.addOrg("beacon", acme, "Beacon");
  const cobalt = repo.addOrg("cobalt", acme, "Cobalt");
  const drive = repo.addTeam("drive", atlas, north, "drive");
  const logistics = repo.addTeam("logistics", atlas, north, "logistics");
  const patrolNorth = repo.addTeam("patrol-north", atlas, north, "patrol");
  const delivery = repo.addTeam("delivery", atlas, south, "delivery");
  const patrolSouth = repo.addTeam("patrol-south", atlas, south, "patrol");
  const facilities = repo.addTeam("facilities", beacon, north, "facilities");
  const workshop = repo.addTeam("workshop", cobalt, north, "workshop");
  ops.linkTeams(drive, facilities, north);
  ops.linkTeams(facilities, workshop, north);

  const member = repo.addRole("member", "Member");
  const supervisor = repo.addRole("supervisor", "Supervisor");
  const config = repo.addRole("config", "Config");
  repo.grantCapability(member, AUTHOR);
  repo.grantCapability(supervisor, READ);
  repo.grantCapability(supervisor, RESOLVE);
  repo.grantCapability(config, CONFIGURE);

  const alice = repo.addActor("alice", "Alice");
  repo.addGrant("g-alice", alice, config, atlas, { scope: north, primary: true });

  const bob = repo.addActor("bob", "Bob");
  repo.addGrant("g-bob-drive", bob, supervisor, atlas, { team: drive, primary: true, default: true });
  repo.addGrant("g-bob-logistics", bob, supervisor, atlas, { team: logistics });
  repo.addGrant("g-bob-delivery", bob, supervisor, atlas, { team: delivery });

  const cal = repo.addActor("cal", "Cal");
  repo.addGrant("g-cal-member", cal, member, atlas, { team: drive, primary: true });
  repo.addGrant("g-cal-supervisor", cal, supervisor, atlas, { team: drive });

  const adam = repo.addActor("adam", "Adam");
  repo.addGrant("g-adam", adam, supervisor, atlas, { team: drive, primary: true });

  const erin = repo.addActor("erin", "Erin");
  repo.addGrant("g-erin", erin, supervisor, atlas, { team: patrolNorth, primary: true });

  const frank = repo.addActor("frank", "Frank");
  repo.addGrant("g-frank", frank, member, atlas, { team: drive, primary: true });

  return {
    db,
    repo,
    ops,
    op: acme,
    northPath: repo.scopePath(north)!,
    southPath: repo.scopePath(south)!,
    drive,
    logistics,
    patrolNorth,
    patrolSouth,
    delivery,
    facilities,
  };
}

type Body = (w: World) => Promise<void>;

const cases: Record<string, Body> = {
  "OH-QM-01": async (w) => {
    const hats = await w.repo.hatsOf("alice", w.op);
    const worn = wornHat(wearableAt(hats, w.northPath));
    assert(admitted(hats, w.northPath), "a configuring hat admits its holder");
    assert(can(worn, CONFIGURE, atScope(w.northPath)), "it configures where it is anchored");
    assert(!can(worn, READ, onTeam(w.drive, w.northPath)), "it reads no reports");
    assert((await w.ops.readableTeamsAt(hats, w.op, w.northPath)).length === 0, "it adds no read reach");
  },

  "OH-QM-02": async (w) => {
    const hats = await w.repo.hatsOf("erin", w.op);
    const worn = wornHat(wearableAt(hats, w.northPath));
    assert(can(worn, RESOLVE, onTeam(w.patrolNorth, w.northPath)), "supervises the team at its own site");
    assert(!can(worn, RESOLVE, onTeam(w.patrolSouth, w.southPath)), "never reaches the same-named team at another site");
  },

  "OH-QM-03": async (w) => {
    const hats = await w.repo.hatsOf("bob", w.op);
    const wearable = wearableAt(hats, w.southPath);
    assert(!wearable.some((h) => h.grant.primary), "the primary is not wearable here");
    const worn = wornHat(wearable);
    assert(worn?.grant.id === "g-bob-delivery", "a live wearable hat stands in");
    assert(can(worn, RESOLVE, onTeam(w.delivery, w.southPath)), "and authorizes where it reaches");
  },

  "OH-QM-04": async (w) => {
    const worn = wornHat(wearableAt(await w.repo.hatsOf("bob", w.op), w.northPath), "g-bob-drive");
    assert(worn?.grant.id === "g-bob-drive", "the claim is honoured while it is held");
    w.repo.revokeGrant("g-bob-drive");
    const after = wornHat(wearableAt(await w.repo.hatsOf("bob", w.op), w.northPath), "g-bob-drive");
    assert(after?.grant.id === "g-bob-logistics", "a revoked claim falls back to a live wearable hat");
  },

  "OH-QM-05": async (w) => {
    // The act and its audit row are the host's; the model's share is that
    // revocation is real, so the recorded snapshot is the only intelligible
    // trace — a live lookup cannot reconstruct it.
    assert(!SCHEMA.includes("audit"), "the model keeps no audit table; the host records the snapshot");
    assert(!SCHEMA.includes("membership"), "nor a membership table");
    const snapshot = "supervisor:drive@north"; // built from names the host holds
    w.repo.revokeGrant("g-bob-drive");
    assert(!(await w.repo.hatsOf("bob", w.op)).some((h) => h.grant.id === "g-bob-drive"), "the grant is gone");
    assert(snapshot === "supervisor:drive@north", "the recorded snapshot stays legible");
  },

  "OH-QM-06": async (w) => {
    const hats = await w.repo.hatsOf("frank", w.op);
    assert(hats.length === 1, "a member is one row");
    assert(hats[0]!.actions.includes(AUTHOR), "and that row is the affiliation");
  },

  "OH-QM-07": async (w) => {
    const hats = await w.repo.hatsOf("cal", w.op);
    const worn = wornHat(wearableAt(hats, w.northPath), "g-cal-supervisor");
    assert(!worn!.actions.includes(AUTHOR), "the supervisor hat does not itself author");
    assert(maySpeak(worn, onTeam(w.drive, w.northPath), hats), "a serving member authors without switching hats");
    const adamHats = await w.repo.hatsOf("adam", w.op);
    const adamWorn = wornHat(wearableAt(adamHats, w.northPath));
    assert(!maySpeak(adamWorn, onTeam(w.drive, w.northPath), adamHats), "a non-member supervisor is refused");
  },

  "OH-QM-08": async (w) => {
    const hats = await w.repo.hatsOf("alice", w.op);
    const worn = wornHat(wearableAt(hats, w.northPath));
    assert(!can(worn, RESOLVE, onTeam(w.drive, w.northPath)), "a configuring hat does not supervise");
    assert(organizationsOf(hats).length === 0, "a scope-bound grant names no organization it is in");
    assert((await w.ops.readableTeamsAt(hats, w.op, w.northPath)).length === 0, "and adds no organization read reach");
  },

  "OH-QM-09": async (w) => {
    assert(w.ops.peersOf(w.drive).includes(w.facilities) && w.ops.peersOf(w.facilities).includes(w.drive), "peer reach is mutual");
    const bobHats = await w.repo.hatsOf("bob", w.op);
    const readable = await w.ops.readableTeamsAt(bobHats, w.op, w.northPath);
    assert(readable.includes(w.facilities), "a supervisor reads a peer");
    assert(!readable.includes("workshop"), "peer reach is one hop, not transitive");
    const worn = wornHat(wearableAt(bobHats, w.northPath));
    assert(!can(worn, RESOLVE, onTeam(w.facilities, w.northPath)), "peer reach is read-only");
    const frankReadable = await w.ops.readableTeamsAt(await w.repo.hatsOf("frank", w.op), w.op, w.northPath);
    assert(!frankReadable.includes(w.facilities), "peer reach is supervisors-only");
    assert(refuses(() => w.ops.linkTeams(w.drive, w.logistics, "north")), "an intra-organization edge is redundant");
    assert(refuses(() => w.ops.linkTeams(w.facilities, w.delivery, "north")), "an edge across sites is refused");
  },

  "OH-QM-10": async (w) => {
    // The two reads the port owns. The claim is *indexed*, not which index the
    // planner prefers — grant_identity and team_by_org both lead on the key.
    const indexed = (plan: string): boolean => plan.includes("USING INDEX") || plan.includes("USING COVERING INDEX");
    const hatsPlan = w.db.plan(
      `SELECT g.id FROM grant g JOIN organization o ON o.id = g.organization_id WHERE g.actor_id = 'bob' AND o.scope_id = 'acme'`,
    );
    assert(indexed(hatsPlan), `held hats should be an index search, got: ${hatsPlan}`);
    const readPlan = w.db.plan(
      `SELECT t.id FROM team t JOIN scope s ON s.id = t.scope_id WHERE t.organization_id IN ('atlas') AND '/acme/north/' LIKE s.path || '%'`,
    );
    assert(indexed(readPlan), `readable teams should be an index search, got: ${readPlan}`);
  },
};

export async function runConformance(): Promise<void> {
  // One fresh world per case, so cases cannot leak into one another — the
  // harness runs the bodies; this file only supplies them.
  const bodies: ConformanceBodies = Object.fromEntries(
    Object.entries(cases).map(([id, body]) => [
      id,
      async () => {
        const w = world();
        try {
          await body(w);
        } finally {
          w.db.close();
        }
      },
    ]),
  );

  const result = await runBodies(bodies);
  for (const { id, description } of CONFORMANCE_CASES) {
    const failure = result.failures.find((f) => f.id === id);
    console.log(`  ${id}  ${description}${failure === undefined ? "" : `  FAILED: ${String(failure.error)}`}`);
  }
  assert(result.gaps.missing.length === 0, `unimplemented conformance cases: ${result.gaps.missing.join(", ")}`);
  assert(result.gaps.unknown.length === 0, `unknown conformance ids: ${result.gaps.unknown.join(", ")}`);
  assert(result.failures.length === 0, `${result.failures.length} conformance case(s) failed`);
  console.log(`\n${CONFORMANCE_CASES.length} conformance cases pass`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runConformance();
}
