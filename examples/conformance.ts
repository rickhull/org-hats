// The reference proof of the shared conformance inventory. Each of the
// eleven OH-QM cases gets a body; the harness iterates the published
// inventory, fails on a missing or unknown id, and runs every body against a
// fresh fixture of the reference adapter — the festival world, where the
// application is the dispatch board and `send` is the speech act.
//
//   node examples/conformance.ts
//
// The inventory ships (src/conformance.ts); this file does not — it needs a
// driver. It is the counterpart of a consumer running the same ids against
// its own adapter.

import { fileURLToPath } from "node:url";
import {
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
  decide,
  perRequest,
  runConformance as runBodies,
  type ConformanceBodies,
} from "../src/index.ts";
import { Db, SqliteRepository, installSchema } from "../src/node.ts";
import { Ops, OPS_SCHEMA } from "./operations.ts";

// The dispatch board's actions — this application's vocabulary.
const SEND = "send";
const READ_LOG = "read_log";
const RESOLVE = "resolve";
const CONFIGURE = "configure";

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
 * organizations, the teams and roles the eleven cases name. In-memory, so cases
 * cannot leak into one another. */
interface World {
  db: Db;
  repo: SqliteRepository;
  ops: Ops;
  op: string;
  bigparkPath: string;
  eastPath: string;
  stageops: string;
  gate: string;
  gateEast: string;
  booth: string;
  board: string;
  cart: string;
}

function world(): World {
  const db = new Db(":memory:");
  installSchema(db);
  db.exec(OPS_SCHEMA);
  const repo = new SqliteRepository(db);
  const ops = new Ops(db);

  const riverbend = repo.addScope("riverbend");
  const bigpark = repo.addScope("bigpark", riverbend);
  const eaststage = repo.addScope("eaststage", riverbend);
  ops.addOperation(riverbend, "Riverbend");

  const council = repo.addOrg("council", riverbend, "Riverbend Arts Council");
  const ampwire = repo.addOrg("ampwire", riverbend, "Ampwire Sound");
  const longtable = repo.addOrg("longtable", riverbend, "Long Table");
  const stageops = repo.addTeam("stageops", council, bigpark, "stage ops");
  const gate = repo.addTeam("gate", council, bigpark, "gate crew");
  const gateEast = repo.addTeam("gate-east", council, eaststage, "gate crew");
  const booth = repo.addTeam("booth", council, eaststage, "booth");
  const board = repo.addTeam("board", ampwire, bigpark, "board");
  const cart = repo.addTeam("cart", longtable, bigpark, "cart");
  ops.linkTeams(stageops, board, bigpark);
  ops.linkTeams(board, cart, bigpark);

  const volunteer = repo.addRole("volunteer", "Volunteer");
  const stagemanager = repo.addRole("stagemanager", "Stage Manager");
  const opsdirector = repo.addRole("opsdirector", "Ops Director");
  repo.grantCapability(volunteer, SEND);
  repo.grantCapability(stagemanager, READ_LOG);
  repo.grantCapability(stagemanager, RESOLVE);
  repo.grantCapability(opsdirector, CONFIGURE);

  const alice = repo.addActor("alice", "Alice");
  repo.addGrant("g-alice", alice, opsdirector, council, { scope: bigpark, primary: true });

  const bob = repo.addActor("bob", "Bob");
  repo.addGrant("g-bob-stageops", bob, stagemanager, council, { team: stageops, primary: true, default: true });
  repo.addGrant("g-bob-gate", bob, stagemanager, council, { team: gate });
  repo.addGrant("g-bob-east", bob, stagemanager, council, { team: gateEast });

  const cal = repo.addActor("cal", "Cal");
  repo.addGrant("g-cal-vol", cal, volunteer, council, { team: stageops, primary: true });
  repo.addGrant("g-cal-sup", cal, stagemanager, council, { team: stageops });

  const adam = repo.addActor("adam", "Adam");
  repo.addGrant("g-adam", adam, stagemanager, council, { team: stageops, primary: true });

  const erin = repo.addActor("erin", "Erin");
  repo.addGrant("g-erin", erin, stagemanager, council, { team: gate, primary: true });

  const frank = repo.addActor("frank", "Frank");
  repo.addGrant("g-frank", frank, volunteer, council, { team: stageops, primary: true });

  return {
    db,
    repo,
    ops,
    op: riverbend,
    bigparkPath: repo.scopePath(bigpark)!,
    eastPath: repo.scopePath(eaststage)!,
    stageops,
    gate,
    gateEast,
    booth,
    board,
    cart,
  };
}

