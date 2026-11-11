import {
  AUTHORITY_INTERFACE_VERSION, DANA_OKAFOR, HARBOR_LOGISTICS, PROFESSIONAL_OPERATION, FESTIVAL,
  createInMemoryAuthority, epochSeconds, isFailed,
  type AccessIssue, type RefreshHandle, type SignedAccessEnvelope,
} from "../../dist/authority/index.js";
import { ed25519VerifyKey, verify } from "../../dist/access/index.js";

const fixtures = [PROFESSIONAL_OPERATION, FESTIVAL];
const west = PROFESSIONAL_OPERATION.snapshot.sites.find((site) => site.longName === "West Yard")!;
const len = PROFESSIONAL_OPERATION.snapshot.actors.find((actor) => actor.displayName === "Len Chu")!;
const provider = "playground";
const evidence = (organizationId: string, actorId: string) => ({ provider, subject: JSON.stringify([organizationId, actorId]) });
const version = AUTHORITY_INTERFACE_VERSION;

type Session = { envelope: SignedAccessEnvelope; handle: RefreshHandle | null; grantId: string | null; refreshOutcome: string | null };

export async function createPlayground() {
  let now = 1_700_000_000;
  let serial = 0;
  let fixture = PROFESSIONAL_OPERATION;
  let operation = fixture.snapshot.operations[0]!;
  let selectedActorId: string = DANA_OKAFOR;
  let bindingProbe: string | null = null;
  let message = "Dana has an extra West Yard admin grant for this demonstration.";
  let missingRefreshOutcome: string | null = null;
  const actor = (actorId: string) => fixture.snapshot.actors.find((candidate) => candidate.actorId === actorId)!;
  const actorEvidence = (actorId: string) => evidence(actor(actorId).organizationId, actorId);
  const sessionKey = (actorId: string) => JSON.stringify([operation.operationId, actor(actorId).organizationId, actorId]);
  const currentSession = () => sessions.get(sessionKey(selectedActorId));
  const links = new Map(fixtures.flatMap((world) => world.snapshot.actors).map((person) => {
    const principal = evidence(person.organizationId, person.actorId);
    return [principal.subject, { ...principal, organizationId: person.organizationId, actorId: person.actorId }] as const;
  }));
  const sessions = new Map<string, Session>();
  const engine = await createInMemoryAuthority({
    fixtures,
    principalLinks: [...links.values()],
    clock: { now: () => epochSeconds(now) },
    envelopeLifetimeSeconds: 120,
    adminRoles: Object.fromEntries(fixtures.map((world) => [world.snapshot.operations[0]!.operationId, ["admin"]])),
  });
  const keyMaterial = await engine.verificationKey();
  const key = await ed25519VerifyKey(keyMaterial.keyId, keyMaterial.publicKey);
  const keys = new Map([[key.keyId, key]]);
  const commandId = () => `playground-${++serial}`;
  const adminIssue = async () => engine.runtime.accessFromEvidence({ interfaceVersion: version, operationId: operation.operationId, evidence: fixture === PROFESSIONAL_OPERATION ? evidence(len.organizationId, len.actorId) : actorEvidence(DANA_OKAFOR) });
  const initialAdmin = await adminIssue();
  if (isFailed(initialAdmin)) throw new Error(`Playground administrator unavailable: ${initialAdmin.failure.kind}`);
  const added = await engine.runtime.command({
    interfaceVersion: version, idempotencyKey: commandId(),
    authorization: { kind: "access-envelope", envelope: initialAdmin.envelope },
    kind: "grant-hat", operationId: operation.operationId, organizationId: HARBOR_LOGISTICS,
    actorId: DANA_OKAFOR, role: "admin", target: { kind: "site", siteId: west.siteId },
  });
  if (!added.ok) throw new Error(`Playground setup failed: ${added.failure.kind}`);
  const snapshot = () => {
    const result = engine.snapshotOf(operation.operationId);
    if (!result) throw new Error("Playground operation is unavailable");
    return result;
  };
  const saveIssue = async (actorId: string, issue: AccessIssue, oldHandle: RefreshHandle | null = null) => {
    const context = await engine.runtime.context({ interfaceVersion: version, envelope: issue.envelope });
    const handle = issue.refresh.kind === "rotated" ? issue.refresh.handle : issue.refresh.kind === "kept" ? oldHandle : null;
    sessions.set(sessionKey(actorId), { envelope: issue.envelope, handle, grantId: isFailed(context) ? null : context.selectedHat?.grantId ?? null, refreshOutcome: issue.refresh.kind });
    if (isFailed(context)) { message = `Hat context failed: ${context.failure.kind}.`; return false; }
    if (!context.selectedHat) { message = "The issued hat has no current context."; return false; }
    return true;
  };
  const issue = async (actorId: string) => {
    const result = await engine.runtime.accessFromEvidence({ interfaceVersion: version, operationId: operation.operationId, evidence: actorEvidence(actorId) });
    if (isFailed(result)) { message = `Access issuance failed: ${result.failure.kind}.`; return; }
    await saveIssue(actorId, result);
  };
  await issue(selectedActorId);
  const refreshSession = async () => {
    const session = currentSession();
    if (!session?.handle) { if (session) session.refreshOutcome = "unauthenticated"; else missingRefreshOutcome = "unauthenticated"; message = "No refresh handle is available."; return; }
    const result = await engine.runtime.refresh({ interfaceVersion: version, operationId: operation.operationId, handle: session.handle });
    if (isFailed(result)) { session.refreshOutcome = result.failure.kind; message = `Refresh failed: ${result.failure.kind}.`; return; }
    if (await saveIssue(selectedActorId, result, session.handle)) message = "Refresh issued a new envelope.";
  };
  const view = async () => {
    const state = snapshot();
    const session = currentSession();
    const verified = session ? await verify(session.envelope, keys, { now, expectedOperationId: operation.operationId }) : null;
    const access = verified && !isFailed(verified) ? verified.access : null;
    const verification = !verified ? "unauthenticated" : isFailed(verified) ? verified.failure.kind : "valid";
    const targetLabel = (target: typeof state.grants[number]["target"]) => target.kind === "site"
      ? state.sites.find((site) => site.siteId === target.siteId)?.longName ?? target.siteId
      : state.teams.find((team) => team.teamId === target.teamId)?.longName ?? target.teamId;
    const hat = (grant: typeof state.grants[number]) => ({ grantId: grant.grantId, role: grant.role, targetLabel: targetLabel(grant.target) });
    const worn = state.grants.find((grant) => grant.grantId === session?.grantId);
    return {
      operations: fixtures.map((world) => ({ id: world.snapshot.operations[0]!.operationId, name: world.snapshot.operations[0]!.longName ?? world.snapshot.operations[0]!.operationId })),
      operation: { id: operation.operationId, name: operation.longName ?? operation.operationId, readPolicy: fixture.policy.readPolicy.organizations },
      actors: state.actors.filter((actor) => fixture.snapshot.actors.some((candidate) => candidate.actorId === actor.actorId && candidate.organizationId === actor.organizationId)).map((actor) => ({ id: actor.actorId, label: actor.displayName ?? actor.actorId, organization: state.organizations.find((org) => org.organizationId === actor.organizationId)?.longName ?? actor.organizationId })),
      selectedActorId, now, issuedAt: session?.envelope.claims.iat ?? null, expiresAt: session?.envelope.claims.exp ?? null,
      verification, refreshOutcome: session?.refreshOutcome ?? missingRefreshOutcome, bindingProbe, selectedHat: worn ? hat(worn) : null,
      hats: state.grants.filter((grant) => grant.actorId === selectedActorId && !grant.revoked).map(hat),
      sites: state.sites.map((site) => ({ id: site.siteId, label: site.longName ?? site.siteId, configurable: access?.mayConfigure(site.siteId) ?? false })),
      teams: state.teams.map((team) => ({
        id: team.teamId, siteId: team.siteId, label: team.longName ?? team.teamId,
        siteLabel: state.sites.find((site) => site.siteId === team.siteId)?.longName ?? team.siteId,
        organizationLabel: state.organizations.find((org) => org.organizationId === team.organizationId)?.longName ?? team.organizationId,
        actions: fixture.policy.actions.filter((action) => access?.mayAct(action, { kind: "team", teamId: team.teamId }) ?? false),
        readable: access ? access.readableOrganizationIds().includes(team.organizationId) || access.readableTeamIds().includes(team.teamId) : false,
        reachable: access?.teamReach().includes(team.teamId) ?? false,
      })),
      grants: state.grants.map((grant) => ({ id: grant.grantId, actorLabel: state.actors.find((actor) => actor.actorId === grant.actorId)?.displayName ?? grant.actorId, role: grant.role, targetLabel: targetLabel(grant.target), revoked: grant.revoked ?? false, primary: grant.primary ?? false })),
      message,
    };
  };
  return {
    view,
    async chooseActor(actorId: string) {
      if (!fixture.snapshot.actors.some((actor) => actor.actorId === actorId)) { message = "Unknown actor."; return view(); }
      selectedActorId = actorId;
      missingRefreshOutcome = null;
      bindingProbe = null;
      message = "Actor selected.";
      if (!sessions.has(sessionKey(actorId))) await issue(actorId);
      return view();
    },
    async chooseOperation(operationId: string) {
      const next = fixtures.find((world) => world.snapshot.operations[0]!.operationId === operationId);
      if (!next) { message = "Unknown operation."; return view(); }
      const previousActor = actor(selectedActorId);
      fixture = next;
      operation = next.snapshot.operations[0]!;
      const retained = fixture.snapshot.actors.find((candidate) => candidate.actorId === previousActor.actorId && candidate.organizationId === previousActor.organizationId);
      selectedActorId = (retained ?? fixture.snapshot.actors[0]!).actorId;
      bindingProbe = null;
      missingRefreshOutcome = null;
      message = "Operation selected.";
      if (!currentSession()) await issue(selectedActorId);
      return view();
    },
    async probeOtherOperation() {
      const session = currentSession();
      if (!session) { bindingProbe = null; message = "No envelope to verify."; return view(); }
      const other = fixtures.find((world) => world !== fixture)!;
      const result = await verify(session.envelope, keys, { now, expectedOperationId: other.snapshot.operations[0]!.operationId });
      bindingProbe = isFailed(result) ? result.failure.kind : "valid";
      message = `Other-operation verification: ${bindingProbe}.`;
      return view();
    },
    async selectHat(grantId: string) {
      const result = await engine.runtime.command({ interfaceVersion: version, idempotencyKey: commandId(), authorization: { kind: "fresh-evidence", evidence: actorEvidence(selectedActorId), operationId: operation.operationId }, kind: "select-hat", operationId: operation.operationId, grantId });
      if (!result.ok) message = `Hat selection failed: ${result.failure.kind}.`;
      else await refreshSession();
      return view();
    },
    async revokeHat() {
      const grantId = currentSession()?.grantId;
      if (!grantId) { message = "No issued hat to revoke."; return view(); }
      const admin = await adminIssue();
      if (isFailed(admin)) { message = `Administrator access failed: ${admin.failure.kind}.`; return view(); }
      const result = await engine.runtime.command({ interfaceVersion: version, idempotencyKey: commandId(), authorization: { kind: "access-envelope", envelope: admin.envelope }, kind: "revoke-grant", operationId: operation.operationId, grantId });
      message = result.ok ? "Grant revoked; the issued envelope remains valid until expiry." : `Revocation failed: ${result.failure.kind}.`;
      return view();
    },
    async refresh() { await refreshSession(); return view(); },
    async expire() {
      const session = currentSession();
      if (session) { now = Math.max(now, session.envelope.claims.exp); message = "Clock advanced to envelope expiry across both operations."; }
      else message = "No envelope to expire.";
      return view();
    },
  };
}
