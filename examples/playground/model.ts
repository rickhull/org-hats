import {
  AUTHORITY_INTERFACE_VERSION, DANA_OKAFOR, HARBOR_LOGISTICS, PROFESSIONAL_OPERATION,
  createInMemoryAuthority, epochSeconds, isFailed,
  type AccessIssue, type RefreshHandle, type SignedAccessEnvelope,
} from "../../dist/authority/index.js";
import { ed25519VerifyKey, verify } from "../../dist/access/index.js";

const fixture = PROFESSIONAL_OPERATION;
const operation = fixture.snapshot.operations[0]!;
const west = fixture.snapshot.sites.find((site) => site.displayName === "West Yard")!;
const len = fixture.snapshot.actors.find((actor) => actor.displayName === "Len Chu")!;
const provider = "playground";
const evidence = (actorId: string) => ({ provider, subject: actorId });
const version = AUTHORITY_INTERFACE_VERSION;

type Session = { envelope: SignedAccessEnvelope; handle: RefreshHandle | null; grantId: string | null };

export async function createPlayground() {
  let now = 1_700_000_000;
  let serial = 0;
  let selectedActorId: string = DANA_OKAFOR;
  let message = "Dana has an extra West Yard admin grant for this demonstration.";
  let refreshOutcome: string | null = null;
  const sessions = new Map<string, Session>();
  const engine = await createInMemoryAuthority({
    fixtures: [fixture],
    principalLinks: fixture.snapshot.actors.map((actor) => ({ provider, subject: actor.actorId, organizationId: actor.organizationId, actorId: actor.actorId })),
    clock: { now: () => epochSeconds(now) },
    envelopeLifetimeSeconds: 120,
    adminRoles: { [operation.operationId]: ["admin"] },
  });
  const keyMaterial = await engine.verificationKey();
  const key = await ed25519VerifyKey(keyMaterial.keyId, keyMaterial.publicKey);
  const keys = new Map([[key.keyId, key]]);
  const commandId = () => `playground-${++serial}`;
  const adminIssue = async () => engine.runtime.accessFromEvidence({ interfaceVersion: version, operationId: operation.operationId, evidence: evidence(len.actorId) });
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
    sessions.set(actorId, { envelope: issue.envelope, handle, grantId: isFailed(context) ? null : context.selectedHat?.grantId ?? null });
    refreshOutcome = issue.refresh.kind;
    if (isFailed(context)) { message = `Hat context failed: ${context.failure.kind}.`; return false; }
    if (!context.selectedHat) { message = "The issued hat has no current context."; return false; }
    return true;
  };
  const issue = async (actorId: string) => {
    const result = await engine.runtime.accessFromEvidence({ interfaceVersion: version, operationId: operation.operationId, evidence: evidence(actorId) });
    if (isFailed(result)) { message = `Access issuance failed: ${result.failure.kind}.`; return; }
    await saveIssue(actorId, result);
  };
  await issue(selectedActorId);
  const refreshSession = async () => {
    const session = sessions.get(selectedActorId);
    if (!session?.handle) { refreshOutcome = "unauthenticated"; message = "No refresh handle is available."; return; }
    const result = await engine.runtime.refresh({ interfaceVersion: version, operationId: operation.operationId, handle: session.handle });
    if (isFailed(result)) { refreshOutcome = result.failure.kind; message = `Refresh failed: ${result.failure.kind}.`; return; }
    if (await saveIssue(selectedActorId, result, session.handle)) message = "Refresh issued a new envelope.";
  };
  const view = async () => {
    const state = snapshot();
    const session = sessions.get(selectedActorId);
    const verified = session ? await verify(session.envelope, keys, { now, expectedOperationId: operation.operationId }) : null;
    const access = verified && !isFailed(verified) ? verified.access : null;
    const verification = !verified ? "unauthenticated" : isFailed(verified) ? verified.failure.kind : "valid";
    const targetLabel = (target: typeof state.grants[number]["target"]) => target.kind === "site"
      ? state.sites.find((site) => site.siteId === target.siteId)?.displayName ?? target.siteId
      : state.teams.find((team) => team.teamId === target.teamId)?.displayName ?? target.teamId;
    const hat = (grant: typeof state.grants[number]) => ({ grantId: grant.grantId, role: grant.role, targetLabel: targetLabel(grant.target) });
    const worn = state.grants.find((grant) => grant.grantId === session?.grantId);
    return {
      operation: { id: operation.operationId, name: operation.displayName ?? operation.operationId },
      actors: state.actors.map((actor) => ({ id: actor.actorId, label: actor.displayName ?? actor.actorId, organization: state.organizations.find((org) => org.organizationId === actor.organizationId)?.displayName ?? actor.organizationId })),
      selectedActorId, now, issuedAt: session?.envelope.claims.iat ?? null, expiresAt: session?.envelope.claims.exp ?? null,
      verification, refreshOutcome, selectedHat: worn ? hat(worn) : null,
      hats: state.grants.filter((grant) => grant.actorId === selectedActorId && !grant.revoked).map(hat),
      sites: state.sites.map((site) => ({ id: site.siteId, label: site.displayName ?? site.siteId, configurable: access?.mayConfigure(site.siteId) ?? false })),
      teams: state.teams.map((team) => ({
        id: team.teamId, label: team.displayName ?? team.teamId,
        siteLabel: state.sites.find((site) => site.siteId === team.siteId)?.displayName ?? team.siteId,
        organizationLabel: state.organizations.find((org) => org.organizationId === team.organizationId)?.displayName ?? team.organizationId,
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
      refreshOutcome = null;
      message = "Actor selected.";
      if (!sessions.has(actorId)) await issue(actorId);
      return view();
    },
    async selectHat(grantId: string) {
      const result = await engine.runtime.command({ interfaceVersion: version, idempotencyKey: commandId(), authorization: { kind: "fresh-evidence", evidence: evidence(selectedActorId), operationId: operation.operationId }, kind: "select-hat", operationId: operation.operationId, grantId });
      if (!result.ok) message = `Hat selection failed: ${result.failure.kind}.`;
      else await refreshSession();
      return view();
    },
    async revokeHat() {
      const grantId = sessions.get(selectedActorId)?.grantId;
      if (!grantId) { message = "No issued hat to revoke."; return view(); }
      const admin = await adminIssue();
      if (isFailed(admin)) { message = `Administrator access failed: ${admin.failure.kind}.`; return view(); }
      const result = await engine.runtime.command({ interfaceVersion: version, idempotencyKey: commandId(), authorization: { kind: "access-envelope", envelope: admin.envelope }, kind: "revoke-grant", operationId: operation.operationId, grantId });
      message = result.ok ? "Grant revoked; the issued envelope remains valid until expiry." : `Revocation failed: ${result.failure.kind}.`;
      return view();
    },
    async refresh() { await refreshSession(); return view(); },
    async expire() {
      const session = sessions.get(selectedActorId);
      if (session) { now = Math.max(now, session.envelope.claims.exp); message = "Clock advanced to envelope expiry."; }
      else message = "No envelope to expire.";
      return view();
    },
  };
}
