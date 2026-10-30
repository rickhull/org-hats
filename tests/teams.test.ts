// Team lifecycle at the portable authority seam: an organization requests,
// the operation admits, and retirement revokes what stood on the team.

import test from "node:test";
import assert from "node:assert/strict";

import { actorId, isFailed, operationId, organizationId, siteId } from "../src/contract.ts";
import { createInMemoryAuthority } from "../src/authority/engine.ts";
import { fixedClock, webCryptoSigner } from "../src/authority/internal.ts";
import type { AuthorityCommand } from "../src/authority/types.ts";
import { AUTHORITY_INTERFACE_VERSION } from "../src/authority/types.ts";
import type { TwinFixture } from "../src/authority/twins.ts";
import { ed25519VerifyKey, verify } from "../src/access/verify.ts";
import { failureOf, fixtureSnapshot, handleOf, okOf, successOf, type CommandBody } from "./helpers.ts";

const OP = operationId("op-teams");
const ORG = organizationId("org-teams");
const OTHER = organizationId("org-teams-other");
const IDLE = organizationId("org-teams-idle");
const SITE_ONE = siteId("site-teams-one");
const SITE_TWO = siteId("site-teams-two");
const ADMIN = actorId("actor-teams-admin");
const MEMBER = actorId("actor-teams-member");
const OUTSIDER = actorId("actor-teams-outsider");
const IDLE_ADMIN = actorId("actor-teams-idle-admin");

const ADMIN_EVIDENCE = { provider: "idp", subject: "teams-admin" } as const;
const MEMBER_EVIDENCE = { provider: "idp", subject: "teams-member" } as const;
const OUTSIDER_EVIDENCE = { provider: "idp", subject: "teams-outsider" } as const;
const IDLE_EVIDENCE = { provider: "idp", subject: "teams-idle" } as const;

const fixture: TwinFixture = {
  name: "invitee",
  policy: {
    format: 1,
    id: "policy-teams",
    version: "1",
    actions: ["observe", "configure"],
    roles: [
      { title: "member", actions: ["observe"] },
      { title: "lead", actions: ["configure"] },
    ],
    readPolicy: { organizations: "granted-teams" },
  },
  snapshot: fixtureSnapshot({
    operations: [{ operationId: OP }],
    organizations: [
      { organizationId: ORG },
      { organizationId: OTHER },
      { organizationId: IDLE },
    ],
    actors: [
      { organizationId: ORG, actorId: ADMIN },
      { organizationId: ORG, actorId: MEMBER },
      { organizationId: OTHER, actorId: OUTSIDER },
      { organizationId: IDLE, actorId: IDLE_ADMIN },
    ],
    sites: [
      { siteId: SITE_ONE, operationId: OP, aliases: [] },
      { siteId: SITE_TWO, operationId: OP, aliases: [] },
    ],
    teams: [],
    grants: [
      {
        grantId: "g-teams-lead",
        operationId: OP,
        organizationId: ORG,
        actorId: ADMIN,
        role: "lead",
        target: { kind: "site", siteId: SITE_ONE },
        primary: true,
      },
      {
        grantId: "g-teams-outsider",
        operationId: OP,
        organizationId: OTHER,
        actorId: OUTSIDER,
        role: "member",
        target: { kind: "site", siteId: SITE_ONE },
      },
    ],
    participations: [
      { organizationId: ORG, operationId: OP, status: "active" },
      { organizationId: OTHER, operationId: OP, status: "active" },
    ],
  }),
};

const setup = async () => {
  const engine = await createInMemoryAuthority({
    clock: fixedClock(1_700_000_000),
    signer: await webCryptoSigner("teams-test"),
    fixtures: [fixture],
    principalLinks: [
      { provider: "idp", subject: "teams-admin", organizationId: ORG, actorId: ADMIN },
      { provider: "idp", subject: "teams-member", organizationId: ORG, actorId: MEMBER },
      { provider: "idp", subject: "teams-outsider", organizationId: OTHER, actorId: OUTSIDER },
      { provider: "idp", subject: "teams-idle", organizationId: IDLE, actorId: IDLE_ADMIN },
    ],
    orgAdmins: { [ORG]: [ADMIN], [OTHER]: [OUTSIDER], [IDLE]: [IDLE_ADMIN] },
  });
  const material = await engine.verificationKey();
  const key = await ed25519VerifyKey(material.keyId, material.publicKey);
  return { engine, keys: new Map([[key.keyId, key]]) };
};

