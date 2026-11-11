import {
  AUTHORITY_INTERFACE_VERSION, DANA_OKAFOR, HARBOR_LOGISTICS, PROFESSIONAL_OPERATION,
  createInMemoryAuthority, epochSeconds, isFailed,
  type RefreshHandle, type SignedAccessEnvelope,
} from "../../dist/authority/index.js";
import { ed25519VerifyKey, verify } from "../../dist/access/index.js";

const fixture = PROFESSIONAL_OPERATION;
const operation = fixture.snapshot.operations[0]!;
const yard = fixture.snapshot.teams.find((team) => team.longName === "Yard crew")!;
const len = fixture.snapshot.actors.find((actor) => actor.displayName === "Len Chu")!;
const newcomerId = "actor-lesson-newcomer";
const provider = "lesson-idp";
const subject = (id: string) => ({ provider, subject: id });
const dana = subject(DANA_OKAFOR);
const newcomer = subject("newcomer");
const competitor = subject("second-claimant");
const version = AUTHORITY_INTERFACE_VERSION;

export async function createActivationLesson() {
  let now = 1_700_000_000;
  let secret: string | null = null;
  let linked = false;
  let usable: boolean | null = null;
  let acceptance: string | null = null;
  let issuance: string | null = null;
  let refreshResult: string | null = null;
  let envelope: SignedAccessEnvelope | null = null;
  let handle: RefreshHandle | null = null;
  let message = "Create a new actor to begin.";
  const events: { action: string; outcome: string }[] = [];
  const record = (action: string, outcome: string) => {
    events.push({ action, outcome });
    if (events.length > 12) events.shift();
  };
  const engine = await createInMemoryAuthority({
    fixtures: [fixture],
    principalLinks: fixture.snapshot.actors.map((actor) => ({ ...subject(actor.actorId), organizationId: actor.organizationId, actorId: actor.actorId })),
    orgAdmins: { [HARBOR_LOGISTICS]: [DANA_OKAFOR] },
    adminRoles: { [operation.operationId]: ["admin"] },
    clock: { now: () => epochSeconds(now) },
    envelopeLifetimeSeconds: 120,
  });
  const material = await engine.verificationKey();
  const key = await ed25519VerifyKey(material.keyId, material.publicKey);
  const keys = new Map([[key.keyId, key]]);
  const freshDana = { kind: "fresh-evidence" as const, evidence: dana, operationId: operation.operationId };
  const snapshot = () => {
    const result = engine.snapshotOf(operation.operationId);
    if (!result) throw new Error("Lesson operation unavailable");
    return result;
  };
  const inspect = async () => {
    if (!secret) return;
    const result = await engine.runtime.activationInspect({ interfaceVersion: version, secret });
    usable = !isFailed(result);
    record("inspect activation", isFailed(result) ? result.failure.kind : "usable");
  };
  const accept = async (evidence: typeof newcomer) => {
    if (!secret) { message = "Request activation before accepting it."; return false; }
    const result = await engine.runtime.activationAccept({ interfaceVersion: version, secret, evidence });
    acceptance = isFailed(result) ? result.failure.kind : result.applied ? "applied" : "replayed";
    record(evidence.subject === newcomer.subject ? "accept activation" : "other subject acceptance", acceptance);
    if (!isFailed(result) && result.applied && evidence.subject === newcomer.subject) linked = true;
    await inspect();
    message = `Activation acceptance: ${acceptance}.`;
    return !isFailed(result);
  };
  const issue = async () => {
    const result = await engine.runtime.accessFromEvidence({ interfaceVersion: version, operationId: operation.operationId, evidence: newcomer });
    issuance = isFailed(result) ? result.failure.kind : "issued";
    record("issue access", issuance);
    if (!isFailed(result)) {
      envelope = result.envelope;
      handle = result.refresh.kind === "rotated" ? result.refresh.handle : result.refresh.kind === "kept" ? handle : null;
    }
    message = `Access issuance: ${issuance}.`;
  };
  const view = async () => {
    const state = snapshot();
    const actor = state.actors.find((candidate) => candidate.organizationId === HARBOR_LOGISTICS && candidate.actorId === newcomerId);
    const grant = state.grants.find((candidate) => candidate.organizationId === HARBOR_LOGISTICS && candidate.actorId === newcomerId && !candidate.revoked);
    const verified = envelope ? await verify(envelope, keys, { now, expectedOperationId: operation.operationId }) : null;
    const access = verified && !isFailed(verified) ? verified.access : null;
    return {
      operationName: operation.longName ?? operation.operationId,
      actor: { id: newcomerId, label: actor?.displayName ?? "New teammate", organization: state.organizations.find((org) => org.organizationId === HARBOR_LOGISTICS)?.longName ?? HARBOR_LOGISTICS, exists: !!actor },
      linked,
      activation: { requested: secret !== null, usable, acceptance },
      grant: { present: !!grant, role: grant?.role ?? "field", targetLabel: yard.longName ?? yard.teamId },
      access: {
        issuance, refresh: refreshResult, verification: !verified ? "none" : isFailed(verified) ? verified.failure.kind : "valid",
        mayObserve: access?.mayAct("observe", { kind: "team", teamId: yard.teamId }) ?? false,
        issuedAt: envelope?.claims.iat ?? null, expiresAt: envelope?.claims.exp ?? null,
      },
      now, message, events: events.map((event) => ({ ...event })),
    };
  };
  return {
    view,
    async createActor() {
      const result = await engine.runtime.command({ interfaceVersion: version, idempotencyKey: "lesson-create-actor", authorization: freshDana, kind: "create-actor", organizationId: HARBOR_LOGISTICS, actorId: newcomerId, displayName: "New teammate" });
      const outcome = result.ok ? result.receipt.applied ? "applied" : "replayed" : result.failure.kind;
      record("create actor", outcome);
      if (result.ok) await issue(); else message = `Create actor: ${outcome}.`;
      return view();
    },
    async activate() {
      if (!secret) {
        const result = await engine.runtime.activationRequest({ interfaceVersion: version, organizationId: HARBOR_LOGISTICS, actorId: newcomerId, evidence: dana });
        if (isFailed(result)) { record("request activation", result.failure.kind); message = `Activation request: ${result.failure.kind}.`; return view(); }
        secret = result.secret;
        record("request activation", "requested");
        await inspect();
      }
      if (await accept(newcomer)) await issue();
      return view();
    },
    async grantHat() {
      const admin = await engine.runtime.accessFromEvidence({ interfaceVersion: version, operationId: operation.operationId, evidence: subject(len.actorId) });
      record("issue administrator access", isFailed(admin) ? admin.failure.kind : "issued");
      if (isFailed(admin)) { message = `Administrator access: ${admin.failure.kind}.`; return view(); }
      const result = await engine.runtime.command({ interfaceVersion: version, idempotencyKey: "lesson-grant-hat", authorization: { kind: "access-envelope", envelope: admin.envelope }, kind: "grant-hat", operationId: operation.operationId, organizationId: HARBOR_LOGISTICS, actorId: newcomerId, role: "field", target: { kind: "team", teamId: yard.teamId }, primary: true });
      const outcome = result.ok ? result.receipt.applied ? "applied" : "replayed" : result.failure.kind;
      record("grant hat", outcome);
      if (result.ok) await issue(); else message = `Grant hat: ${outcome}.`;
      return view();
    },
    async tryAccess() { await issue(); return view(); },
    async replay() { await accept(newcomer); return view(); },
    async tryOtherSubject() { await accept(competitor); return view(); },
    async unlink() {
      const result = await engine.runtime.command({ interfaceVersion: version, idempotencyKey: "lesson-unlink", authorization: freshDana, kind: "unlink-principal", organizationId: HARBOR_LOGISTICS, actorId: newcomerId });
      const outcome = result.ok ? result.receipt.applied ? "applied" : "replayed" : result.failure.kind;
      record("unlink principal", outcome);
      if (result.ok && result.receipt.applied) linked = false;
      message = `Unlink principal: ${outcome}.`;
      return view();
    },
    async refresh() {
      if (!handle) { message = "No refresh handle is available."; return view(); }
      const result = await engine.runtime.refresh({ interfaceVersion: version, operationId: operation.operationId, handle });
      refreshResult = isFailed(result) ? result.failure.kind : result.refresh.kind;
      record("refresh access", refreshResult);
      if (!isFailed(result)) {
        envelope = result.envelope;
        handle = result.refresh.kind === "rotated" ? result.refresh.handle : result.refresh.kind === "kept" ? handle : null;
      }
      message = `Refresh: ${refreshResult}.`;
      return view();
    },
    async expire() {
      if (envelope) { now = Math.max(now, envelope.claims.exp); message = "Clock advanced to envelope expiry."; }
      else message = "No envelope to expire.";
      return view();
    },
  };
}
