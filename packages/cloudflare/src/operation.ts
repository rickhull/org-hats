import { DurableObject } from "cloudflare:workers";
import {
  ACCESS_ENVELOPE_VERSION,
  AUTHORITY_INTERFACE_VERSION,
  actionsOf,
  canonicalJson,
  validatePolicyBundle,
  type AccessEnvelopeClaimsV1,
  type FailureKind,
  type HatSummary,
  type JsonValue,
  type PolicyBundle,
  type RefreshHandleOutcome,
  type SiteBinding,
} from "org-hats/authority";
import {
  readReach,
  wearableGrants,
  type Grant,
  type Snapshot,
} from "org-hats";
import type { Env } from "./env";
import {
  operationTables,
  readTables,
  restoreTables,
  type ExportSnapshot,
  type StateRow,
} from "./state";

/** One operation authority. The object owns operation-local facts: sites,
 * teams, grants, participation, policy, refresh records, audit, claims, and
 * the outbox that carries invitations to organization authority. */
const SCHEMA_VERSION = "2";

type Row = Record<string, string | number | null>;

type Failure = { readonly kind: FailureKind; readonly detail?: string };

type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: Failure };

const now = (): number => Math.floor(Date.now() / 1000);

const failure = (kind: FailureKind, detail?: string): { readonly ok: false; readonly failure: Failure } => ({
  ok: false,
  failure: { kind, ...(detail !== undefined ? { detail } : {}) },
});

const value = <T>(result: T): { readonly ok: true; readonly value: T } => ({ ok: true, value: result });

const payloadOf = (input: Record<string, unknown>): string =>
  canonicalJson(input as unknown as JsonValue);

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const asRecord = (input: unknown): Record<string, unknown> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("the request body must be a JSON object");
  }
  return input as Record<string, unknown>;
};

const asString = (input: unknown, field: string): string => {
  if (typeof input !== "string" || input.length === 0) throw new Error(`${field} must be a non-empty string`);
  return input;
};

const asArray = (input: unknown, field: string): unknown[] => {
  if (!Array.isArray(input)) throw new Error(`${field} must be an array`);
  return input;
};

interface SiteInput {
  readonly siteId: string;
  readonly displayName?: string;
  readonly aliases: readonly string[];
}

interface TeamInput {
  readonly teamId: string;
  readonly siteId: string;
  readonly organizationId: string;
  readonly displayName?: string;
}

interface GrantInput {
  readonly grantId: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly role: string;
  readonly teamId?: string;
  readonly siteId?: string;
  readonly primary?: boolean;
  readonly revoked?: boolean;
}

interface ParticipationInput {
  readonly organizationId: string;
  readonly status: "invited" | "accepted" | "active" | "revoked";
}

interface BootstrapInput {
  readonly operationId: string;
  readonly displayName?: string;
  readonly bounded?: boolean;
  readonly policy: PolicyBundle;
  readonly adminRoles?: readonly string[];
  readonly configureActions?: readonly string[];
  readonly envelopeLifetimeSeconds?: number;
  readonly sites: readonly SiteInput[];
  readonly teams: readonly TeamInput[];
  readonly grants: readonly GrantInput[];
  readonly participations: readonly ParticipationInput[];
}

interface InviteInput {
  readonly invitationId?: string;
  readonly organizationId: string;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

interface IntakeMessage {
  readonly messageId: string;
  readonly kind: string;
  readonly invitationId?: string;
  readonly organizationId?: string;
  readonly operationId?: string;
  readonly actorId?: string;
}

interface GrantCommand {
  readonly grantId?: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly role: string;
  readonly teamId?: string;
  readonly siteId?: string;
  readonly primary?: boolean;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

interface RevokeGrantCommand {
  readonly grantId: string;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

interface SelectHatCommand {
  readonly grantId: string;
  readonly actorId: string;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

interface AccessRequestCommand {
  readonly requestId?: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly note?: string;
  readonly idempotencyKey: string;
}

interface AdmitCommand {
  readonly organizationId: string;
  readonly actorId: string;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

/** How and when the principal authenticated, as the issuing evidence
 * stated it. Opaque to authority: stored with the refresh record, re-issued
 * on every refresh of its chain, never interpreted. */
interface AuthenticationFacts {
  readonly amr?: readonly string[];
  readonly authTime?: number;
}

export class OperationAuthority extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.initialize();
  }

  private initialize(): void {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    sql.exec(
      `CREATE TABLE IF NOT EXISTS operation (
        operation_id TEXT PRIMARY KEY,
        display_name TEXT,
        bounded INTEGER NOT NULL DEFAULT 0,
        policy_json TEXT NOT NULL,
        admin_roles_json TEXT NOT NULL,
        configure_actions_json TEXT NOT NULL,
        envelope_lifetime_seconds INTEGER NOT NULL DEFAULT 900,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS sites (
        site_id TEXT PRIMARY KEY,
        display_name TEXT,
        aliases_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS teams (
        team_id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        display_name TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS participations (
        organization_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('invited', 'accepted', 'active', 'revoked')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS invitations (
        invitation_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('invited', 'accepted', 'active', 'revoked')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS grants (
        grant_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        role TEXT NOT NULL,
        target_kind TEXT NOT NULL CHECK (target_kind IN ('team', 'site')),
        team_id TEXT,
        site_id TEXT,
        is_primary INTEGER NOT NULL DEFAULT 0,
        revoked INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS refresh_records (
        handle_hash TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0,
        superseded INTEGER NOT NULL DEFAULT 0,
        amr_json TEXT,
        auth_time INTEGER,
        created_at INTEGER NOT NULL
      )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS access_requests (
        request_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        note TEXT,
        created_at INTEGER NOT NULL
      )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS audit (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        actor TEXT NOT NULL,
        fact TEXT NOT NULL
      )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS claims (
        idempotency_key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        target TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER
      )`,
    );
    sql.exec("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)", SCHEMA_VERSION);
    // additive migration: an object created before schema 2 lacks the
    // authentication columns on refresh_records
    const refreshColumns = new Set(
      this.ctx.storage.sql.exec<{ readonly name: string }>("PRAGMA table_info(refresh_records)")
        .toArray()
        .map((column) => String(column.name)),
    );
    if (!refreshColumns.has("amr_json")) sql.exec("ALTER TABLE refresh_records ADD COLUMN amr_json TEXT");
    if (!refreshColumns.has("auth_time")) sql.exec("ALTER TABLE refresh_records ADD COLUMN auth_time INTEGER");
  }