const cmd = (
  body: CommandBody,
  authorization: AuthorityCommand["authorization"],
  idempotencyKey: string,
): AuthorityCommand => ({ interfaceVersion: AUTHORITY_INTERFACE_VERSION, idempotencyKey, authorization, ...body });

const fresh = (evidence: { readonly provider: string; readonly subject: string }) => ({
  kind: "fresh-evidence" as const,
  evidence,
  operationId: OP,
});

const envelope = async (
  engine: Awaited<ReturnType<typeof createInMemoryAuthority>>["runtime"],
  evidence: { readonly provider: string; readonly subject: string },
) => {
  const issued = successOf(await engine.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: OP,
    evidence,
  }));
  return { kind: "access-envelope" as const, envelope: issued.envelope };
};

const request = (teamId: string, siteIdValue = SITE_ONE, displayName?: string) => ({
  kind: "request-team" as const,
  operationId: OP,
  organizationId: ORG,
  teamId,
  siteId: siteIdValue,
  ...(displayName === undefined ? {} : { displayName }),
});

const requestFor = (organizationIdValue: typeof ORG, teamId: string) => ({
  kind: "request-team" as const,
  operationId: OP,
  organizationId: organizationIdValue,
  teamId,
  siteId: SITE_ONE,
});

const snapshotTeam = (engine: Awaited<ReturnType<typeof createInMemoryAuthority>>, teamId: string) =>
  engine.snapshotOf(OP)?.teams.find((team) => team.teamId === teamId);

test("[A17] a team is pending until the operation admits it, then grants can target it", async () => {
  const { engine } = await setup();
  okOf(await engine.runtime.command(cmd(request("team-one", SITE_ONE, "Crew One"), fresh(ADMIN_EVIDENCE), "req-1")));
  assert.equal(snapshotTeam(engine, "team-one"), undefined, "a pending team is not in the snapshot");

  const early = await engine.runtime.command(cmd(
    { kind: "grant-hat", operationId: OP, organizationId: ORG, actorId: MEMBER, role: "member", target: { kind: "team", teamId: "team-one" } },
    await envelope(engine.runtime, ADMIN_EVIDENCE),
    "grant-early",
  ));
  assert.equal(failureOf(early).kind, "invalid-command", "a pending team is not a grant target");

  okOf(await engine.runtime.command(cmd({ kind: "admit-team", operationId: OP, teamId: "team-one" }, await envelope(engine.runtime, ADMIN_EVIDENCE), "admit-1")));
  assert.equal(snapshotTeam(engine, "team-one")?.displayName, "Crew One");

  okOf(await engine.runtime.command(cmd(
    { kind: "grant-hat", operationId: OP, organizationId: ORG, actorId: MEMBER, role: "member", target: { kind: "team", teamId: "team-one" } },
    await envelope(engine.runtime, ADMIN_EVIDENCE),
    "grant-member",
  )));
  const member = successOf(await engine.runtime.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: OP,
    evidence: MEMBER_EVIDENCE,
  }));
  const context = successOf(await engine.runtime.context({ interfaceVersion: AUTHORITY_INTERFACE_VERSION, envelope: member.envelope }));
  assert.ok(context.wearableHats.some((hat) => hat.target.kind === "team" && hat.target.teamId === "team-one"));
});

test("request refuses a non-administrator, an inactive organization, an unknown site, and a reused id", async () => {
  const { engine } = await setup();
  const nonAdmin = await engine.runtime.command(cmd(request("team-x"), fresh(MEMBER_EVIDENCE), "req-nonadmin"));
  assert.equal(failureOf(nonAdmin).kind, "denied");
  const idle = await engine.runtime.command(cmd(requestFor(IDLE, "team-x"), fresh(IDLE_EVIDENCE), "req-idle"));
  assert.equal(failureOf(idle).kind, "denied");
  assert.match(failureOf(idle).detail ?? "", /does not actively participate/);
  const unknownSite = await engine.runtime.command(cmd(request("team-x", SITE_TWO), fresh(ADMIN_EVIDENCE), "req-site"));
  okOf(unknownSite); // SITE_TWO exists
  const bogusSite = await engine.runtime.command(cmd(request("team-y", siteId("site-missing")), fresh(ADMIN_EVIDENCE), "req-bogus-site"));
  assert.equal(failureOf(bogusSite).kind, "invalid-command");
  const empty = await engine.runtime.command(cmd(request("  "), fresh(ADMIN_EVIDENCE), "req-empty"));
  assert.equal(failureOf(empty).kind, "invalid-command");
  const duplicate = await engine.runtime.command(cmd(request("team-x"), fresh(ADMIN_EVIDENCE), "req-dup"));
  assert.equal(failureOf(duplicate).kind, "invalid-command");
  assert.match(failureOf(duplicate).detail ?? "", /already exists/);
});

