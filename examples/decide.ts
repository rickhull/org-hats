// The spine walkthrough — every decision shape the request spine produces,
// exercised over the SQLite adapter and, once, over the fake port. The world
// is the festival; the application is the dispatch board, and `send` is its
// membership action — a member is one who may send as their crew.
//
//   node examples/decide.ts

import { fileURLToPath } from "node:url";
import {
  decide,
  fakeRepository,
  leafScopeId,
  parentPath,
  perRequest,
  type Decision,
  type HeldHat,
  type Id,
} from "../src/index.ts";
import { Db, SqliteRepository, installSchema } from "../src/node.ts";

// The dispatch board's actions — this application's vocabulary.
const SEND = "send";
const RESOLVE = "resolve";

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

const show = (d: Decision): string => {
  const h = d.hat;
  const hat =
    h === null
      ? "-"
      : `${h.roleName ?? h.grant.roleId}:${h.teamName ?? h.grant.teamId ?? h.grant.scopeId}@${h.scopeName ?? leafScopeId(h.anchorPath)}`;
  const verdict = d.ok ? "allow" : `deny/${d.reason}`;
  return `${verdict.padEnd(18)} worn=${hat.padEnd(24)} fallback=${d.fallback ?? "-"}`;
};

/** A one-line audit row — the shape a host records on every act (rule 5);
 * names ride on the host's extended HeldHat, not on the model's. */
const audit = (d: Decision, actor: Id): string =>
  `${actor}\t${d.action ?? "-"}\t${d.ok ? "allow" : `deny:${d.reason}`}\that=${d.hat?.grant.id ?? "-"}\tfallback=${d.fallback ?? "-"}\tclaimed=${d.claimed ?? "-"}`;