  private rows(query: string, ...bindings: (string | number | null)[]): Row[] {
    return this.ctx.storage.sql.exec<Row>(query, ...bindings).toArray();
  }

  private one(query: string, ...bindings: (string | number | null)[]): Row | undefined {
    return this.rows(query, ...bindings)[0];
  }

  private operationId(): string | undefined {
    const row = this.one("SELECT operation_id FROM operation LIMIT 1");
    return row === undefined ? undefined : String(row["operation_id"]);
  }

  private policy(): PolicyBundle | undefined {
    const row = this.one("SELECT policy_json FROM operation LIMIT 1");
    if (row === undefined) return undefined;
    return JSON.parse(String(row["policy_json"])) as PolicyBundle;
  }

  private adminRoles(): readonly string[] {
    const row = this.one("SELECT admin_roles_json FROM operation LIMIT 1");
    return row === undefined ? [] : (JSON.parse(String(row["admin_roles_json"])) as string[]);
  }

  private audit(actor: string, fact: string, at: number): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO audit (at, actor, fact) VALUES (?, ?, ?)",
      at,
      actor,
      fact,
    );
  }

  private claim(key: string, payload: string, at: number): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO claims (idempotency_key, payload, created_at) VALUES (?, ?, ?)",
      key,
      payload,
      at,
    );
  }

  private replay(key: string, payload: string): Result<{ applied: boolean }> | undefined {
    const existing = this.one("SELECT payload FROM claims WHERE idempotency_key = ?", key);
    if (existing === undefined) return undefined;
    if (String(existing["payload"]) !== payload) {
      return failure("invalid-command", "idempotency key reused with a different payload");
    }
    return value({ applied: false });
  }

  private outbox(kind: string, target: string, payload: Record<string, unknown>, at: number): string {
    const id = `ob-${crypto.randomUUID()}`;
    this.ctx.storage.sql.exec(
      "INSERT INTO outbox (id, kind, target, payload, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      kind,
      target,
      payloadOf(payload),
      at,
    );
    return id;
  }

  private revokeRefreshRecords(organizationId: string, actorId: string): void {
    this.ctx.storage.sql.exec(
      "UPDATE refresh_records SET revoked = 1 WHERE organization_id = ? AND actor_id = ?",
      organizationId,
      actorId,
    );
  }

  private bootstrap(input: BootstrapInput): Result<{ operationId: string }> {
    const problems = validatePolicyBundle(input.policy);
    if (problems.length > 0) return failure("invalid-command", problems.join("; "));
    const at = now();
    return this.ctx.storage.transactionSync(() => {
      const existing = this.one("SELECT 1 AS present FROM operation WHERE operation_id = ?", input.operationId);
      this.ctx.storage.sql.exec(
        `INSERT INTO operation
          (operation_id, display_name, bounded, policy_json, admin_roles_json, configure_actions_json, envelope_lifetime_seconds, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(operation_id) DO UPDATE SET
           display_name = excluded.display_name,
           bounded = excluded.bounded,
           policy_json = excluded.policy_json,
           admin_roles_json = excluded.admin_roles_json,
           configure_actions_json = excluded.configure_actions_json,
           envelope_lifetime_seconds = excluded.envelope_lifetime_seconds,
           updated_at = excluded.updated_at`,
        input.operationId,
        input.displayName ?? null,
        input.bounded === true ? 1 : 0,
        canonicalJson(input.policy as unknown as JsonValue),
        canonicalJson((input.adminRoles ?? []) as unknown as JsonValue),
        canonicalJson((input.configureActions ?? ["configure"]) as unknown as JsonValue),
        input.envelopeLifetimeSeconds ?? 900,
        at,
        at,
      );
      for (const site of input.sites) {
        this.ctx.storage.sql.exec(
          `INSERT INTO sites (site_id, display_name, aliases_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(site_id) DO UPDATE SET
             display_name = excluded.display_name,
             aliases_json = excluded.aliases_json,
             updated_at = excluded.updated_at`,
          site.siteId,
          site.displayName ?? null,
          canonicalJson(site.aliases as unknown as JsonValue),
          at,
          at,
        );
      }
      for (const team of input.teams) {
        this.ctx.storage.sql.exec(
          `INSERT INTO teams (team_id, site_id, organization_id, display_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(team_id) DO UPDATE SET
             site_id = excluded.site_id,
             organization_id = excluded.organization_id,
             display_name = excluded.display_name,
             updated_at = excluded.updated_at`,
          team.teamId,
          team.siteId,
          team.organizationId,
          team.displayName ?? null,
          at,
          at,
        );
      }
      for (const grant of input.grants) {
        this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO grants
            (grant_id, organization_id, actor_id, role, target_kind, team_id, site_id, is_primary, revoked, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          grant.grantId,
          grant.organizationId,
          grant.actorId,
          grant.role,
          grant.teamId === undefined ? "site" : "team",
          grant.teamId ?? null,
          grant.siteId ?? null,
          grant.primary === true ? 1 : 0,
          grant.revoked === true ? 1 : 0,
          at,
          at,
        );
      }
      for (const participation of input.participations) {
        this.ctx.storage.sql.exec(
          `INSERT INTO participations (organization_id, status, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(organization_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
          participation.organizationId,
          participation.status,
          at,
          at,
        );
      }
      if (existing === undefined) this.audit("bootstrap", `operation ${input.operationId} bootstrapped`, at);
      return value({ operationId: input.operationId });
    });
  }

  private invite(input: InviteInput): Result<{ applied: boolean; invitationId?: string }> {
    const at = now();
    const invitationId = input.invitationId ?? `inv-${crypto.randomUUID()}`;
    const payload = payloadOf({
      kind: "participation-invite",
      invitationId: input.invitationId ?? null,
      organizationId: input.organizationId,
      byActorId: input.byActorId,
    });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      const existing = this.one("SELECT status FROM participations WHERE organization_id = ?", input.organizationId);
      if (existing !== undefined && String(existing["status"]) !== "revoked") {
        return failure("denied", "the organization is already participating");
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO invitations (invitation_id, organization_id, status, created_at, updated_at)
         VALUES (?, ?, 'invited', ?, ?)`,
        invitationId,
        input.organizationId,
        at,
        at,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO participations (organization_id, status, created_at, updated_at)
         VALUES (?, 'invited', ?, ?)
         ON CONFLICT(organization_id) DO UPDATE SET status = 'invited', updated_at = excluded.updated_at`,
        input.organizationId,
        at,
        at,
      );
      this.outbox(
        "invitation",
        input.organizationId,
        {
          kind: "invitation",
          invitationId,
          operationId: this.operationId(),
          organizationId: input.organizationId,
        },
        at,
      );
      this.audit(input.byActorId, `invitation ${invitationId} sent to ${input.organizationId}`, at);
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true, invitationId });
    });
  }

  private intake(input: IntakeMessage): Result<{ applied: boolean }> {
    const at = now();
    const payload = payloadOf({ ...input });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(`intake:${input.messageId}`, payload);
      if (replay !== undefined) return replay;
      if (input.kind === "acceptance") {
        if (input.invitationId === undefined) return failure("invalid-command", "acceptance needs an invitationId");
        const invitation = this.one(
          "SELECT organization_id FROM invitations WHERE invitation_id = ?",
          input.invitationId,
        );
        if (invitation === undefined) return failure("unavailable", "invitation is not recorded yet");
        const organizationId = String(invitation["organization_id"]);
        this.ctx.storage.sql.exec(
          "UPDATE invitations SET status = 'active', updated_at = ? WHERE invitation_id = ?",
          at,
          input.invitationId,
        );
        this.ctx.storage.sql.exec(
          "UPDATE participations SET status = 'active', updated_at = ? WHERE organization_id = ?",
          at,
          organizationId,
        );
        this.audit("outbox", `participation ${organizationId} active (canonical)`, at);
      } else if (input.kind === "participation-revoked") {
        if (input.organizationId === undefined) return failure("invalid-command", "revocation needs an organizationId");
        this.ctx.storage.sql.exec(
          "UPDATE invitations SET status = 'revoked', updated_at = ? WHERE organization_id = ? AND status IN ('invited', 'accepted', 'active')",
          at,
          input.organizationId,
        );
        this.ctx.storage.sql.exec(
          "UPDATE participations SET status = 'revoked', updated_at = ? WHERE organization_id = ?",
          at,
          input.organizationId,
        );
        this.ctx.storage.sql.exec(
          "UPDATE refresh_records SET revoked = 1 WHERE organization_id = ?",
          input.organizationId,
        );
        this.audit("outbox", `participation ${input.organizationId} revoked`, at);
      } else if (input.kind === "actor-disabled") {
        if (input.organizationId === undefined || input.actorId === undefined) {
          return failure("invalid-command", "actor-disabled needs organizationId and actorId");
        }
        this.revokeRefreshRecords(input.organizationId, input.actorId);
        this.audit("outbox", `actor ${input.organizationId}/${input.actorId} disabled; refresh records revoked`, at);
      } else {
        return failure("invalid-command", `unknown intake kind ${input.kind}`);
      }
      this.claim(`intake:${input.messageId}`, payload, at);
      return value({ applied: true });
    });
  }

  private revokeParticipation(organizationId: string, byActorId: string, idempotencyKey: string): Result<{ applied: boolean }> {
    const at = now();
    const payload = payloadOf({ kind: "participation-revoke", organizationId, byActorId });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(idempotencyKey, payload);
      if (replay !== undefined) return replay;
      const participation = this.one("SELECT status FROM participations WHERE organization_id = ?", organizationId);
      if (participation === undefined) return failure("denied", "the organization is not participating");
      this.ctx.storage.sql.exec(
        "UPDATE participations SET status = 'revoked', updated_at = ? WHERE organization_id = ?",
        at,
        organizationId,
      );
      this.ctx.storage.sql.exec(
        "UPDATE invitations SET status = 'revoked', updated_at = ? WHERE organization_id = ?",
        at,
        organizationId,
      );
      this.ctx.storage.sql.exec(
        "UPDATE refresh_records SET revoked = 1 WHERE organization_id = ?",
        organizationId,
      );
      this.outbox(
        "participation-revoked",
        organizationId,
        { kind: "participation-revoked", organizationId, operationId: this.operationId() },
        at,
      );
      this.audit(byActorId, `participation ${organizationId} revoked by operation`, at);
      this.claim(idempotencyKey, payload, at);
      return value({ applied: true });
    });
  }

  private grant(input: GrantCommand): Result<{ applied: boolean; grantId?: string }> {
    const at = now();
    const grantId = input.grantId ?? `g-${crypto.randomUUID()}`;
    const payload = payloadOf({
      kind: "grant-hat",
      grantId: input.grantId ?? null,
      organizationId: input.organizationId,
      actorId: input.actorId,
      role: input.role,
      teamId: input.teamId ?? null,
      siteId: input.siteId ?? null,
      primary: input.primary === true,
      byActorId: input.byActorId,
    });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      const policy = this.policy();
      if (policy === undefined) return failure("unavailable", "operation is not bootstrapped");
      if (actionsOf(policy, input.role) === undefined) return failure("invalid-command", `unknown role ${input.role}`);
      if ((input.teamId === undefined) === (input.siteId === undefined)) {
        return failure("invalid-command", "a grant needs exactly one target");
      }
      if (input.teamId !== undefined && this.one("SELECT 1 AS present FROM teams WHERE team_id = ?", input.teamId) === undefined) {
        return failure("invalid-command", "unknown team");
      }
      if (input.siteId !== undefined && this.one("SELECT 1 AS present FROM sites WHERE site_id = ?", input.siteId) === undefined) {
        return failure("invalid-command", "unknown site");
      }
      if (input.primary === true) {
        this.ctx.storage.sql.exec(
          "UPDATE grants SET is_primary = 0, updated_at = ? WHERE organization_id = ? AND actor_id = ?",
          at,
          input.organizationId,
          input.actorId,
        );
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO grants
          (grant_id, organization_id, actor_id, role, target_kind, team_id, site_id, is_primary, revoked, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        grantId,
        input.organizationId,
        input.actorId,
        input.role,
        input.teamId === undefined ? "site" : "team",
        input.teamId ?? null,
        input.siteId ?? null,
        input.primary === true ? 1 : 0,
        at,
        at,
      );
      this.audit(input.byActorId, `grant ${grantId} (${input.role}) to ${input.organizationId}/${input.actorId}`, at);
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true, grantId });
    });
  }

  private revokeGrant(input: RevokeGrantCommand): Result<{ applied: boolean }> {
    const at = now();
    const payload = payloadOf({ kind: "revoke-grant", grantId: input.grantId, byActorId: input.byActorId });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      const grant = this.one("SELECT organization_id, actor_id FROM grants WHERE grant_id = ?", input.grantId);
      if (grant === undefined) return failure("invalid-command", "unknown grant");
      this.ctx.storage.sql.exec(
        "UPDATE grants SET revoked = 1, updated_at = ? WHERE grant_id = ?",
        at,
        input.grantId,
      );
      this.revokeRefreshRecords(String(grant["organization_id"]), String(grant["actor_id"]));
      this.audit(input.byActorId, `grant ${input.grantId} revoked`, at);
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true });
    });
  }

  private selectHat(input: SelectHatCommand): Result<{ applied: boolean }> {
    const at = now();
    const payload = payloadOf({ kind: "select-hat", grantId: input.grantId, actorId: input.actorId, byActorId: input.byActorId });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      const grant = this.one("SELECT organization_id, actor_id FROM grants WHERE grant_id = ?", input.grantId);
      if (grant === undefined) return failure("invalid-command", "unknown grant");
      if (String(grant["actor_id"]) !== input.actorId && input.byActorId !== input.actorId) {
        return failure("denied", "an actor selects their own hat or an administrator does");
      }
      const organizationId = String(grant["organization_id"]);
      this.ctx.storage.sql.exec(
        "UPDATE grants SET is_primary = 0, updated_at = ? WHERE organization_id = ? AND actor_id = ?",
        at,
        organizationId,
        input.actorId,
      );
      this.ctx.storage.sql.exec(
        "UPDATE grants SET is_primary = 1, updated_at = ? WHERE grant_id = ?",
        at,
        input.grantId,
      );
      this.audit(input.byActorId, `primary hat set to grant ${input.grantId}`, at);
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true });
    });
  }

  private requestAccess(input: AccessRequestCommand): Result<{ applied: boolean; requestId?: string }> {
    const at = now();
    const requestId = input.requestId ?? `ar-${crypto.randomUUID()}`;
    const payload = payloadOf({
      kind: "request-access",
      requestId: input.requestId ?? null,
      organizationId: input.organizationId,
      actorId: input.actorId,
      note: input.note ?? null,
    });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      this.ctx.storage.sql.exec(
        "INSERT INTO access_requests (request_id, organization_id, actor_id, note, created_at) VALUES (?, ?, ?, ?, ?)",
        requestId,
        input.organizationId,
        input.actorId,
        input.note ?? null,
        at,
      );
      this.audit(`${input.organizationId}/${input.actorId}`, `access request ${requestId}`, at);
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true, requestId });
    });
  }

  private admit(input: AdmitCommand): Result<{ applied: boolean }> {
    const at = now();
    const payload = payloadOf({ kind: "admit", organizationId: input.organizationId, actorId: input.actorId, byActorId: input.byActorId });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      this.ctx.storage.sql.exec(
        "DELETE FROM access_requests WHERE organization_id = ? AND actor_id = ?",
        input.organizationId,
        input.actorId,
      );
      this.audit(input.byActorId, `admitted ${input.organizationId}/${input.actorId}`, at);
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true });
    });
  }

  private recordRefresh(handleHash: string, organizationId: string, actorId: string): Result<{ recorded: boolean }> {
    this.ctx.storage.sql.exec(
      `INSERT INTO refresh_records (handle_hash, organization_id, actor_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(handle_hash) DO NOTHING`,
      handleHash,
      organizationId,
      actorId,
      now(),
    );
    return value({ recorded: true });
  }

  private async drain(): Promise<{ delivered: number; pending: number }> {
    let delivered = 0;
    for (const row of this.outboxRows()) {
      const target = String(row["target"]);
      if (target === "*") continue;
      const stub = this.env.ORGANIZATION.get(this.env.ORGANIZATION.idFromName(target));
      const body = { ...(JSON.parse(String(row["payload"])) as Record<string, unknown>), messageId: String(row["id"]) };
      const response = await stub.fetch("https://organization.internal/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        this.markDelivered(String(row["id"]));
        delivered += 1;
      }
    }
    const pending = this.outboxRows().length;
    if (pending > 0) await this.ctx.storage.setAlarm(Date.now() + 1000);
    return { delivered, pending };
  }

  private outboxRows(): Row[] {
    return this.rows(
      "SELECT id, kind, target, payload, created_at FROM outbox WHERE delivered_at IS NULL ORDER BY created_at, id",
    );
  }

  private markDelivered(id: string): void {
    this.ctx.storage.sql.exec("UPDATE outbox SET delivered_at = ? WHERE id = ?", now(), id);
  }

  private status(): Record<string, unknown> {
    const count = (table: string): number => Number(this.one(`SELECT COUNT(*) AS n FROM ${table}`)?.["n"] ?? 0);
    return {
      schemaVersion: String(this.one("SELECT value FROM meta WHERE key = 'schema_version'")?.["value"] ?? "0"),
      operationId: this.operationId() ?? null,
      policyId: this.policy()?.id ?? null,
      policyVersion: this.policy()?.version ?? null,
      sites: count("sites"),
      teams: count("teams"),
      grants: count("grants"),
      participations: count("participations"),
      invitations: count("invitations"),
      refreshRecords: count("refresh_records"),
      accessRequests: count("access_requests"),
      outbox: this.outboxRows().length,
      audit: count("audit"),
    };
  }

  private snapshot(): Record<string, unknown> {
    return {
      operationId: this.operationId() ?? null,
      policy: this.policy() ?? null,
      sites: this.rows("SELECT site_id, display_name, aliases_json FROM sites ORDER BY site_id").map((row) => ({
        siteId: String(row["site_id"]),
        displayName: row["display_name"],
        aliases: JSON.parse(String(row["aliases_json"])) as unknown,
      })),
      teams: this.rows("SELECT team_id, site_id, organization_id, display_name FROM teams ORDER BY team_id"),
      grants: this.rows("SELECT * FROM grants ORDER BY grant_id").map((row) => ({
        grantId: String(row["grant_id"]),
        organizationId: String(row["organization_id"]),
        actorId: String(row["actor_id"]),
        role: String(row["role"]),
        target: row["target_kind"] === "team"
          ? { kind: "team", teamId: String(row["team_id"]) }
          : { kind: "site", siteId: String(row["site_id"]) },
        primary: Number(row["is_primary"]) === 1,
        revoked: Number(row["revoked"]) === 1,
      })),
      participations: this.rows("SELECT organization_id, status FROM participations ORDER BY organization_id"),
      invitations: this.rows("SELECT invitation_id, organization_id, status FROM invitations ORDER BY invitation_id"),
      refreshRecords: this.rows("SELECT handle_hash, organization_id, actor_id, revoked, superseded, amr_json, auth_time FROM refresh_records ORDER BY handle_hash"),
      accessRequests: this.rows("SELECT request_id, organization_id, actor_id, note FROM access_requests ORDER BY request_id"),
    };
  }

  private configureActions(): readonly string[] {
    const row = this.one("SELECT configure_actions_json FROM operation LIMIT 1");
    return row === undefined ? ["configure"] : (JSON.parse(String(row["configure_actions_json"])) as string[]);
  }

  private envelopeLifetime(): number {
    const row = this.one("SELECT envelope_lifetime_seconds FROM operation LIMIT 1");
    return row === undefined ? 900 : Number(row["envelope_lifetime_seconds"]);
  }

  private modelSnapshot(organizationId: string, actorId: string): Snapshot | undefined {
    const operationId = this.operationId();
    if (operationId === undefined) return undefined;
    const sites = this.rows("SELECT site_id, display_name, aliases_json FROM sites").map((row) => ({
      siteId: String(row["site_id"]),
      operationId,
      ...(row["display_name"] === null ? {} : { displayName: String(row["display_name"]) }),
      aliases: JSON.parse(String(row["aliases_json"])) as string[],
    }));
    const teams = this.rows("SELECT team_id, site_id, organization_id, display_name FROM teams").map((row) => ({
      teamId: String(row["team_id"]),
      siteId: String(row["site_id"]),
      organizationId: String(row["organization_id"]),
      ...(row["display_name"] === null ? {} : { displayName: String(row["display_name"]) }),
    }));
    const grants: Grant[] = this.rows("SELECT * FROM grants").map((row) => ({
      grantId: String(row["grant_id"]),
      operationId,
      organizationId: String(row["organization_id"]),
      actorId: String(row["actor_id"]),
      role: String(row["role"]),
      target: row["target_kind"] === "team"
        ? { kind: "team", teamId: String(row["team_id"]) }
        : { kind: "site", siteId: String(row["site_id"]) },
      ...(Number(row["is_primary"]) === 1 ? { primary: true } : {}),
      ...(Number(row["revoked"]) === 1 ? { revoked: true } : {}),
    }));
    const participations = this.rows("SELECT organization_id, status FROM participations").map((row) => ({
      organizationId: String(row["organization_id"]),
      operationId,
      status: String(row["status"]) as "invited" | "accepted" | "active" | "revoked",
    }));
    const organizationIds = [...new Set([
      ...teams.map((team) => team.organizationId),
      ...participations.map((participation) => participation.organizationId),
    ])];
    return {
      organizations: organizationIds.map((id) => ({ organizationId: id })),
      actors: [{ organizationId, actorId }],
      operations: [{ operationId }],
      sites,
      teams,
      grants,
      participations,
    };
  }

  private buildClaims(organizationId: string, actorId: string, auth?: AuthenticationFacts): Result<{
    readonly claims: AccessEnvelopeClaimsV1;
  }> {
    const operationId = this.operationId();
    const policy = this.policy();
    if (operationId === undefined || policy === undefined) return failure("unavailable", "operation is not bootstrapped");
    const snapshot = this.modelSnapshot(organizationId, actorId);
    if (snapshot === undefined) return failure("unavailable", "operation is not bootstrapped");
    const wearable = wearableGrants(snapshot, organizationId, actorId, operationId);
    if (wearable.length === 0) return failure("not-admitted");
    const rank = (grant: Grant): string =>
      `${grant.primary === true ? 0 : 1}|${grant.role}|${grant.target.kind === "team" ? grant.target.teamId : grant.target.siteId}|${grant.grantId}`;
    const hat = [...wearable].sort((left, right) => rank(left) < rank(right) ? -1 : rank(left) > rank(right) ? 1 : 0)[0];
    if (hat === undefined) return failure("not-admitted");
    const actions = actionsOf(policy, hat.role) ?? [];
    const teams = snapshot.teams;
    const hatTeamIds = new Set<string>();
    const hatSiteIds = new Set<string>();
    if (hat.target.kind === "site") {
      hatSiteIds.add(hat.target.siteId);
      for (const team of teams) if (team.siteId === hat.target.siteId) hatTeamIds.add(team.teamId);
    } else {
      hatTeamIds.add(hat.target.teamId);
    }
    const siteIds = new Set<string>();
    const memberTeams = new Set<string>();
    for (const grant of wearable) {
      if (grant.target.kind === "site") {
        siteIds.add(grant.target.siteId);
        for (const team of teams) if (team.siteId === grant.target.siteId) memberTeams.add(team.teamId);
      } else {
        const teamId = grant.target.teamId;
        memberTeams.add(teamId);
        const team = teams.find((candidate) => candidate.teamId === teamId);
        if (team !== undefined) siteIds.add(team.siteId);
      }
    }
    const sites: SiteBinding[] = snapshot.sites
      .filter((site) => siteIds.has(site.siteId))
      .map((site) => ({ siteId: site.siteId, aliases: [...site.aliases] }));
    const reach = readReach(snapshot, policy, organizationId, actorId, operationId);
    const configureActions = this.configureActions();
    const configurableSiteIds = [...new Set(
      wearable.flatMap((grant) => {
        const carried = actionsOf(policy, grant.role) ?? [];
        if (!carried.some((action) => configureActions.includes(action))) return [];
        if (grant.target.kind === "site") return [grant.target.siteId];
        const teamId = grant.target.teamId;
        const team = teams.find((candidate) => candidate.teamId === teamId);
        return team === undefined ? [] : [team.siteId];
      }),
    )];
    const iat = now();
    return value({
      claims: {
        v: ACCESS_ENVELOPE_VERSION,
        interfaceVersion: AUTHORITY_INTERFACE_VERSION,
        operationId,
        actor: { organizationId, actorId },
        hat: {
          role: hat.role,
          actions: [...actions],
          teamIds: [...hatTeamIds],
          siteIds: [...hatSiteIds],
        },
        memberTeamIds: [...memberTeams],
        sites,
        readableOrganizationIds: reach.readableOrganizationIds,
        readableTeamIds: reach.readableTeamIds,
        configurableSiteIds,
        iat,
        exp: iat + this.envelopeLifetime(),
        ...(auth?.amr !== undefined ? { amr: [...auth.amr] } : {}),
        ...(auth?.authTime !== undefined ? { auth_time: auth.authTime } : {}),
      },
    });
  }

  private async newRefresh(organizationId: string, actorId: string, auth?: AuthenticationFacts): Promise<{ handle: string; at: number }> {
    const handle = `rh-${crypto.randomUUID()}`;
    const at = now();
    this.ctx.storage.sql.exec(
      `INSERT INTO refresh_records (handle_hash, organization_id, actor_id, revoked, superseded, amr_json, auth_time, created_at)
       VALUES (?, ?, ?, 0, 0, ?, ?, ?)`,
      await sha256Hex(handle),
      organizationId,
      actorId,
      auth?.amr === undefined ? null : canonicalJson(auth.amr as unknown as JsonValue),
      auth?.authTime ?? null,
      at,
    );
    return { handle, at };
  }

  private async issue(organizationId: string, actorId: string, auth?: AuthenticationFacts): Promise<Result<{
    readonly claims: AccessEnvelopeClaimsV1;
    readonly refresh: RefreshHandleOutcome;
  }>> {
    const built = this.buildClaims(organizationId, actorId, auth);
    if (!built.ok) return built;
    const refresh = await this.newRefresh(organizationId, actorId, auth);
    return value({ claims: built.value.claims, refresh: { kind: "rotated", handle: refresh.handle } });
  }

  private async refresh(handle: string): Promise<Result<{
    readonly claims: AccessEnvelopeClaimsV1;
    readonly refresh: RefreshHandleOutcome;
  }>> {
    const hash = await sha256Hex(handle);
    const record = this.one(
      `SELECT organization_id, actor_id, revoked, superseded, amr_json, auth_time
       FROM refresh_records WHERE handle_hash = ?`,
      hash,
    );
    if (record === undefined) return failure("unauthenticated", "unknown refresh handle");
    if (Number(record["revoked"]) === 1) return failure("unauthenticated", "refresh handle revoked");
    if (Number(record["superseded"]) === 1) return failure("unauthenticated", "refresh handle superseded");
    const organizationId = String(record["organization_id"]);
    const actorId = String(record["actor_id"]);
    // the authentication event, not the envelope, survives the chain
    const auth: AuthenticationFacts | undefined =
      record["amr_json"] === null && record["auth_time"] === null
        ? undefined
        : {
            ...(record["amr_json"] === null ? {} : { amr: JSON.parse(String(record["amr_json"])) as string[] }),
            ...(record["auth_time"] === null ? {} : { authTime: Number(record["auth_time"]) }),
          };
    const built = this.buildClaims(organizationId, actorId, auth);
    if (!built.ok) return built;
    this.ctx.storage.sql.exec(
      "UPDATE refresh_records SET superseded = 1 WHERE handle_hash = ?",
      hash,
    );
    const next = await this.newRefresh(organizationId, actorId, auth);
    return value({ claims: built.value.claims, refresh: { kind: "rotated", handle: next.handle } });
  }

  private reset(): Result<{ reset: boolean }> {
    for (const table of [
      "operation",
      "sites",
      "teams",
      "participations",
      "invitations",
      "grants",
      "refresh_records",
      "access_requests",
      "audit",
      "claims",
      "outbox",
    ]) {
      this.ctx.storage.sql.exec(`DELETE FROM ${table}`);
    }
    return value({ reset: true });
  }

  private context(organizationId: string, actorId: string, role: string): Result<{
    readonly operationId: string;
    readonly operationDisplayName?: string;
    readonly participation: "invited" | "accepted" | "active" | "revoked";
    readonly wearableHats: readonly HatSummary[];
  }> {
    const operation = this.one("SELECT operation_id, display_name FROM operation LIMIT 1");
    if (operation === undefined) return failure("unavailable", "operation is not bootstrapped");
    const policy = this.policy();
    if (policy === undefined) return failure("unavailable", "operation has no policy");
    const participation = this.one(
      "SELECT status FROM participations WHERE organization_id = ?",
      organizationId,
    );
    const status = participation === undefined ? "revoked" : String(participation["status"]);
    const wearable = this.rows(
      "SELECT role, target_kind, team_id, site_id, is_primary FROM grants WHERE organization_id = ? AND actor_id = ? AND revoked = 0 ORDER BY grant_id",
      organizationId,
      actorId,
    ).map((row) => ({
      role: String(row["role"]),
      actions: [...(actionsOf(policy, String(row["role"])) ?? [])],
      ...(row["target_kind"] === "team"
        ? { teamId: String(row["team_id"]) }
        : { siteId: String(row["site_id"]) }),
      primary: Number(row["is_primary"]) === 1,
    }));
    return value({
      operationId: String(operation["operation_id"]),
      ...(operation["display_name"] === null ? {} : { operationDisplayName: String(operation["display_name"]) }),
      participation: status as "invited" | "accepted" | "active" | "revoked",
      wearableHats: wearable,
    });
  }

  private exportSnapshot(): ExportSnapshot {
    return {
      schemaVersion: String(this.one("SELECT value FROM meta WHERE key = 'schema_version'")?.["value"] ?? "0"),
      coordinator: "operation",
      tables: readTables(this.ctx.storage.sql, operationTables),
    };
  }

  private restoreSnapshot(input: unknown): Result<{ restored: boolean }> {
    if (typeof input !== "object" || input === null) return failure("invalid-command", "snapshot must be an object");
    const snapshot = input as Partial<ExportSnapshot>;
    if (snapshot.coordinator !== "operation") return failure("invalid-command", "snapshot is not operation state");
    const version = String(this.one("SELECT value FROM meta WHERE key = 'schema_version'")?.["value"] ?? "0");
    if (snapshot.schemaVersion !== version) return failure("invalid-command", "snapshot schema version does not match");
    if (typeof snapshot.tables !== "object" || snapshot.tables === null) return failure("invalid-command", "snapshot has no tables");
    this.ctx.storage.transactionSync(() => {
      restoreTables(
        this.ctx.storage.sql,
        operationTables,
        snapshot.tables as Readonly<Record<string, readonly StateRow[]>>,
      );
    });
    return value({ restored: true });
  }

  async alarm(): Promise<void> {
    await this.drain();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const json = (body: unknown, status = 200): Response => Response.json(body, { status });
    const readBody = async (): Promise<Record<string, unknown>> => asRecord(await request.json());

    try {
      if (request.method === "POST" && url.pathname === "/bootstrap") {
        const body = await readBody();
        const policy = asRecord(body["policy"]) as unknown as PolicyBundle;
        const input: BootstrapInput = {
          operationId: asString(body["operationId"], "operationId"),
          ...(body["displayName"] === undefined ? {} : { displayName: asString(body["displayName"], "displayName") }),
          ...(body["bounded"] === true ? { bounded: true } : {}),
          policy,
          ...(body["adminRoles"] === undefined ? {} : { adminRoles: asArray(body["adminRoles"], "adminRoles").map((entry) => asString(entry, "adminRoles entry")) }),
          ...(body["configureActions"] === undefined ? {} : { configureActions: asArray(body["configureActions"], "configureActions").map((entry) => asString(entry, "configureActions entry")) }),
          ...(body["envelopeLifetimeSeconds"] === undefined ? {} : { envelopeLifetimeSeconds: Number(body["envelopeLifetimeSeconds"]) }),
          sites: asArray(body["sites"], "sites").map((entry) => {
            const site = asRecord(entry);
            return {
              siteId: asString(site["siteId"], "siteId"),
              ...(site["displayName"] === undefined ? {} : { displayName: asString(site["displayName"], "displayName") }),
              aliases: asArray(site["aliases"] ?? [], "aliases").map((alias) => asString(alias, "alias")),
            };
          }),
          teams: asArray(body["teams"], "teams").map((entry) => {
            const team = asRecord(entry);
            return {
              teamId: asString(team["teamId"], "teamId"),
              siteId: asString(team["siteId"], "siteId"),
              organizationId: asString(team["organizationId"], "organizationId"),
              ...(team["displayName"] === undefined ? {} : { displayName: asString(team["displayName"], "displayName") }),
            };
          }),
          grants: asArray(body["grants"] ?? [], "grants").map((entry) => {
            const grant = asRecord(entry);
            return {
              grantId: asString(grant["grantId"], "grantId"),
              organizationId: asString(grant["organizationId"], "organizationId"),
              actorId: asString(grant["actorId"], "actorId"),
              role: asString(grant["role"], "role"),
              ...(grant["teamId"] === undefined ? {} : { teamId: asString(grant["teamId"], "teamId") }),
              ...(grant["siteId"] === undefined ? {} : { siteId: asString(grant["siteId"], "siteId") }),
              ...(grant["primary"] === true ? { primary: true } : {}),
              ...(grant["revoked"] === true ? { revoked: true } : {}),
            };
          }),
          participations: asArray(body["participations"] ?? [], "participations").map((entry) => {
            const participation = asRecord(entry);
            const status = asString(participation["status"], "status");
            if (!["invited", "accepted", "active", "revoked"].includes(status)) throw new Error("invalid participation status");
            return {
              organizationId: asString(participation["organizationId"], "organizationId"),
              status: status as ParticipationInput["status"],
            };
          }),
        };
        return json(this.bootstrap(input));
      }

      if (request.method === "POST" && url.pathname === "/invite") {
        const body = await readBody();
        return json(this.invite({
          ...(body["invitationId"] === undefined ? {} : { invitationId: asString(body["invitationId"], "invitationId") }),
          organizationId: asString(body["organizationId"], "organizationId"),
          byActorId: asString(body["byActorId"], "byActorId"),
          idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
        }));
      }

      if (request.method === "POST" && url.pathname === "/intake") {
        const body = await readBody();
        const result = this.intake({
          messageId: asString(body["messageId"], "messageId"),
          kind: asString(body["kind"], "kind"),
          ...(body["invitationId"] === undefined ? {} : { invitationId: asString(body["invitationId"], "invitationId") }),
          ...(body["organizationId"] === undefined ? {} : { organizationId: asString(body["organizationId"], "organizationId") }),
          ...(body["operationId"] === undefined ? {} : { operationId: asString(body["operationId"], "operationId") }),
          ...(body["actorId"] === undefined ? {} : { actorId: asString(body["actorId"], "actorId") }),
        });
        return json(result, result.ok ? 200 : 503);
      }

      if (request.method === "POST" && url.pathname === "/revoke-participation") {
        const body = await readBody();
        return json(this.revokeParticipation(
          asString(body["organizationId"], "organizationId"),
          asString(body["byActorId"], "byActorId"),
          asString(body["idempotencyKey"], "idempotencyKey"),
        ));
      }

      if (request.method === "POST" && url.pathname === "/grant") {
        const body = await readBody();
        return json(this.grant({
          ...(body["grantId"] === undefined ? {} : { grantId: asString(body["grantId"], "grantId") }),
          organizationId: asString(body["organizationId"], "organizationId"),
          actorId: asString(body["actorId"], "actorId"),
          role: asString(body["role"], "role"),
          ...(body["teamId"] === undefined ? {} : { teamId: asString(body["teamId"], "teamId") }),
          ...(body["siteId"] === undefined ? {} : { siteId: asString(body["siteId"], "siteId") }),
          ...(body["primary"] === true ? { primary: true } : {}),
          byActorId: asString(body["byActorId"], "byActorId"),
          idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
        }));
      }

      if (request.method === "POST" && url.pathname === "/revoke-grant") {
        const body = await readBody();
        return json(this.revokeGrant({
          grantId: asString(body["grantId"], "grantId"),
          byActorId: asString(body["byActorId"], "byActorId"),
          idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
        }));
      }

      if (request.method === "POST" && url.pathname === "/select-hat") {
        const body = await readBody();
        return json(this.selectHat({
          grantId: asString(body["grantId"], "grantId"),
          actorId: asString(body["actorId"], "actorId"),
          byActorId: asString(body["byActorId"], "byActorId"),
          idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
        }));
      }

      if (request.method === "POST" && url.pathname === "/request-access") {
        const body = await readBody();
        return json(this.requestAccess({
          ...(body["requestId"] === undefined ? {} : { requestId: asString(body["requestId"], "requestId") }),
          organizationId: asString(body["organizationId"], "organizationId"),
          actorId: asString(body["actorId"], "actorId"),
          ...(body["note"] === undefined ? {} : { note: asString(body["note"], "note") }),
          idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
        }));
      }

      if (request.method === "POST" && url.pathname === "/admit") {
        const body = await readBody();
        return json(this.admit({
          organizationId: asString(body["organizationId"], "organizationId"),
          actorId: asString(body["actorId"], "actorId"),
          byActorId: asString(body["byActorId"], "byActorId"),
          idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
        }));
      }

      if (request.method === "POST" && url.pathname === "/refresh-record") {
        const body = await readBody();
        return json(this.recordRefresh(
          asString(body["handleHash"], "handleHash"),
          asString(body["organizationId"], "organizationId"),
          asString(body["actorId"], "actorId"),
        ));
      }

      if (request.method === "POST" && url.pathname === "/issue") {
        const body = await readBody();
        const auth: AuthenticationFacts | undefined =
          body["amr"] === undefined && body["authTime"] === undefined
            ? undefined
            : {
                ...(body["amr"] === undefined ? {} : { amr: asArray(body["amr"], "amr").map((entry) => asString(entry, "amr entry")) }),
                ...(body["authTime"] === undefined ? {} : { authTime: Number(body["authTime"]) }),
              };
        const result = await this.issue(
          asString(body["organizationId"], "organizationId"),
          asString(body["actorId"], "actorId"),
          auth,
        );
        return json(result, result.ok ? 200 : 400);
      }

      if (request.method === "POST" && url.pathname === "/refresh") {
        const body = await readBody();
        const result = await this.refresh(asString(body["handle"], "handle"));
        return json(result, result.ok ? 200 : 400);
      }

      if (request.method === "POST" && url.pathname === "/reset") {
        return json(this.reset());
      }

      if (request.method === "GET" && url.pathname === "/config") {
        return json(value({
          adminRoles: this.adminRoles(),
          configureActions: this.configureActions(),
          envelopeLifetimeSeconds: this.envelopeLifetime(),
        }));
      }

      if (request.method === "POST" && url.pathname === "/context") {
        const body = await readBody();
        return json(this.context(
          asString(body["organizationId"], "organizationId"),
          asString(body["actorId"], "actorId"),
          asString(body["role"], "role"),
        ));
      }

      if (request.method === "POST" && url.pathname === "/drain") {
        return json(value(await this.drain()));
      }

      if (request.method === "GET" && url.pathname === "/status") return json(value(this.status()));
      if (request.method === "GET" && url.pathname === "/export") return json(value(this.exportSnapshot()));
      if (request.method === "POST" && url.pathname === "/restore") return json(this.restoreSnapshot(await request.json()));
      if (request.method === "GET" && url.pathname === "/snapshot") return json(value(this.snapshot()));
      if (request.method === "GET" && url.pathname === "/audit") {
        return json(value(this.rows("SELECT seq, at, actor, fact FROM audit ORDER BY seq")));
      }
      if (request.method === "GET" && url.pathname === "/outbox") {
        return json(value(this.outboxRows().map((row) => ({
          id: String(row["id"]),
          kind: String(row["kind"]),
          target: String(row["target"]),
          payload: JSON.parse(String(row["payload"])) as unknown,
        }))));
      }

      return json(failure("wrong-binding", "unknown operation route"), 404);
    } catch (error) {
      return json(failure("invalid-command", error instanceof Error ? error.message : "invalid request"), 400);
    }
  }
}