test("[A9] only an operation administrator admits", async () => {
  const { engine } = await setup();
  okOf(await engine.runtime.command(cmd(request("team-one"), fresh(ADMIN_EVIDENCE), "req-1")));
  const ownerFresh = await engine.runtime.command(cmd(
    { kind: "admit-team", operationId: OP, teamId: "team-one" },
    fresh(ADMIN_EVIDENCE),
    "admit-owner",
  ));
  assert.equal(failureOf(ownerFresh).kind, "denied", "fresh evidence carries organization standing, not operation standing");
  const outsiderEnvelope = await engine.runtime.command(cmd(
    { kind: "admit-team", operationId: OP, teamId: "team-one" },
    await envelope(engine.runtime, OUTSIDER_EVIDENCE),
    "admit-outsider",
  ));
  assert.equal(failureOf(outsiderEnvelope).kind, "denied");
  okOf(await engine.runtime.command(cmd(
    { kind: "admit-team", operationId: OP, teamId: "team-one" },
    await envelope(engine.runtime, ADMIN_EVIDENCE),
    "admit-admin",
  )));
});

test("the owning organization renames its team; another organization cannot", async () => {
  const { engine } = await setup();
  okOf(await engine.runtime.command(cmd(request("team-one"), fresh(ADMIN_EVIDENCE), "req-1")));
  okOf(await engine.runtime.command(cmd({ kind: "admit-team", operationId: OP, teamId: "team-one" }, await envelope(engine.runtime, ADMIN_EVIDENCE), "admit-1")));
  okOf(await engine.runtime.command(cmd(
    { kind: "update-team", operationId: OP, teamId: "team-one", displayName: "Renamed Crew" },
    fresh(ADMIN_EVIDENCE),
    "rename-1",
  )));
  assert.equal(snapshotTeam(engine, "team-one")?.displayName, "Renamed Crew");
  okOf(await engine.runtime.command(cmd(
    { kind: "update-team", operationId: OP, teamId: "team-one", displayName: null },
    fresh(ADMIN_EVIDENCE),
    "rename-clear",
  )));
  assert.equal(snapshotTeam(engine, "team-one")?.displayName, undefined);
  const empty = await engine.runtime.command(cmd(
    { kind: "update-team", operationId: OP, teamId: "team-one", displayName: "" },
    fresh(ADMIN_EVIDENCE),
    "rename-empty",
  ));
  assert.equal(failureOf(empty).kind, "invalid-command");

  okOf(await engine.runtime.command(cmd(requestFor(OTHER, "team-other"), fresh(OUTSIDER_EVIDENCE), "req-other")));
  okOf(await engine.runtime.command(cmd({ kind: "admit-team", operationId: OP, teamId: "team-other" }, await envelope(engine.runtime, ADMIN_EVIDENCE), "admit-other")));
  const foreign = await engine.runtime.command(cmd(
    { kind: "update-team", operationId: OP, teamId: "team-other", displayName: "Hijacked" },
    fresh(ADMIN_EVIDENCE),
    "rename-foreign",
  ));
  assert.equal(failureOf(foreign).kind, "denied");
});

