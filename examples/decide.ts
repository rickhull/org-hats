// The spine walkthrough — every decision shape the request spine produces,
// exercised over the SQLite adapter and, once, over the fake port.
//
//   node examples/decide.ts

import { fileURLToPath } from "node:url";
import {
  AUTHOR,
  RESOLVE,
  decide,
  decideSpeak,
  fakeRepository,
  leafScopeId,
  parentPath,
  perRequest,
  type Decision,
  type HeldHat,
  type Id,
  type SpeakDecision,
} from "../src/index.ts";
import { Db, SqliteRepository, installSchema } from "../src/node.ts";

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

const show = (d: Decision | SpeakDecision): string => {
  const h = d.hat;
  const hat =
    h === null
      ? "-"
      : `${h.roleName ?? h.grant.roleId}:${h.teamName ?? h.grant.teamId ?? h.grant.scopeId}@${
          h.scopeName ?? leafScopeId(h.anchorPath)
        }`;
  const verdict = d.ok ? "allow" : `deny/${d.reason}`;
  return `${verdict.padEnd(18)} worn=${hat.padEnd(24)} fallback=${d.fallback ?? "-"}`;
};

/** A one-line audit row — the shape a host records on every act (rule 5);
 * names ride on the host's extended HeldHat, not on the model's. */
const audit = (d: Decision | SpeakDecision, actor: Id): string =>
  `${actor}\t${d.action}\t${d.ok ? "allow" : `deny:${d.reason}`}\that=${d.hat?.grant.id ?? "-"}\tfallback=${d.fallback ?? "-"}\tclaimed=${d.claimed ?? "-"}`;