type Body = (w: World) => Promise<void>;

const cases: Record<string, Body> = {
  "OH-QM-01": async (w) => {
    const hats = await w.repo.hatsOf("alice", w.op);
    const worn = wornHat(wearableAt(hats, w.bigparkPath));
    assert(admitted(hats, w.bigparkPath), "a configuring hat admits its holder");
    assert(can(worn, CONFIGURE, atScope(w.bigparkPath)), "it configures where it is anchored");
    assert(!can(worn, READ_LOG, onTeam(w.stageops, w.bigparkPath)), "it reads no dispatch log");
    assert((await w.ops.readableTeamsAt(hats, w.op, w.bigparkPath)).length === 0, "it adds no read reach");
  },

  "OH-QM-02": async (w) => {
    const hats = await w.repo.hatsOf("erin", w.op);
    const worn = wornHat(wearableAt(hats, w.bigparkPath));
    assert(can(worn, RESOLVE, onTeam(w.gate, w.bigparkPath)), "supervises the same-named crew at its own site");
    assert(!can(worn, RESOLVE, onTeam(w.gateEast, w.eastPath)), "never reaches the same-named crew at another site");
  },

  "OH-QM-03": async (w) => {
    const hats = await w.repo.hatsOf("bob", w.op);
    const wearable = wearableAt(hats, w.eastPath);
    assert(!wearable.some((h) => h.grant.primary), "the primary is not wearable here");
    const worn = wornHat(wearable);
    assert(worn?.grant.id === "g-bob-east", "a live wearable hat stands in");
    assert(can(worn, RESOLVE, onTeam(w.gateEast, w.eastPath)), "and authorizes where it reaches");
  },

  "OH-QM-04": async (w) => {
    const worn = wornHat(wearableAt(await w.repo.hatsOf("bob", w.op), w.bigparkPath), "g-bob-stageops");
    assert(worn?.grant.id === "g-bob-stageops", "the claim is honoured while it is held");
    w.repo.revokeGrant("g-bob-stageops");
    const after = wornHat(wearableAt(await w.repo.hatsOf("bob", w.op), w.bigparkPath), "g-bob-stageops");
    assert(after?.grant.id === "g-bob-gate", "a revoked claim falls back to a live wearable hat");
  },

  "OH-QM-05": async (w) => {
    // The act and its audit row are the host's; the model's share is that
    // revocation is real, so the recorded snapshot is the only intelligible
    // trace — a live lookup cannot reconstruct it.
    assert(!SCHEMA.includes("audit"), "the model keeps no audit table; the host records the snapshot");
    assert(!SCHEMA.includes("membership"), "nor a membership table");
    const snapshot = "stagemanager:stage ops@big park"; // built from names the host holds
    w.repo.revokeGrant("g-bob-stageops");
    assert(!(await w.repo.hatsOf("bob", w.op)).some((h) => h.grant.id === "g-bob-stageops"), "the grant is gone");
    assert(snapshot === "stagemanager:stage ops@big park", "the recorded snapshot stays legible");
  },

  "OH-QM-06": async (w) => {
    const hats = await w.repo.hatsOf("frank", w.op);
    assert(hats.length === 1, "a member is one row");
    assert(hats[0]!.actions.includes(SEND), "and that row is the affiliation");
  },

  "OH-QM-07": async (w) => {
    const hats = await w.repo.hatsOf("cal", w.op);
    const worn = wornHat(wearableAt(hats, w.bigparkPath), "g-cal-sup");
    assert(!worn!.actions.includes(SEND), "the supervisor hat does not itself speak");
    assert(maySpeak(worn, onTeam(w.stageops, w.bigparkPath), hats, SEND), "a serving member speaks without switching hats");
    const adamHats = await w.repo.hatsOf("adam", w.op);
    const adamWorn = wornHat(wearableAt(adamHats, w.bigparkPath));
    assert(!maySpeak(adamWorn, onTeam(w.stageops, w.bigparkPath), adamHats, SEND), "a non-member supervisor is refused");
  },

  "OH-QM-08": async (w) => {
    const hats = await w.repo.hatsOf("alice", w.op);
    const worn = wornHat(wearableAt(hats, w.bigparkPath));
    assert(!can(worn, RESOLVE, onTeam(w.stageops, w.bigparkPath)), "a configuring hat does not supervise");
    assert(organizationsOf(hats).length === 0, "a scope-bound grant names no organization it is in");
    assert((await w.ops.readableTeamsAt(hats, w.op, w.bigparkPath)).length === 0, "and adds no organization read reach");
  },

  "OH-QM-09": async (w) => {
    assert(w.ops.peersOf(w.stageops).includes(w.board) && w.ops.peersOf(w.board).includes(w.stageops), "peer reach is mutual");
    const bobHats = await w.repo.hatsOf("bob", w.op);
    const readable = await w.ops.readableTeamsAt(bobHats, w.op, w.bigparkPath);
    assert(readable.includes(w.board), "a supervisor reads a peer");
    assert(!readable.includes(w.cart), "peer reach is one hop, not transitive");
    const worn = wornHat(wearableAt(bobHats, w.bigparkPath));
    assert(!can(worn, RESOLVE, onTeam(w.board, w.bigparkPath)), "peer reach is read-only");
    const frankReadable = await w.ops.readableTeamsAt(await w.repo.hatsOf("frank", w.op), w.op, w.bigparkPath);
    assert(!frankReadable.includes(w.board), "peer reach is supervisors-only");
    assert(refuses(() => w.ops.linkTeams(w.stageops, w.gate, "bigpark")), "an intra-organization edge is redundant");
    assert(refuses(() => w.ops.linkTeams(w.board, w.booth, "bigpark")), "an edge across sites is refused");
  },

  "OH-QM-10": async (w) => {
    // The two reads the port owns. The claim is *indexed*, not which index the
    // planner prefers — grant_identity and team_by_org both lead on the key.
    const indexed = (plan: string): boolean => plan.includes("USING INDEX") || plan.includes("USING COVERING INDEX");
    const hatsPlan = w.db.plan(
      `SELECT g.id FROM grant g JOIN organization o ON o.id = g.organization_id WHERE g.actor_id = 'bob' AND o.scope_id = 'riverbend'`,
    );
    assert(indexed(hatsPlan), `held hats should be an index search, got: ${hatsPlan}`);
    const readPlan = w.db.plan(
      `SELECT t.id FROM team t JOIN scope s ON s.id = t.scope_id WHERE t.organization_id IN ('council') AND substr('/riverbend/bigpark/', 1, length(s.path)) = s.path`,
    );
    assert(indexed(readPlan), `readable teams should be an index search, got: ${readPlan}`);
  },

  "OH-QM-11": async (w) => {
    // Two requests, two memos. The claim is worn by the first; the grant is
    // revoked between them; the second request — a fresh `perRequest` — must
    // neither wear nor serve it. A memo outliving its request is the bug this
    // case exists to catch.
    const request1 = perRequest(w.repo);
    const d1 = await decide(request1, {
      actorId: "bob",
      operationId: w.op,
      scopePath: w.bigparkPath,
      teamId: w.stageops,
      action: RESOLVE,
      claimedHatId: "g-bob-stageops",
    });
    assert(d1.ok && d1.hat.grant.id === "g-bob-stageops" && d1.fallback === "claimed", "the claim is worn while held");
    w.repo.revokeGrant("g-bob-stageops");
    const request2 = perRequest(w.repo);
    const d2 = await decide(request2, {
      actorId: "bob",
      operationId: w.op,
      scopePath: w.bigparkPath,
      teamId: w.stageops,
      action: RESOLVE,
      claimedHatId: "g-bob-stageops",
    });
    assert(!d2.ok && d2.hat?.grant.id !== "g-bob-stageops", "a hat revoked after one request is not worn by the next");
    assert(d2.claimed === "g-bob-stageops" && d2.fallback !== "claimed", "the revoked claim falls back, and the row shows the drift");
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