test("[A17] retirement revokes the team's grants and refresh, while issued envelopes survive to expiry", async () => {
  const { engine, keys } = await setup();
  okOf(await engine.runtime.command(cmd(request("team-one"), fresh(ADMIN_EVIDENCE), "req-1")));
  okOf(await engine.runtime.command(cmd({ kind: "admit-team", operationId: OP, teamId: "team-one" }, await envelope(engine.runtime, ADMIN_EVIDENCE), "admit-1")));
  okOf(await engine.runtime.command(cmd(
    { kind: "grant-hat", operationId: OP, organizationId: ORG, actorId: MEMBER, role: "member", target: { kind: "team", teamId: "team-one" } },
    await envelope(engine.runtime, ADMIN_EVIDENCE),
    "grant-member",
  )));
  const member = successOf(await engine.runtime.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: OP,
    evidence: MEMBER_EVIDENCE,
  }));

  okOf(await engine.runtime.command(cmd(
    { kind: "retire-team", operationId: OP, teamId: "team-one" },
    fresh(ADMIN_EVIDENCE),
    "retire-owner",
  )));
  assert.equal(snapshotTeam(engine, "team-one"), undefined, "a retired team leaves the snapshot");
  const teamGrant = engine.snapshotOf(OP)?.grants.find((grant) => grant.target.kind === "team" && grant.target.teamId === "team-one");
  assert.equal(teamGrant?.revoked, true, "the grant is retained and revoked");

  const dead = await engine.runtime.refresh({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: OP,
    handle: handleOf(member.refresh),
  });
  assert.equal(failureOf(dead).kind, "unauthenticated", "the refresh chain dies with the grant");

  const live = successOf(await verify(member.envelope, keys, {
    now: member.envelope.claims.iat + 1,
    expectedOperationId: OP,
  }));
  assert.equal(live.access.mayAct("observe", { kind: "team", teamId: "team-one" }), true, "the issued envelope keeps its reach to expiry");

  const reuse = await engine.runtime.command(cmd(request("team-one"), fresh(ADMIN_EVIDENCE), "req-reuse"));
  assert.equal(failureOf(reuse).kind, "invalid-command", "a retired id is never reused");

  const replay = okOf(await engine.runtime.command(cmd(
    { kind: "retire-team", operationId: OP, teamId: "team-one" },
    fresh(ADMIN_EVIDENCE),
    "retire-owner",
  )));
  assert.equal(replay.receipt.applied, false);
});

test("either side may retire, but the owner needs fresh evidence", async () => {
  const { engine } = await setup();
  okOf(await engine.runtime.command(cmd(requestFor(OTHER, "team-other"), fresh(OUTSIDER_EVIDENCE), "req-other")));
  okOf(await engine.runtime.command(cmd({ kind: "admit-team", operationId: OP, teamId: "team-other" }, await envelope(engine.runtime, ADMIN_EVIDENCE), "admit-other")));

  const viaEnvelope = await engine.runtime.command(cmd(
    { kind: "retire-team", operationId: OP, teamId: "team-other" },
    await envelope(engine.runtime, OUTSIDER_EVIDENCE),
    "retire-envelope",
  ));
  assert.equal(failureOf(viaEnvelope).kind, "denied", "owner retirement requires fresh evidence");
  assert.match(failureOf(viaEnvelope).detail ?? "", /fresh evidence/);

  okOf(await engine.runtime.command(cmd(
    { kind: "retire-team", operationId: OP, teamId: "team-other" },
    fresh(OUTSIDER_EVIDENCE),
    "retire-owner",
  )));

  okOf(await engine.runtime.command(cmd(request("team-one"), fresh(ADMIN_EVIDENCE), "req-1")));
  okOf(await engine.runtime.command(cmd({ kind: "admit-team", operationId: OP, teamId: "team-one" }, await envelope(engine.runtime, ADMIN_EVIDENCE), "admit-1")));
  okOf(await engine.runtime.command(cmd(
    { kind: "retire-team", operationId: OP, teamId: "team-one" },
    await envelope(engine.runtime, ADMIN_EVIDENCE),
    "retire-op-admin",
  )));
});

test("request and admit replay their claims, and a changed payload is refused", async () => {
  const { engine } = await setup();
  const first = okOf(await engine.runtime.command(cmd(request("team-one"), fresh(ADMIN_EVIDENCE), "req-1")));
  assert.equal(first.receipt.applied, true);
  const replay = okOf(await engine.runtime.command(cmd(request("team-one"), fresh(ADMIN_EVIDENCE), "req-1")));
  assert.equal(replay.receipt.applied, false);
  const changed = await engine.runtime.command(cmd(request("team-two"), fresh(ADMIN_EVIDENCE), "req-1"));
  assert.equal(failureOf(changed).kind, "invalid-command");

  const admitted = okOf(await engine.runtime.command(cmd(
    { kind: "admit-team", operationId: OP, teamId: "team-one" },
    await envelope(engine.runtime, ADMIN_EVIDENCE),
    "admit-1",
  )));
  assert.equal(admitted.receipt.applied, true);
  const admittedReplay = okOf(await engine.runtime.command(cmd(
    { kind: "admit-team", operationId: OP, teamId: "team-one" },
    await envelope(engine.runtime, ADMIN_EVIDENCE),
    "admit-1",
  )));
  assert.equal(admittedReplay.receipt.applied, false);
});
