import test from "node:test";
import assert from "node:assert/strict";
import { createPlayground } from "../examples/playground/model.ts";

test("worn actions and union reach are independent, and switching hats refreshes", async () => {
  const playground = await createPlayground();
  const initial = await playground.view();
  assert.equal(initial.verification, "valid");
  assert.equal(initial.selectedHat?.role, "coordinator");
  assert.equal(initial.hats.length, 2);
  const yard = initial.teams.find((team) => team.label === "Yard crew")!;
  const desk = initial.teams.find((team) => team.label === "Facilities desk")!;
  assert.ok(yard.actions.includes("review"));
  assert.deepEqual(desk.actions, []);
  assert.equal(desk.readable, true);
  assert.equal(desk.reachable, true);
  assert.equal(initial.sites.find((site) => site.label === "West Yard")?.configurable, true);
  const admin = initial.hats.find((hat) => hat.role === "admin")!;
  const switched = await playground.selectHat(admin.grantId);
  assert.equal(switched.selectedHat?.grantId, admin.grantId);
  assert.ok(switched.teams.find((team) => team.label === "Facilities desk")!.actions.includes("configure"));
  assert.deepEqual(switched.teams.map(({ id, readable, reachable }) => ({ id, readable, reachable })), initial.teams.map(({ id, readable, reachable }) => ({ id, readable, reachable })));
  assert.deepEqual(switched.sites, initial.sites);
  assert.ok(switched.teams.filter((team) => team.siteLabel === "East Hall").every((team) => team.actions.length === 0));
});

test("revocation invalidates refresh while the old envelope lasts to exact expiry", async () => {
  const playground = await createPlayground();
  const before = await playground.view();
  const revoked = await playground.revokeHat();
  assert.equal(revoked.verification, "valid");
  assert.equal(revoked.selectedHat?.grantId, before.selectedHat?.grantId);
  assert.equal(revoked.grants.find((grant) => grant.id === before.selectedHat?.grantId)?.revoked, true);
  const refreshed = await playground.refresh();
  assert.equal(refreshed.refreshOutcome, "unauthenticated");
  assert.equal(refreshed.verification, "valid");
  const expired = await playground.expire();
  assert.equal(expired.now, before.expiresAt);
  assert.equal(expired.verification, "expired");
  assert.ok(expired.teams.every((team) => team.actions.length === 0 && !team.readable && !team.reachable));
  assert.ok(expired.sites.every((site) => !site.configurable));
});

test("sessions survive actor changes; reset and ordinary denials are safe", async () => {
  const playground = await createPlayground();
  const before = await playground.view();
  const unknown = await playground.chooseActor("unknown");
  assert.equal(unknown.selectedActorId, before.selectedActorId);
  assert.ok(unknown.message);
  const badHat = await playground.selectHat("unknown");
  assert.equal(badHat.selectedHat?.grantId, before.selectedHat?.grantId);
  await playground.revokeHat();
  const len = before.actors.find((actor) => actor.label === "Len Chu")!;
  await playground.chooseActor(len.id);
  const back = await playground.chooseActor(before.selectedActorId);
  assert.equal((await playground.refresh()).refreshOutcome, "unauthenticated");
  assert.equal(back.selectedHat?.grantId, before.selectedHat?.grantId);
  const reset = await (await createPlayground()).view();
  assert.equal(reset.grants.find((grant) => grant.id === before.selectedHat?.grantId)?.revoked, false);
  await playground.chooseActor(len.id);
  const lenRevoked = await playground.revokeHat();
  assert.equal(lenRevoked.verification, "valid");
  const denied = await playground.revokeHat();
  assert.match(denied.message, /Administrator access failed: not-admitted/);
  const lenRefresh = await playground.refresh();
  assert.equal(lenRefresh.refreshOutcome, "unauthenticated");
  assert.equal(lenRefresh.verification, "valid");
  const lenExpired = await playground.expire();
  assert.equal(lenExpired.now, lenRevoked.expiresAt);
  assert.equal(lenExpired.verification, "expired");
});