export async function runDecide(): Promise<void> {
  const db = new Db(":memory:");
  try {
    installSchema(db);
    const repo = new SqliteRepository(db);

    const riverbend = repo.addScope("riverbend");
    const bigpark = repo.addScope("bigpark", riverbend);
    const eaststage = repo.addScope("eaststage", riverbend);
    const bigparkPath = repo.scopePath(bigpark)!;
    const eastPath = repo.scopePath(eaststage)!;

    const council = repo.addOrg("council", riverbend, "Riverbend Arts Council");
    const ampwire = repo.addOrg("ampwire", riverbend, "Ampwire Sound");
    const stageops = repo.addTeam("stageops", council, bigpark, "stage ops");
    const gate = repo.addTeam("gate", council, bigpark, "gate crew");
    const board = repo.addTeam("board", ampwire, bigpark, "board");
    const booth = repo.addTeam("booth", council, eaststage, "booth");

    const volunteer = repo.addRole("volunteer", "Volunteer");
    const stagemanager = repo.addRole("stagemanager", "Stage Manager");
    repo.grantCapability(volunteer, SEND);
    repo.grantCapability(stagemanager, RESOLVE);

    const blake = repo.addActor("blake", "Blake Rivera");
    repo.addGrant("g-blake-lead", blake, stagemanager, council, { team: stageops, primary: true });
    repo.addGrant("g-blake-vol", blake, volunteer, council, { team: stageops, default: true });

    const robin = repo.addActor("robin", "Robin Sato");
    repo.addGrant("g-robin-gate", robin, stagemanager, council, { team: gate, primary: true });

    const cal = repo.addActor("cal", "Cal Jensen");
    repo.addGrant("g-cal-vol", cal, volunteer, council, { team: stageops, primary: true, default: true });
    repo.addGrant("g-cal-sup", cal, stagemanager, council, { team: stageops });

    const adam = repo.addActor("adam", "Adam Voss");
    repo.addGrant("g-adam", adam, stagemanager, council, { team: stageops, primary: true });

    // Ellis spans organizations: a primary in each (C31).
    const ellis = repo.addActor("ellis", "Ellis Novak");
    repo.addGrant("g-ellis-council", ellis, stagemanager, council, { team: stageops, primary: true });
    repo.addGrant("g-ellis-ampwire", ellis, stagemanager, ampwire, { team: board, primary: true });

    console.log("== the spine: deny as data, in the model's order ==");

    // 1. The default is least privilege: Blake's default hat is Volunteer,
    //    which cannot resolve. Acting requires the claim.
    const d1 = await decide(repo, { actorId: blake, operationId: riverbend, scopePath: bigparkPath, teamId: stageops, action: RESOLVE });
    console.log(`blake resolves, no claim   ${show(d1)}`);
    assert(!d1.ok && d1.reason === "no-capability" && d1.fallback === "default", "the default hat must not resolve");

    // 2. The claim, honoured: the same request wearing the lead hat.
    const d2 = await decide(repo, { actorId: blake, operationId: riverbend, scopePath: bigparkPath, teamId: stageops, action: RESOLVE, claimedHatId: "g-blake-lead" });
    console.log(`blake resolves, claimed    ${show(d2)}`);
    assert(d2.ok && d2.hat.grant.id === "g-blake-lead" && d2.fallback === "claimed", "a held, wearable claim authorizes");

    // 3. Wrong site: a big-park hat is not wearable at east stage (rule 8).
    const d3 = await decide(repo, { actorId: blake, operationId: riverbend, scopePath: eastPath, teamId: booth, action: RESOLVE, claimedHatId: "g-blake-lead" });
    console.log(`blake at east stage        ${show(d3)}`);
    assert(!d3.ok && d3.reason === "not-admitted", "a claim is validated against the wearable, never the held");

    // 4. Out of reach: Robin's worn hat reaches the gate crew, not stage ops.
    const d4 = await decide(repo, { actorId: robin, operationId: riverbend, scopePath: bigparkPath, teamId: stageops, action: RESOLVE });
    console.log(`robin on stage ops         ${show(d4)}`);
    assert(!d4.ok && d4.reason === "out-of-reach", "capability without reach refuses");

    // 5. Unknown actor: no grant in the operation.
    const d5 = await decide(repo, { actorId: "nobody", operationId: riverbend, scopePath: bigparkPath, teamId: stageops, action: RESOLVE });
    console.log(`nobody                     ${show(d5)}`);
    assert(!d5.ok && d5.reason === "unknown-actor", "an actor with no grants is unknown");

    // 6. Rule 7 through the spine: revoke the claim, decide again. The claim
    //    falls back (OH-QM-04) and the drift is auditable, not silent.
    repo.revokeGrant("g-blake-lead");
    const d6 = await decide(repo, { actorId: blake, operationId: riverbend, scopePath: bigparkPath, teamId: stageops, action: RESOLVE, claimedHatId: "g-blake-lead" });
    console.log(`blake, claim revoked       ${show(d6)}`);
    assert(!d6.ok && d6.fallback === "default" && d6.claimed === "g-blake-lead", "a revoked claim falls back, and the row shows the drift");

    console.log(`audit row (rule 5)         ${audit(d6, "blake")}`);

    // 7. The two-edge shape — presence from the worn hat, standing from a
    //    held one. Cal wears Stage Manager but holds Volunteer (`send`), so
    //    may send as stage ops without switching; Adam holds nothing that
    //    sends. The board's policy; the model's halves.
    console.log("\n== the two-edge shape: the worn hat reaches, a held grant carries ==");
    const s1 = await decide(repo, { actorId: cal, operationId: riverbend, scopePath: bigparkPath, teamId: stageops, action: null, heldAction: SEND, claimedHatId: "g-cal-sup" });
    console.log(`cal sends as stage ops      ${show(s1)}`);
    assert(s1.ok && s1.hat.grant.id === "g-cal-sup", "a member acts without switching hats");
    const s2 = await decide(repo, { actorId: adam, operationId: riverbend, scopePath: bigparkPath, teamId: stageops, action: null, heldAction: SEND });
    console.log(`adam sends as stage ops     ${show(s2)}`);
    assert(!s2.ok && s2.reason === "no-held-action", "a supervisor who holds no send grant is refused");

    // 7b. The same claim by name — a matcher, not a translated id. The audit
    //     records the grant the claim resolved to.
    const s3 = await decide(repo, { actorId: cal, operationId: riverbend, scopePath: bigparkPath, teamId: stageops, action: null, heldAction: SEND, claimedHatId: (h) => h.roleName === "Stage Manager" });
    console.log(`cal claims \`Stage Manager\`  ${show(s3)}`);
    assert(s3.ok && s3.claimed === "g-cal-sup" && s3.fallback === "claimed", "a matcher claim resolves and is recorded by grant id");

    // 8. C31, taken as a position: the organization is request context. With
    //    Ampwire in force, Ellis's Council primary is not even wearable.
    console.log("\n== the organization as request context (C31) ==");
    const e1 = await decide(repo, { actorId: ellis, operationId: riverbend, scopePath: bigparkPath, teamId: board, action: RESOLVE, organizationId: ampwire });
    console.log(`ellis/ampwire, board       ${show(e1)}`);
    assert(e1.ok && e1.hat.grant.organizationId === ampwire, "the in-force organization's hat authorizes");
    const e2 = await decide(repo, { actorId: ellis, operationId: riverbend, scopePath: bigparkPath, teamId: stageops, action: RESOLVE, organizationId: ampwire });
    console.log(`ellis/ampwire, stage ops   ${show(e2)}`);
    assert(!e2.ok && e2.reason === "out-of-reach", "another organization's team stays out of reach");

    // 9. The spine over a fake port — no driver anywhere, pure fixtures.
    console.log("\n== the spine over a fake port ==");
    const hat: HeldHat = {
      grant: { id: "g-avery", actorId: "avery", roleId: "volunteer", organizationId: council, teamId: gate, scopeId: null, primary: true, default: true },
      actions: [SEND],
      anchorPath: bigparkPath,
      roleName: "Volunteer",
      teamName: "gate crew",
      scopeName: "big park",
    };
    const fake = fakeRepository(() => [hat]);
    const f1 = await decide(fake, { actorId: "avery", operationId: riverbend, scopePath: bigparkPath, teamId: gate, action: SEND });
    console.log(`avery, from literals       ${show(f1)}`);
    assert(f1.ok && f1.hat.grant.id === "g-avery" && f1.hat.roleName === "Volunteer", "the spine runs over two functions and a record");

    // 10. The path readers — `childPath` builds, these parse, and the format
    //     is spelled once, here.
    console.log("\n== the path readers ==");
    console.log(`leaf(${bigparkPath}) = ${leafScopeId(bigparkPath)}   parent(${bigparkPath}) = ${parentPath(bigparkPath)}`);
    assert(leafScopeId(bigparkPath) === bigpark && leafScopeId("/riverbend/") === riverbend && leafScopeId("/") === "", "the leaf is the last segment");
    assert(parentPath(bigparkPath) === "/riverbend/" && parentPath("/riverbend/") === "/" && parentPath("/") === "/", "the parent is the path less its leaf");
    assert(parentPath(bigparkPath) + leafScopeId(bigparkPath) + "/" === bigparkPath, "parent + leaf + '/' rebuilds the path");

    // 11. The request-scoped memo: one hatsOf per request, and one *consistent*
    //     one — two decisions in a request cannot disagree mid-request. Never
    //     shared across requests: revocation lands on the next one.
    console.log("\n== the request-scoped memo ==");
    let reads = 0;
    const counted = fakeRepository(() => {
      reads += 1;
      return [hat];
    });
    const scoped = perRequest(counted);
    await decide(scoped, { actorId: "avery", operationId: riverbend, scopePath: bigparkPath, teamId: gate, action: SEND });
    await decide(scoped, { actorId: "avery", operationId: riverbend, scopePath: bigparkPath, teamId: gate, action: RESOLVE });
    console.log(`two decisions, one request   hatsOf called ${reads} time${reads === 1 ? "" : "s"}`);
    assert(reads === 1, "a request reads the hats once, however many times it decides");
    const fresh = perRequest(counted);
    await decide(fresh, { actorId: "avery", operationId: riverbend, scopePath: bigparkPath, teamId: gate, action: SEND });
    assert(reads === 2, "a new request is a new snapshot — the memo never outlives its request");

    console.log("\nall assertions passed (spine)");
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runDecide();
}
