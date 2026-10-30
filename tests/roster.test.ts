// Actor lifecycle and organization-owned administration at the portable
// authority seam: create, rename, appoint, and retire.

import test from "node:test";
import assert from "node:assert/strict";

import { actorId, isFailed, operationId, organizationId, siteId, teamId } from "../src/contract.ts";
import { createInMemoryAuthority } from "../src/authority/engine.ts";
import { fixedClock, webCryptoSigner } from "../src/authority/internal.ts";
import type { AuthorityCommand } from "../src/authority/types.ts";
import { AUTHORITY_INTERFACE_VERSION } from "../src/authority/types.ts";
import type { TwinFixture } from "../src/authority/twins.ts";
import { failureOf, fixtureSnapshot, okOf, successOf, type CommandBody } from "./helpers.ts";

const ORG = organizationId("org-roster");
const OTHER_ORG = organizationId("org-roster-other");
const ADMIN = actorId("actor-roster-admin");
const SECOND = actorId("actor-roster-second");
const TARGET = actorId("actor-roster-target");
const DISABLED = actorId("actor-roster-disabled");
const OTHER = actorId("actor-roster-other");
const OP = operationId("op-roster");
const SITE = siteId("site-roster");
const TEAM = teamId("team-roster");

const ADMIN_EVIDENCE = { provider: "idp", subject: "roster-admin" } as const;
const SECOND_EVIDENCE = { provider: "idp", subject: "roster-second" } as const;
const TARGET_EVIDENCE = { provider: "idp", subject: "roster-target" } as const;
const OTHER_EVIDENCE = { provider: "idp", subject: "roster-other" } as const;

const fixture: TwinFixture = {
  name: "invitee",
  policy: {
    format: 1,
    id: "policy-roster",
    version: "1",
    actions: ["observe"],
    roles: [{ title: "member", actions: ["observe"] }],
    readPolicy: { organizations: "granted-teams" },
  },
  snapshot: fixtureSnapshot({
    operations: [{ operationId: OP }],
    organizations: [{ organizationId: ORG }, { organizationId: OTHER_ORG }],
    actors: [
      { organizationId: ORG, actorId: ADMIN },
      { organizationId: ORG, actorId: SECOND },
      { organizationId: ORG, actorId: TARGET },
      { organizationId: ORG, actorId: DISABLED, disabled: true },
      { organizationId: OTHER_ORG, actorId: OTHER },
    ],
    sites: [{ siteId: SITE, operationId: OP, aliases: [] }],
    teams: [{ teamId: TEAM, siteId: SITE, organizationId: ORG }],
    grants: [{
      grantId: "grant-roster-admin",
      operationId: OP,
      organizationId: ORG,
      actorId: ADMIN,
      role: "member",
      target: { kind: "team", teamId: TEAM },
      primary: true,
    }],
    participations: [
      { organizationId: ORG, operationId: OP, status: "active" },
      { organizationId: OTHER_ORG, operationId: OP, status: "active" },
    ],
  }),
};

interface SetupOptions {
  readonly secondLinked?: boolean;
  readonly secondDisabled?: boolean;
}