test("operation binding, policy and sessions stay distinct for the shared actor", async () => {
  const playground = await createPlayground();
  const professional = await playground.view();
  const festivalId = professional.operations.find((op) => op.id !== professional.operation.id)!.id;
  assert.ok(!professional.actors.some((actor) => actor.label === "Iris Bell"));
  assert.equal(professional.operation.readPolicy, "granted-teams");
  assert.equal(professional.selectedHat?.role, "coordinator");
  assert.ok(professional.teams.filter((team) => team.siteLabel === "East Hall").every((team) => !team.readable));
  const probe = await playground.probeOtherOperation();
  assert.equal(probe.bindingProbe, "wrong-binding");
  assert.equal(probe.verification, "valid");
  assert.deepEqual(probe.teams, professional.teams);
  const admin = professional.hats.find((hat) => hat.role === "admin")!;
  await playground.selectHat(admin.grantId);
  await playground.revokeHat();
  assert.equal((await playground.refresh()).refreshOutcome, "unauthenticated");
  const festival = await playground.chooseOperation(festivalId);
  assert.ok(!festival.actors.some((actor) => actor.label === "Len Chu"));
  assert.equal(festival.selectedActorId, professional.selectedActorId);
  assert.equal(festival.selectedHat?.role, "admin");
  assert.equal(festival.operation.readPolicy, "all-participating");
  assert.equal(festival.bindingProbe, null);
  assert.equal(festival.teams.length, 152);
  const booth = festival.teams.find((team) => team.label === "Tasting booth 001")!;
  assert.equal(booth.readable, true);
  assert.equal(booth.reachable, false);
  assert.deepEqual(booth.actions, []);
  assert.ok(booth.siteId);
  assert.equal((await playground.refresh()).refreshOutcome, "rotated");
  const back = await playground.chooseOperation(professional.operation.id);
  assert.equal(back.selectedHat?.grantId, admin.grantId);
  assert.equal(back.refreshOutcome, "unauthenticated");
  assert.equal(back.grants.find((grant) => grant.id === admin.grantId)?.revoked, true);
  assert.equal(back.verification, "valid");
  assert.equal((await playground.chooseOperation("unknown")).operation.id, professional.operation.id);
});

test("the shared clock ages sessions in both operations", async () => {
  const playground = await createPlayground();
  const professional = await playground.view();
  const festivalId = professional.operations.find((op) => op.id !== professional.operation.id)!.id;
  await playground.chooseOperation(festivalId);
  assert.equal((await playground.expire()).verification, "expired");
  assert.equal((await playground.chooseOperation(professional.operation.id)).verification, "expired");
});


test("operation changes select a local actor when the current actor is absent", async () => {
  const playground = await createPlayground();
  const professional = await playground.view();
  const len = professional.actors.find((actor) => actor.label === "Len Chu")!;
  await playground.chooseActor(len.id);
  const festivalId = professional.operations.find((op) => op.id !== professional.operation.id)!.id;
  const festival = await playground.chooseOperation(festivalId);
  assert.notEqual(festival.selectedActorId, len.id);
  assert.ok(festival.actors.some((actor) => actor.id === festival.selectedActorId));
  assert.equal(festival.verification, "valid");
});

test("festival administrator self-revocation closes refresh and later administration", async () => {
  const playground = await createPlayground();
  const initial = await playground.view();
  const festivalId = initial.operations.find((op) => op.id !== initial.operation.id)!.id;
  const festival = await playground.chooseOperation(festivalId);
  const revoked = await playground.revokeHat();
  assert.equal(revoked.grants.find((grant) => grant.id === festival.selectedHat?.grantId)?.revoked, true);
  assert.equal(revoked.verification, "valid");
  assert.equal((await playground.refresh()).refreshOutcome, "unauthenticated");
  assert.match((await playground.revokeHat()).message, /Administrator access failed: not-admitted/);
  assert.equal((await playground.expire()).verification, "expired");
});