export async function runDecide(): Promise<void> {
  const db = new Db(":memory:");
  try {
    installSchema(db);
    const repo = new SqliteRepository(db);

    const acme = repo.addScope("acme");
    const north = repo.addScope("north", acme);
    const south = repo.addScope("south", acme);
    const northPath = repo.scopePath(north)!;
    const southPath = repo.scopePath(south)!;

    const atlas = repo.addOrg("atlas", acme, "Atlas");
    const beacon = repo.addOrg("beacon", acme, "Beacon");
    const drive = repo.addTeam("drive", atlas, north, "drive");
    const logistics = repo.addTeam("logistics", atlas, north, "logistics");
    const facilities = repo.addTeam("facilities", beacon, north, "facilities");
    const delivery = repo.addTeam("delivery", atlas, south, "delivery");

    const coach = repo.addRole("coach", "Coach");
    const supervisor = repo.addRole("supervisor", "Supervisor");
    repo.grantCapability(coach, AUTHOR);
    repo.grantCapability(supervisor, RESOLVE);

    const blake = repo.addActor("blake", "Blake Rivera");
    repo.addGrant("g-blake-lead", blake, supervisor, atlas, { team: drive, primary: true });
    repo.addGrant("g-blake-coach", blake, coach, atlas, { team: drive, default: true });

    const robin = repo.addActor("robin", "Robin Sato");
    repo.addGrant("g-robin-log", robin, supervisor, atlas, { team: logistics, primary: true });

    const cal = repo.addActor("cal", "Cal Jensen");
    repo.addGrant("g-cal-coach", cal, coach, atlas, { team: drive, primary: true, default: true });
    repo.addGrant("g-cal-sup", cal, supervisor, atlas, { team: drive });

    const adam = repo.addActor("adam", "Adam Voss");
    repo.addGrant("g-adam", adam, supervisor, atlas, { team: drive, primary: true });

    // Ellis spans organizations: a primary in each (C31).
    const ellis = repo.addActor("ellis", "Ellis Novak");
    repo.addGrant("g-ellis-atlas", ellis, supervisor, atlas, { team: drive, primary: true });
    repo.addGrant("g-ellis-beacon", ellis, supervisor, beacon, { team: facilities, primary: true });

    console.log("== the spine: deny as data, in the model's order ==");

    // 1. The default is least privilege: Blake's default hat is Coach, which
    //    cannot resolve. Acting requires the claim.
    const d1 = await decide(repo, { actorId: blake, operationId: acme, scopePath: northPath, teamId: drive, action: RESOLVE });
    console.log(`blake resolves, no claim   ${show(d1)}`);
    assert(!d1.ok && d1.reason === "no-capability" && d1.fallback === "default", "the default hat must not resolve");

    // 2. The claim, honoured: the same request wearing the lead hat.
    const d2 = await decide(repo, { actorId: blake, operationId: acme, scopePath: northPath, teamId: drive, action: RESOLVE, claimedHatId: "g-blake-lead" });
    console.log(`blake resolves, claimed    ${show(d2)}`);
    assert(d2.ok && d2.hat.grant.id === "g-blake-lead" && d2.fallback === "claimed", "a held, wearable claim authorizes");

    // 3. Wrong site: a north hat is not wearable at south (rule 8).
    const d3 = await decide(repo, { actorId: blake, operationId: acme, scopePath: southPath, teamId: delivery, action: RESOLVE, claimedHatId: "g-blake-lead" });
    console.log(`blake at south             ${show(d3)}`);
    assert(!d3.ok && d3.reason === "not-admitted", "a claim is validated against the wearable, never the held");

    // 4. Out of reach: Robin's worn hat reaches logistics, not drive.
    const d4 = await decide(repo, { actorId: robin, operationId: acme, scopePath: northPath, teamId: drive, action: RESOLVE });
    console.log(`robin on drive             ${show(d4)}`);
    assert(!d4.ok && d4.reason === "out-of-reach", "capability without reach refuses");

    // 5. Unknown actor: no grant in the operation.
    const d5 = await decide(repo, { actorId: "nobody", operationId: acme, scopePath: northPath, teamId: drive, action: RESOLVE });
    console.log(`nobody                     ${show(d5)}`);
    assert(!d5.ok && d5.reason === "unknown-actor", "an actor with no grants is unknown");

    // 6. Rule 7 through the spine: revoke the claim, decide again. The claim
    //    falls back (OH-QM-04) and the drift is auditable, not silent.
    repo.revokeGrant("g-blake-lead");
    const d6 = await decide(repo, { actorId: blake, operationId: acme, scopePath: northPath, teamId: drive, action: RESOLVE, claimedHatId: "g-blake-lead" });
    console.log(`blake, claim revoked       ${show(d6)}`);
    assert(!d6.ok && d6.fallback === "default" && d6.claimed === "g-blake-lead", "a revoked claim falls back, and the row shows the drift");

    console.log(`audit row (rule 5)         ${audit(d6, "blake")}`);

    // 7. The two-edge rule: Cal wears Supervisor but holds Coach, so speaks;
    //    Adam wears Supervisor and holds nothing that authors, so cannot.
    console.log("\n== speaking: the worn hat reaches, a held grant authors ==");
    const s1 = await decideSpeak(repo, { actorId: cal, operationId: acme, scopePath: northPath, teamId: drive, action: AUTHOR, claimedHatId: "g-cal-sup" });
    console.log(`cal speaks for drive       ${show(s1)}`);
    assert(s1.ok && s1.hat.grant.id === "g-cal-sup", "a member authors without switching hats");
    const s2 = await decideSpeak(repo, { actorId: adam, operationId: acme, scopePath: northPath, teamId: drive, action: AUTHOR });
    console.log(`adam speaks for drive      ${show(s2)}`);
    assert(!s2.ok && s2.reason === "not-affiliated", "a supervisor who is not a member is refused");

    // 7b. The same claim by name — a matcher, not a translated id. The audit
    //     records the grant the claim resolved to.
    const s3 = await decideSpeak(repo, { actorId: cal, operationId: acme, scopePath: northPath, teamId: drive, action: AUTHOR, claimedHatId: (h) => h.roleName === "Supervisor" });
    console.log(`cal claims \`Supervisor\`    ${show(s3)}`);
    assert(s3.ok && s3.claimed === "g-cal-sup" && s3.fallback === "claimed", "a matcher claim resolves and is recorded by grant id");

    // 8. C31, taken as a position: the organization is request context. With
    //    beacon in force, Ellis's atlas primary is not even wearable.
    console.log("\n== the organization as request context (C31) ==");
    const e1 = await decide(repo, { actorId: ellis, operationId: acme, scopePath: northPath, teamId: facilities, action: RESOLVE, organizationId: beacon });
    console.log(`ellis/beacon, facilities   ${show(e1)}`);
    assert(e1.ok && e1.hat.grant.organizationId === beacon, "the in-force organization's hat authorizes");
    const e2 = await decide(repo, { actorId: ellis, operationId: acme, scopePath: northPath, teamId: drive, action: RESOLVE, organizationId: beacon });
    console.log(`ellis/beacon, drive        ${show(e2)}`);
    assert(!e2.ok && e2.reason === "out-of-reach", "another organization's team stays out of reach");

    // 9. The spine over a fake port — no driver anywhere, pure fixtures.
    console.log("\n== the spine over a fake port ==");
    const hat: HeldHat = {
      grant: { id: "g-avery", actorId: "avery", roleId: "coach", organizationId: atlas, teamId: drive, scopeId: null, primary: true, default: true },
      actions: [AUTHOR],
      anchorPath: northPath,
      roleName: "Coach",
      teamName: "drive",
      scopeName: "north",
    };
    const fake = fakeRepository(() => [hat]);
    const f1 = await decide(fake, { actorId: "avery", operationId: acme, scopePath: northPath, teamId: drive, action: AUTHOR });
    console.log(`avery, from literals       ${show(f1)}`);
    assert(f1.ok && f1.hat.grant.id === "g-avery" && f1.hat.roleName === "Coach", "the spine runs over two functions and a record");

    // 10. The path readers — `childPath` builds, these parse, and the format
    //     is spelled once, here.
    console.log("\n== the path readers ==");
    console.log(`leaf(${northPath}) = ${leafScopeId(northPath)}   parent(${northPath}) = ${parentPath(northPath)}`);
    assert(leafScopeId(northPath) === north && leafScopeId("/acme/") === acme && leafScopeId("/") === "", "the leaf is the last segment");
    assert(parentPath(northPath) === "/acme/" && parentPath("/acme/") === "/" && parentPath("/") === "/", "the parent is the path less its leaf");
    assert(parentPath(northPath) + leafScopeId(northPath) + "/" === northPath, "parent + leaf + '/' rebuilds the path");

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
    await decide(scoped, { actorId: "avery", operationId: acme, scopePath: northPath, teamId: drive, action: AUTHOR });
    await decide(scoped, { actorId: "avery", operationId: acme, scopePath: northPath, teamId: drive, action: RESOLVE });
    console.log(`two decisions, one request   hatsOf called ${reads} time${reads === 1 ? "" : "s"}`);
    assert(reads === 1, "a request reads the hats once, however many times it decides");
    const fresh = perRequest(counted);
    await decide(fresh, { actorId: "avery", operationId: acme, scopePath: northPath, teamId: drive, action: AUTHOR });
    assert(reads === 2, "a new request is a new snapshot — the memo never outlives its request");

    console.log("\nall assertions passed (spine)");
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runDecide();
}