const setup = async (options: SetupOptions = {}) => {
  const links = [
    { provider: "idp", subject: "roster-admin", organizationId: ORG, actorId: ADMIN },
    { provider: "idp", subject: "roster-target", organizationId: ORG, actorId: TARGET },
    { provider: "idp", subject: "roster-other", organizationId: OTHER_ORG, actorId: OTHER },
    ...(options.secondLinked === true
      ? [{ provider: "idp", subject: "roster-second", organizationId: ORG, actorId: SECOND }]
      : []),
  ];
  const engine = await createInMemoryAuthority({
    clock: fixedClock(1_700_000_000),
    signer: await webCryptoSigner("roster-test"),
    fixtures: [fixture],
    principalLinks: links,
    orgAdmins: { [ORG]: options.secondLinked === true ? [ADMIN, SECOND] : [ADMIN] },
  });
  if (options.secondDisabled === true && options.secondLinked === true) {
    // the fixture seeds enabled actors; disable through the API so the state
    // change is the one the commands see
    okOf(await engine.runtime.command(cmd(
      { kind: "disable-actor", organizationId: ORG, actorId: SECOND },
      fresh(ADMIN_EVIDENCE),
      "setup-disable-second",
    )));
  }
  return { engine };
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

const create = (actor: string, displayName?: string) =>
  ({
    kind: "create-actor" as const,
    organizationId: ORG,
    actorId: actor,
    ...(displayName === undefined ? {} : { displayName }),
  });

test("[A10] create-actor adds an enabled, unlinked actor the operation projection sees", async () => {
  const { engine } = await setup();
  const result = okOf(await engine.runtime.command(cmd(create("actor-new", "New Person"), fresh(ADMIN_EVIDENCE), "create-1")));
  assert.equal(result.receipt.applied, true);
  const created = engine.snapshotOf(OP)?.actors.find((actor) => actor.actorId === "actor-new");
  assert.equal(created?.displayName, "New Person");
  assert.equal(created?.disabled, undefined);

  const replay = okOf(await engine.runtime.command(cmd(create("actor-new", "New Person"), fresh(ADMIN_EVIDENCE), "create-1")));
  assert.equal(replay.receipt.applied, false, "a retry replays its claim");
  const reuse = await engine.runtime.command(cmd(create("actor-new", "New Person"), fresh(ADMIN_EVIDENCE), "create-1"));
  assert.equal(reuse.ok, true);

  const duplicate = await engine.runtime.command(cmd(create("actor-new"), fresh(ADMIN_EVIDENCE), "create-2"));
  assert.equal(failureOf(duplicate).kind, "invalid-command");
  assert.match(failureOf(duplicate).detail ?? "", /already exists/);
});

test("create-actor validates the caller-supplied id and refuses an envelope", async () => {
  const { engine } = await setup();
  for (const [key, body] of [
    ["empty-id", create("  ")],
    ["empty-name", create("actor-empty-name", "  ")],
  ] as const) {
    const result = await engine.runtime.command(cmd(body, fresh(ADMIN_EVIDENCE), key));
    assert.equal(failureOf(result).kind, "invalid-command", key);
  }
  const issued = successOf(await engine.runtime.accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: OP,
    evidence: ADMIN_EVIDENCE,
  }));
  const viaEnvelope = await engine.runtime.command(cmd(
    create("actor-envelope"),
    { kind: "access-envelope", envelope: issued.envelope },
    "create-envelope",
  ));
  assert.equal(failureOf(viaEnvelope).kind, "denied");
  assert.match(failureOf(viaEnvelope).detail ?? "", /fresh evidence/);
});

test("[A9] only an administrator of that organization may change its roster", async () => {
  const { engine } = await setup();
  const nonAdmin = await engine.runtime.command(cmd(create("actor-non-admin"), fresh(TARGET_EVIDENCE), "create-non-admin"));
  assert.equal(failureOf(nonAdmin).kind, "denied");

  const otherOrg = await engine.runtime.command(cmd(
    { kind: "create-actor", organizationId: OTHER_ORG, actorId: "actor-other-new" },
    fresh(ADMIN_EVIDENCE),
    "create-other-org",
  ));
  assert.equal(failureOf(otherOrg).kind, "wrong-binding");
});

test("update-actor sets, clears, and refuses an empty name", async () => {
  const { engine } = await setup();
  okOf(await engine.runtime.command(cmd(
    { kind: "update-actor", organizationId: ORG, actorId: TARGET, displayName: "Renamed Person" },
    fresh(ADMIN_EVIDENCE),
    "rename-set",
  )));
  let target = engine.snapshotOf(OP)?.actors.find((actor) => actor.actorId === TARGET);
  assert.equal(target?.displayName, "Renamed Person");

  okOf(await engine.runtime.command(cmd(
    { kind: "update-actor", organizationId: ORG, actorId: TARGET, displayName: null },
    fresh(ADMIN_EVIDENCE),
    "rename-clear",
  )));
  target = engine.snapshotOf(OP)?.actors.find((actor) => actor.actorId === TARGET);
  assert.equal(target?.displayName, undefined);

  const empty = await engine.runtime.command(cmd(
    { kind: "update-actor", organizationId: ORG, actorId: TARGET, displayName: "" },
    fresh(ADMIN_EVIDENCE),
    "rename-empty",
  ));
  assert.equal(failureOf(empty).kind, "invalid-command");

  const unknown = await engine.runtime.command(cmd(
    { kind: "update-actor", organizationId: ORG, actorId: "actor-unknown", displayName: "X" },
    fresh(ADMIN_EVIDENCE),
    "rename-unknown",
  ));
  assert.equal(failureOf(unknown).kind, "invalid-command");
});

