import test from "node:test";
import assert from "node:assert/strict";
import { createActivationLesson } from "../examples/playground/activation-model.ts";

test("actor, activation, grant, replay, unlink and expiry use distinct authority transitions", async () => {
  const lesson = await createActivationLesson();
  const initial = await lesson.view();
  assert.equal(initial.actor.exists, false);
  assert.equal(initial.linked, false);
  assert.equal(initial.grant.present, false);
  assert.equal(initial.access.verification, "none");
  const created = await lesson.createActor();
  assert.equal(created.actor.exists, true);
  assert.equal(created.linked, false);
  assert.equal(created.grant.present, false);
  assert.equal(created.access.issuance, "unauthenticated");
  const activated = await lesson.activate();
  assert.equal(activated.linked, true);
  assert.equal(activated.activation.requested, true);
  assert.equal(activated.activation.usable, false);
  assert.equal(activated.activation.acceptance, "applied");
  assert.equal(activated.grant.present, false);
  assert.equal(activated.access.issuance, "not-admitted");
  const granted = await lesson.grantHat();
  assert.equal(granted.grant.present, true);
  assert.equal(granted.access.issuance, "issued");
  assert.equal(granted.access.verification, "valid");
  assert.equal(granted.access.mayObserve, true);
  const replay = await lesson.replay();
  assert.equal(replay.activation.acceptance, "replayed");
  assert.deepEqual(replay.access, granted.access);
  const other = await lesson.tryOtherSubject();
  assert.equal(other.activation.acceptance, "unauthenticated");
  assert.deepEqual(other.access, granted.access);
  const unlinked = await lesson.unlink();
  assert.equal(unlinked.linked, false);
  assert.equal(unlinked.actor.exists, true);
  assert.equal(unlinked.grant.present, true);
  assert.equal(unlinked.access.verification, "valid");
  assert.equal((await lesson.refresh()).access.refresh, "unauthenticated");
  const denied = await lesson.tryAccess();
  assert.equal(denied.access.issuance, "unauthenticated");
  assert.equal(denied.access.verification, "valid");
  const expired = await lesson.expire();
  assert.equal(expired.now, granted.access.expiresAt);
  assert.equal(expired.access.verification, "expired");
  assert.equal(expired.access.mayObserve, false);
  for (const value of [initial, created, activated, granted, replay, other, unlinked, denied, expired]) {
    assert.doesNotMatch(JSON.stringify(value), /"secret"|"handle"/i);
    assert.ok(value.events.length <= 12);
  }
  const reset = await (await createActivationLesson()).view();
  assert.equal(reset.actor.exists, false);
  assert.equal(reset.access.verification, "none");
});

test("out of order operations and repeated commands return normal outcomes", async () => {
  const lesson = await createActivationLesson();
  for (const action of [lesson.replay, lesson.tryOtherSubject, lesson.refresh, lesson.expire, lesson.activate, lesson.grantHat, lesson.unlink]) {
    const result = await action();
    assert.ok(result.message);
    assert.equal(result.access.verification, "none");
  }
  await lesson.createActor();
  const repeated = await lesson.createActor();
  assert.equal(repeated.actor.exists, true);
  await lesson.activate();
  await lesson.grantHat();
  const again = await lesson.grantHat();
  assert.equal(again.grant.present, true);
});

test("a known actor can receive a hat before linking a principal", async () => {
  const lesson = await createActivationLesson();
  await lesson.createActor();
  const granted = await lesson.grantHat();
  assert.equal(granted.grant.present, true);
  assert.equal(granted.linked, false);
  assert.equal(granted.access.issuance, "unauthenticated");
  const activated = await lesson.activate();
  assert.equal(activated.linked, true);
  assert.equal(activated.access.issuance, "issued");
  assert.equal(activated.access.mayObserve, true);
});