test("[A9] appointment grants standing; disabled actors cannot be appointed", async () => {
  const { engine } = await setup();
  // TARGET is linked but not an administrator
  assert.equal(
    failureOf(await engine.runtime.command(cmd(create("actor-before"), fresh(TARGET_EVIDENCE), "create-before"))).kind,
    "denied",
  );
  okOf(await engine.runtime.command(cmd(
    { kind: "appoint-administrator", organizationId: ORG, actorId: TARGET },
    fresh(ADMIN_EVIDENCE),
    "appoint-target",
  )));
  okOf(await engine.runtime.command(cmd(create("actor-after"), fresh(TARGET_EVIDENCE), "create-after")));

  const disabled = await engine.runtime.command(cmd(
    { kind: "appoint-administrator", organizationId: ORG, actorId: DISABLED },
    fresh(ADMIN_EVIDENCE),
    "appoint-disabled",
  ));
  assert.equal(failureOf(disabled).kind, "not-admitted");
});

test("retiring a non-administrator is a no-op; an unknown actor is refused", async () => {
  const { engine } = await setup();
  okOf(await engine.runtime.command(cmd(
    { kind: "retire-administrator", organizationId: ORG, actorId: TARGET },
    fresh(ADMIN_EVIDENCE),
    "retire-non-admin",
  )));
  const unknown = await engine.runtime.command(cmd(
    { kind: "retire-administrator", organizationId: ORG, actorId: "actor-unknown" },
    fresh(ADMIN_EVIDENCE),
    "retire-unknown",
  ));
  assert.equal(failureOf(unknown).kind, "invalid-command");
});

test("a sole administrator cannot retire while the successor is unclaimed", async () => {
  const { engine } = await setup();
  okOf(await engine.runtime.command(cmd(
    { kind: "appoint-administrator", organizationId: ORG, actorId: SECOND },
    fresh(ADMIN_EVIDENCE),
    "appoint-unclaimed",
  )));
  const refused = await engine.runtime.command(cmd(
    { kind: "retire-administrator", organizationId: ORG, actorId: ADMIN },
    fresh(ADMIN_EVIDENCE),
    "retire-self-unclaimed-successor",
  ));
  assert.equal(failureOf(refused).kind, "denied");
  assert.match(failureOf(refused).detail ?? "", /no other usable administrator/);
});

test("a linked, enabled successor allows the retirement and takes over", async () => {
  const { engine } = await setup({ secondLinked: true });
  okOf(await engine.runtime.command(cmd(
    { kind: "retire-administrator", organizationId: ORG, actorId: ADMIN },
    fresh(ADMIN_EVIDENCE),
    "retire-self",
  )));
  // the retired administrator's fresh evidence no longer administers
  assert.equal(
    failureOf(await engine.runtime.command(cmd(create("actor-after-retire"), fresh(ADMIN_EVIDENCE), "create-after-retire"))).kind,
    "denied",
  );
  okOf(await engine.runtime.command(cmd(create("actor-by-successor"), fresh(SECOND_EVIDENCE), "create-by-successor")));

  // A retired caller can no longer authorize a replay. The claim is still
  // readable by a remaining administrator, and it replays without reapplying.
  const replay = okOf(await engine.runtime.command(cmd(
    { kind: "retire-administrator", organizationId: ORG, actorId: ADMIN },
    fresh(SECOND_EVIDENCE),
    "retire-self",
  )));
  assert.equal(replay.receipt.applied, false, "the retry replays rather than re-authorizing");
});

test("a disabled successor is not usable", async () => {
  const { engine } = await setup({ secondLinked: true, secondDisabled: true });
  const refused = await engine.runtime.command(cmd(
    { kind: "retire-administrator", organizationId: ORG, actorId: ADMIN },
    fresh(ADMIN_EVIDENCE),
    "retire-with-disabled-successor",
  ));
  assert.equal(failureOf(refused).kind, "denied");
});
