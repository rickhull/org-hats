import { DurableObject } from "cloudflare:workers";
import {
  canonicalJson,
  type Failure,
  type FailureKind,
  type JsonValue,
} from "org-hats/authority";
import type { Env } from "./env";
import {
  organizationTables,
  readTables,
  restoreTables,
  type ExportSnapshot,
  type StateRow,
} from "./state";

/** One organization authority. The object owns the facts that stay stable
 * while the organization participates in several operations: actors,
 * verified-principal links, organization administrators, the organization's
 * side of invitations, audit, idempotency claims, and its outbox. */
const SCHEMA_VERSION = "2";

type Row = Record<string, string | number | null>;

type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: Failure };

const now = (): number => Math.floor(Date.now() / 1000);

/** Messages addressed to every operation this organization is known to,
 * rather than to one named target: a roster image and an actor disable are
 * both facts every participating operation must learn. */
const FAN_OUT_KINDS = new Set(["actor-disabled", "actor-unlinked", "roster"]);

const failure = (kind: FailureKind, detail?: string): { readonly ok: false; readonly failure: Failure } => ({
  ok: false,
  failure: { kind, ...(detail !== undefined ? { detail } : {}) },
});

const value = <T>(result: T): { readonly ok: true; readonly value: T } => ({ ok: true, value: result });

const payloadOf = (input: Record<string, unknown>): string =>
  canonicalJson(input as unknown as JsonValue);

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

interface BootstrapInput {
  readonly organizationId: string;
  readonly displayName?: string;
  readonly actors: readonly {
    readonly actorId: string;
    readonly displayName?: string;
    readonly disabled?: boolean;
  }[];
  readonly principalLinks: readonly {
    readonly provider: string;
    readonly subject: string;
    readonly actorId: string;
  }[];
  readonly orgAdmins: readonly string[];
  readonly sealedIdpConfig?: string;
}

interface AcceptInput {
  readonly operationId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
}

interface RevokeInput extends AcceptInput {}

interface DisableInput {
  readonly actorId: string;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

interface ActivationRequestInput {
  readonly actorId: string;
  readonly byActorId: string;
  readonly secretHash: string;
  readonly operator?: boolean;
}

interface ActivationAcceptInput {
  readonly secretHash: string;
  readonly provider: string;
  readonly subject: string;
}

interface RecoveryInput {
  readonly actorId: string;
  readonly byActorId: string;
  readonly idempotencyKey: string;
  readonly operator?: boolean;
}

interface CreateActorInput {
  readonly actorId: string;
  readonly displayName?: string;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

interface UpdateActorInput {
  readonly actorId: string;
  /** `null` clears the display name; the field is required so a retry cannot
   * change shape between absent and null. */
  readonly displayName: string | null;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

interface AdministratorInput {
  readonly actorId: string;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

export class OrganizationAuthority extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.initialize();
  }

  private initialize(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS organization (
        organization_id TEXT PRIMARY KEY,
        display_name TEXT,
        sealed_idp_config TEXT,
        sealed_idp_config_updated_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS actors (
        actor_id TEXT PRIMARY KEY,
        display_name TEXT,
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS principal_links (
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (provider, subject)
      )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS activation_requests (
        request_id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        secret_hash TEXT NOT NULL UNIQUE,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER,
        revoked_at INTEGER
      )`,
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS org_admins (actor_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)",
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS invitations (
        invitation_id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
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
    sql.exec(
      "INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)",
      SCHEMA_VERSION,
    );
    sql.exec("UPDATE meta SET value = ? WHERE key = 'schema_version'", SCHEMA_VERSION);
  }

  private rows(query: string, ...bindings: (string | number | null)[]): Row[] {
    return this.ctx.storage.sql.exec<Row>(query, ...bindings).toArray();
  }

  private one(query: string, ...bindings: (string | number | null)[]): Row | undefined {
    return this.rows(query, ...bindings)[0];
  }

  private organizationId(): string | undefined {
    const row = this.one("SELECT organization_id FROM organization LIMIT 1");
    return row === undefined ? undefined : String(row["organization_id"]);
  }

  private audit(actor: string, fact: string, at: number): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO audit (at, actor, fact) VALUES (?, ?, ?)",
      at,
      actor,
      fact,
    );
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

  private displayNameFailure(value: string | null | undefined): Result<never> | undefined {
    if (value === undefined || value === null) return undefined;
    if (value.trim().length === 0) return failure("invalid-command", "display name is empty");
    if (value.length > 200) return failure("invalid-command", "display name is too long");
    return undefined;
  }

  private isAdmin(actorId: string): boolean {
    return this.one("SELECT 1 AS present FROM org_admins WHERE actor_id = ?", actorId) !== undefined;
  }

  private actor(actorId: string): { readonly actorId: string; readonly displayName?: string; readonly disabled: boolean } | undefined {
    const row = this.one("SELECT actor_id, display_name, disabled FROM actors WHERE actor_id = ?", actorId);
    if (row === undefined) return undefined;
    return {
      actorId: String(row["actor_id"]),
      ...(row["display_name"] === null ? {} : { displayName: String(row["display_name"]) }),
      disabled: Number(row["disabled"]) === 1,
    };
  }

  /** The authority-relevant tuple of every actor, for the projection the
   * participating operations keep. Deliberately narrow: no display names, no
   * principal links, no provider configuration — an operation decides with
   * who exists and who is disabled, and learns nothing else. */
  private roster(): readonly { readonly actorId: string; readonly disabled: boolean }[] {
    return this.rows("SELECT actor_id, disabled FROM actors ORDER BY actor_id").map((row) => ({
      actorId: String(row["actor_id"]),
      disabled: Number(row["disabled"]) === 1,
    }));
  }

  /** Push the roster to every operation this organization is known to. The
   * immediate channel: a disable must not wait for the operations'
   * reconciliation interval. The caller owns the transaction. */
  private pushRoster(at: number): void {
    this.outbox(
      "roster",
      "*",
      {
        kind: "roster",
        organizationId: this.organizationId(),
        actors: this.roster(),
        // stamped so a delayed delivery cannot overwrite a newer image
        at,
      },
      at,
    );
  }

  private bootstrap(input: BootstrapInput): Result<{ organizationId: string }> {
    const at = now();
    return this.ctx.storage.transactionSync(() => {
      // one identity is never two actors: a (provider, subject) may re-link
      // its own actor, never a different one, and a link must name a known
      // actor. Checked before any mutation so a refusal commits nothing.
      const payloadActorIds = new Set(input.actors.map((actor) => actor.actorId));
      const claimed = new Map<string, string>();
      for (const link of input.principalLinks) {
        const key = `${link.provider}:${link.subject}`;
        const row = this.one(
          "SELECT actor_id FROM principal_links WHERE provider = ? AND subject = ?",
          link.provider,
          link.subject,
        );
        const stored = row === undefined ? undefined : String(row["actor_id"]);
        const already = stored ?? claimed.get(key);
        if (already !== undefined && already !== link.actorId) {
          return failure(
            "invalid-command",
            `principal link ${key} already resolves to actor ${already}, not ${link.actorId}`,
          );
        }
        const known = payloadActorIds.has(link.actorId) || this.actor(link.actorId) !== undefined;
        if (!known) {
          return failure("invalid-command", `principal link ${key} names the unknown actor ${link.actorId}`);
        }
        claimed.set(key, link.actorId);
      }
      const existing = this.one(
        "SELECT 1 AS present FROM organization WHERE organization_id = ?",
        input.organizationId,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO organization
          (organization_id, display_name, sealed_idp_config, sealed_idp_config_updated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(organization_id) DO UPDATE SET
           display_name = excluded.display_name,
           sealed_idp_config = COALESCE(excluded.sealed_idp_config, organization.sealed_idp_config),
           sealed_idp_config_updated_at = COALESCE(excluded.sealed_idp_config_updated_at, organization.sealed_idp_config_updated_at),
           updated_at = excluded.updated_at`,
        input.organizationId,
        input.displayName ?? null,
        input.sealedIdpConfig ?? null,
        input.sealedIdpConfig === undefined ? null : at,
        at,
        at,
      );
      // Bootstrap seeds; it does not overwrite a roster fact the organization
      // now owns. A re-bootstrap adds unknown actors and leaves known ones
      // alone: it cannot revert a rename, re-enable a disabled actor, or
      // change standing (standing is INSERT OR IGNORE below as well).
      for (const actor of input.actors) {
        this.ctx.storage.sql.exec(
          `INSERT INTO actors (actor_id, display_name, disabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(actor_id) DO NOTHING`,
          actor.actorId,
          actor.displayName ?? null,
          actor.disabled === true ? 1 : 0,
          at,
          at,
        );
      }
      for (const link of input.principalLinks) {
        this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO principal_links (provider, subject, actor_id, created_at)
           VALUES (?, ?, ?, ?)`,
          link.provider,
          link.subject,
          link.actorId,
          at,
        );
      }
      for (const admin of input.orgAdmins) {
        this.ctx.storage.sql.exec(
          "INSERT OR IGNORE INTO org_admins (actor_id, created_at) VALUES (?, ?)",
          admin,
          at,
        );
      }
      if (existing === undefined) {
        this.audit("bootstrap", `organization ${input.organizationId} bootstrapped`, at);
      }
      // A bootstrap before any invitation has no operation to notify; the
      // operations populate themselves at their own bootstrap and reconcile
      // afterwards. This push is what carries a re-bootstrap that adds an
      // actor to operations that already know this organization; a disable
      // reaches them through its own message and roster push.
      this.pushRoster(at);
      return value({ organizationId: input.organizationId });
    });
  }

  private resolve(provider: string, subject: string): Result<{
    readonly actorId: string;
    readonly displayName?: string;
    readonly disabled: boolean;
  }> {
    const row = this.one(
      `SELECT a.actor_id, a.display_name, a.disabled
         FROM principal_links l JOIN actors a ON a.actor_id = l.actor_id
        WHERE l.provider = ? AND l.subject = ?`,
      provider,
      subject,
    );
    if (row === undefined) return failure("unauthenticated", "no principal link");
    return value({
      actorId: String(row["actor_id"]),
      ...(row["display_name"] === null ? {} : { displayName: String(row["display_name"]) }),
      disabled: Number(row["disabled"]) === 1,
    });
  }

  private principalLinks(): readonly {
    readonly provider: string;
    readonly subject: string;
    readonly actorId: string;
    readonly createdAt: number;
  }[] {
    return this.rows(
      "SELECT provider, subject, actor_id, created_at FROM principal_links ORDER BY provider, subject",
    ).map((row) => ({
      provider: String(row["provider"]),
      subject: String(row["subject"]),
      actorId: String(row["actor_id"]),
      createdAt: Number(row["created_at"]),
    }));
  }

  /** Bind a verified provider subject to an existing actor. The bind is
   * idempotent for the same actor and refuses a different one; the worker's
   * ops route checks the rest of the directory before this runs, so a subject
   * cannot be introduced ambiguously. */
  private linkPrincipal(input: {
    readonly provider: string;
    readonly subject: string;
    readonly actorId: string;
  }): Result<{ applied: boolean }> {
    if (this.organizationId() === undefined) return failure("unavailable", "organization is not bootstrapped");
    if (input.provider.length === 0 || input.subject.length === 0 || input.actorId.length === 0) {
      return failure("invalid-command", "provider, subject, and actorId are required");
    }
    if (this.actor(input.actorId) === undefined) {
      return failure("invalid-command", `principal link names the unknown actor ${input.actorId}`);
    }
    const at = now();
    return this.ctx.storage.transactionSync(() => {
      const existing = this.one(
        "SELECT actor_id FROM principal_links WHERE provider = ? AND subject = ?",
        input.provider,
        input.subject,
      );
      if (existing !== undefined) {
        const linked = String(existing["actor_id"]);
        if (linked !== input.actorId) {
          return failure(
            "invalid-command",
            `principal link ${input.provider}:${input.subject} already resolves to actor ${linked}`,
          );
        }
        return value({ applied: false });
      }
      this.ctx.storage.sql.exec(
        "INSERT INTO principal_links (provider, subject, actor_id, created_at) VALUES (?, ?, ?, ?)",
        input.provider,
        input.subject,
        input.actorId,
        at,
      );
      this.audit(
        "principal-link",
        `principal ${input.provider}:${input.subject} linked to actor ${input.actorId}`,
        at,
      );
      return value({ applied: true });
    });
  }

  private activationRequest(input: ActivationRequestInput): Result<{ requestId: string; expiresAt: number }> {
    const at = now();
    return this.ctx.storage.transactionSync(() => {
      if (!input.operator && !this.isAdmin(input.byActorId)) {
        return failure("denied", "the caller does not administer this organization");
      }
      const actor = this.actor(input.actorId);
      if (actor === undefined) return failure("invalid-command", "unknown actor");
      if (actor.disabled) return failure("not-admitted", "actor disabled");
      if (this.one("SELECT 1 AS present FROM principal_links WHERE actor_id = ? LIMIT 1", input.actorId) !== undefined) {
        return failure("denied", "actor already has a principal link");
      }
      this.ctx.storage.sql.exec(
        "UPDATE activation_requests SET revoked_at = ? WHERE actor_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?",
        at, input.actorId, at,
      );
      const requestId = `activation-${crypto.randomUUID()}`;
      const configuredLifetime = this.env.AUTHORITY_ACTIVATION_LIFETIME_SECONDS;
      const lifetime = configuredLifetime === undefined ? 86_400 : Number(configuredLifetime);
      if (!Number.isSafeInteger(lifetime) || lifetime <= 0) {
        return failure("unavailable", "activation lifetime configuration is invalid");
      }
      const expiresAt = at + lifetime;
      this.ctx.storage.sql.exec(
        "INSERT INTO activation_requests (request_id, actor_id, secret_hash, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        requestId, input.actorId, input.secretHash, at, expiresAt,
      );
      this.audit(input.operator ? "operator" : input.byActorId, `activation for actor ${input.actorId} issued`, at);
      return value({ requestId, expiresAt });
    });
  }

  private activationInspect(secretHash: string): Result<{ usable: true }> {
    const row = this.one(
      "SELECT consumed_at, revoked_at, expires_at FROM activation_requests WHERE secret_hash = ?",
      secretHash,
    );
    if (
      row === undefined || row["consumed_at"] !== null || row["revoked_at"] !== null ||
      now() >= Number(row["expires_at"])
    ) return failure("unauthenticated", "activation is not usable");
    return value({ usable: true });
  }

  private activationPreflight(input: ActivationAcceptInput): Result<
    { state: "active" } | { state: "replay"; actorId: string }
  > {
    const request = this.one(
      "SELECT actor_id, consumed_at, revoked_at, expires_at FROM activation_requests WHERE secret_hash = ?",
      input.secretHash,
    );
    if (request === undefined) return failure("unauthenticated", "activation is not usable");
    const targetActorId = String(request["actor_id"]);
    if (request["consumed_at"] !== null) {
      const linked = this.one(
        "SELECT actor_id FROM principal_links WHERE provider = ? AND subject = ?",
        input.provider, input.subject,
      );
      return linked !== undefined && String(linked["actor_id"]) === targetActorId
        ? value({ state: "replay", actorId: targetActorId })
        : failure("unauthenticated", "activation is not usable");
    }
    const actor = this.actor(targetActorId);
    if (
      request["revoked_at"] !== null || now() >= Number(request["expires_at"]) ||
      actor === undefined || actor.disabled ||
      this.one("SELECT 1 AS present FROM principal_links WHERE actor_id = ? LIMIT 1", targetActorId) !== undefined
    ) return failure("unauthenticated", "activation is not usable");
    return value({ state: "active" });
  }

  private activationAccept(input: ActivationAcceptInput): Result<{ applied: boolean; actorId: string }> {
    const at = now();
    return this.ctx.storage.transactionSync(() => {
      const request = this.one(
        "SELECT actor_id, consumed_at, revoked_at, expires_at FROM activation_requests WHERE secret_hash = ?",
        input.secretHash,
      );
      if (request === undefined) return failure("unauthenticated", "activation is not usable");
      const targetActorId = String(request["actor_id"]);
      const linked = this.one(
        "SELECT actor_id FROM principal_links WHERE provider = ? AND subject = ?",
        input.provider, input.subject,
      );
      if (request["consumed_at"] !== null) {
        return linked !== undefined && String(linked["actor_id"]) === targetActorId
          ? value({ applied: false, actorId: targetActorId })
          : failure("unauthenticated", "activation is not usable");
      }
      if (request["revoked_at"] !== null || at >= Number(request["expires_at"])) {
        return failure("unauthenticated", "activation is not usable");
      }
      const actor = this.actor(targetActorId);
      if (actor === undefined || actor.disabled) return failure("unauthenticated", "activation is not usable");
      if (linked !== undefined && String(linked["actor_id"]) !== targetActorId) {
        return failure("denied", "the principal is already linked to another actor");
      }
      const other = this.one("SELECT 1 AS present FROM principal_links WHERE actor_id = ? LIMIT 1", targetActorId);
      if (other !== undefined) return failure("unauthenticated", "activation is not usable");
      if (linked === undefined) {
        this.ctx.storage.sql.exec(
          "INSERT INTO principal_links (provider, subject, actor_id, created_at) VALUES (?, ?, ?, ?)",
          input.provider, input.subject, targetActorId, at,
        );
      }
      this.ctx.storage.sql.exec("UPDATE activation_requests SET consumed_at = ? WHERE secret_hash = ?", at, input.secretHash);
      this.audit("activation", `activation for actor ${targetActorId} accepted`, at);
      return value({ applied: true, actorId: targetActorId });
    });
  }

  private revokeActivation(input: RecoveryInput): Result<{ applied: boolean }> {
    const at = now();
    const payload = payloadOf({ kind: "revoke-activation", actorId: input.actorId });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      if (!input.operator && !this.isAdmin(input.byActorId)) {
        return failure("denied", "the caller does not administer this organization");
      }
      if (this.actor(input.actorId) === undefined) return failure("invalid-command", "unknown actor");
      this.ctx.storage.sql.exec(
        "UPDATE activation_requests SET revoked_at = ? WHERE actor_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?",
        at, input.actorId, at,
      );
      this.audit(input.operator ? "operator" : input.byActorId, `activation for actor ${input.actorId} revoked`, at);
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true });
    });
  }

  private unlinkPrincipal(input: RecoveryInput): Result<{ applied: boolean }> {
    const at = now();
    const payload = payloadOf({ kind: "unlink-principal", actorId: input.actorId });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      if (!input.operator && !this.isAdmin(input.byActorId)) {
        return failure("denied", "the caller does not administer this organization");
      }
      if (this.actor(input.actorId) === undefined) return failure("invalid-command", "unknown actor");
      this.ctx.storage.sql.exec("DELETE FROM principal_links WHERE actor_id = ?", input.actorId);
      this.ctx.storage.sql.exec(
        "UPDATE activation_requests SET revoked_at = ? WHERE actor_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?",
        at, input.actorId, at,
      );
      this.outbox("actor-unlinked", "*", {
        kind: "actor-unlinked", organizationId: this.organizationId(), actorId: input.actorId,
      }, at);
      this.audit(input.operator ? "operator" : input.byActorId, `principal links for actor ${input.actorId} removed`, at);
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true });
    });
  }

  private invite(invitationId: string, operationId: string): Result<{ invitationId: string }> {
    if (this.organizationId() === undefined) return failure("unavailable", "organization is not bootstrapped");
    const at = now();
    return this.ctx.storage.transactionSync(() => {
      const existing = this.one(
        "SELECT 1 AS present FROM invitations WHERE invitation_id = ?",
        invitationId,
      );
      if (existing !== undefined) return value({ invitationId });
      this.ctx.storage.sql.exec(
        "INSERT INTO invitations (invitation_id, operation_id, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)",
        invitationId,
        operationId,
        at,
        at,
      );
      this.audit("operation", `invitation ${invitationId} received for ${operationId}`, at);
      return value({ invitationId });
    });
  }

  private accept(input: AcceptInput): Result<{ applied: boolean; invitationId?: string }> {
    const at = now();
    const payload = payloadOf({
      kind: "participation-accept",
      operationId: input.operationId,
      actorId: input.actorId,
    });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      if (!this.isAdmin(input.actorId)) return failure("denied", "the caller does not administer this organization");
      const actor = this.actor(input.actorId);
      if (actor === undefined) return failure("unauthenticated", "unknown actor");
      if (actor.disabled) return failure("not-admitted", "actor disabled");
      const invitation = this.one(
        "SELECT invitation_id FROM invitations WHERE operation_id = ? AND status = 'pending' ORDER BY created_at LIMIT 1",
        input.operationId,
      );
      if (invitation === undefined) return failure("denied", "no pending invitation for this operation");
      const invitationId = String(invitation["invitation_id"]);
      this.ctx.storage.sql.exec(
        "UPDATE invitations SET status = 'accepted', updated_at = ? WHERE invitation_id = ?",
        at,
        invitationId,
      );
      this.outbox(
        "acceptance",
        input.operationId,
        {
          kind: "acceptance",
          invitationId,
          organizationId: this.organizationId(),
          operationId: input.operationId,
        },
        at,
      );
      // Acceptance is the moment the operation gains a roster to project:
      // it sends the image alongside the acceptance so the operation does
      // not have to wait for its own reconciliation to decide anything.
      this.pushRoster(at);
      this.audit(input.actorId, `invitation ${invitationId} accepted`, at);
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true, invitationId });
    });
  }

  private revoke(input: RevokeInput): Result<{ applied: boolean }> {
    const at = now();
    const payload = payloadOf({
      kind: "participation-revoke",
      operationId: input.operationId,
      actorId: input.actorId,
    });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      if (!this.isAdmin(input.actorId)) return failure("denied", "the caller does not administer this organization");
      const invitation = this.one(
        "SELECT invitation_id FROM invitations WHERE operation_id = ? AND status IN ('pending', 'accepted') ORDER BY created_at LIMIT 1",
        input.operationId,
      );
      if (invitation === undefined) return failure("denied", "no invitation to revoke");
      const invitationId = String(invitation["invitation_id"]);
      this.ctx.storage.sql.exec(
        "UPDATE invitations SET status = 'revoked', updated_at = ? WHERE invitation_id = ?",
        at,
        invitationId,
      );
      this.outbox(
        "participation-revoked",
        input.operationId,
        {
          kind: "participation-revoked",
          organizationId: this.organizationId(),
          operationId: input.operationId,
        },
        at,
      );
      this.audit(input.actorId, `participation in ${input.operationId} revoked`, at);
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true });
    });
  }

  private disable(input: DisableInput): Result<{ applied: boolean }> {
    const at = now();
    const payload = payloadOf({
      kind: "disable-actor",
      actorId: input.actorId,
      byActorId: input.byActorId,
    });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      if (!this.isAdmin(input.byActorId)) return failure("denied", "the caller does not administer this organization");
      const target = this.actor(input.actorId);
      if (target === undefined) return failure("unauthenticated", "unknown actor");
      this.ctx.storage.sql.exec(
        "UPDATE actors SET disabled = 1, updated_at = ? WHERE actor_id = ?",
        at,
        input.actorId,
      );
      this.ctx.storage.sql.exec(
        "UPDATE activation_requests SET revoked_at = ? WHERE actor_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?",
        at, input.actorId, at,
      );
      this.outbox(
        "actor-disabled",
        "*",
        {
          kind: "actor-disabled",
          organizationId: this.organizationId(),
          actorId: input.actorId,
        },
        at,
      );
      // `actor-disabled` revokes the refresh records; the roster image is
      // what makes the operation's own decisions see the disable. Both
      // travel, because they do different work.
      this.pushRoster(at);
      this.audit(input.byActorId, `actor ${input.actorId} disabled`, at);
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true });
    });
  }

  private createActor(input: CreateActorInput): Result<{ applied: boolean }> {
    const at = now();
    const payload = payloadOf({
      kind: "create-actor",
      actorId: input.actorId,
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      byActorId: input.byActorId,
    });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      if (!this.isAdmin(input.byActorId)) return failure("denied", "the caller does not administer this organization");
      if (input.actorId.trim().length === 0) return failure("invalid-command", "actor id is empty");
      if (input.actorId.length > 128) return failure("invalid-command", "actor id is too long");
      const nameFailure = this.displayNameFailure(input.displayName);
      if (nameFailure !== undefined) return nameFailure;
      if (this.actor(input.actorId) !== undefined) return failure("invalid-command", "actor already exists");
      this.ctx.storage.sql.exec(
        "INSERT INTO actors (actor_id, display_name, disabled, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
        input.actorId,
        input.displayName ?? null,
        at,
        at,
      );
      // the operation projection decides with existence and disabled state, so
      // a new actor must reach it; no display name travels in the roster
      this.pushRoster(at);
      this.audit(input.byActorId, `actor ${input.actorId} created`, at);
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true });
    });
  }

  private updateActor(input: UpdateActorInput): Result<{ applied: boolean }> {
    const at = now();
    const payload = payloadOf({
      kind: "update-actor",
      actorId: input.actorId,
      displayName: input.displayName,
      byActorId: input.byActorId,
    });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      if (!this.isAdmin(input.byActorId)) return failure("denied", "the caller does not administer this organization");
      const nameFailure = this.displayNameFailure(input.displayName);
      if (nameFailure !== undefined) return nameFailure;
      const target = this.actor(input.actorId);
      if (target === undefined) return failure("invalid-command", "unknown actor");
      const changed = (target.displayName ?? null) !== input.displayName;
      if (changed) {
        this.ctx.storage.sql.exec(
          "UPDATE actors SET display_name = ?, updated_at = ? WHERE actor_id = ?",
          input.displayName,
          at,
          input.actorId,
        );
        this.audit(input.byActorId, `actor ${input.actorId} display name updated`, at);
      }
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true });
    });
  }

  private appointAdministrator(input: AdministratorInput): Result<{ applied: boolean }> {
    const at = now();
    const payload = payloadOf({
      kind: "appoint-administrator",
      actorId: input.actorId,
      byActorId: input.byActorId,
    });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      if (!this.isAdmin(input.byActorId)) return failure("denied", "the caller does not administer this organization");
      const target = this.actor(input.actorId);
      if (target === undefined) return failure("invalid-command", "unknown actor");
      if (target.disabled) return failure("not-admitted", "actor disabled");
      if (!this.isAdmin(input.actorId)) {
        this.ctx.storage.sql.exec(
          "INSERT OR IGNORE INTO org_admins (actor_id, created_at) VALUES (?, ?)",
          input.actorId,
          at,
        );
        this.audit(input.byActorId, `actor ${input.actorId} appointed administrator`, at);
      }
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true });
    });
  }

  private retireAdministrator(input: AdministratorInput): Result<{ applied: boolean }> {
    const at = now();
    const payload = payloadOf({
      kind: "retire-administrator",
      actorId: input.actorId,
      byActorId: input.byActorId,
    });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      if (!this.isAdmin(input.byActorId)) return failure("denied", "the caller does not administer this organization");
      const target = this.actor(input.actorId);
      if (target === undefined) return failure("invalid-command", "unknown actor");
      if (!this.isAdmin(input.actorId)) {
        this.claim(input.idempotencyKey, payload, at);
        return value({ applied: true });
      }
      // the usable successor: another administrator, enabled, and linked —
      // checked inside the same transaction as the removal
      const usable = this.one(
        `SELECT o.actor_id FROM org_admins o JOIN actors a ON a.actor_id = o.actor_id
          WHERE o.actor_id <> ? AND a.disabled = 0
            AND EXISTS (SELECT 1 FROM principal_links l WHERE l.actor_id = o.actor_id)
          LIMIT 1`,
        input.actorId,
      );
      if (usable === undefined) return failure("denied", "no other usable administrator remains");
      this.ctx.storage.sql.exec("DELETE FROM org_admins WHERE actor_id = ?", input.actorId);
      this.audit(input.byActorId, `actor ${input.actorId} retired as administrator`, at);
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true });
    });
  }

  private status(): Record<string, unknown> {
    const organizationId = this.organizationId();
    const organization = organizationId === undefined
      ? undefined
      : this.one("SELECT display_name, sealed_idp_config FROM organization WHERE organization_id = ?", organizationId);
    const count = (table: string): number => Number(this.one(`SELECT COUNT(*) AS n FROM ${table}`)?.["n"] ?? 0);
    return {
      schemaVersion: String(this.one("SELECT value FROM meta WHERE key = 'schema_version'")?.["value"] ?? "0"),
      organizationId: organizationId ?? null,
      displayName: organization?.["display_name"] ?? null,
      hasSealedIdpConfig: organization?.["sealed_idp_config"] !== null && organization?.["sealed_idp_config"] !== undefined,
      actors: count("actors"),
      invitations: count("invitations"),
      outbox: count("outbox") - Number(this.one("SELECT COUNT(*) AS n FROM outbox WHERE delivered_at IS NOT NULL")?.["n"] ?? 0),
      audit: count("audit"),
    };
  }

  private auditRows(): readonly Record<string, unknown>[] {
    return this.rows("SELECT seq, at, actor, fact FROM audit ORDER BY seq").map((row) => ({
      seq: Number(row["seq"]),
      at: Number(row["at"]),
      actor: String(row["actor"]),
      fact: String(row["fact"]),
    }));
  }

  private outboxRows(): readonly Record<string, unknown>[] {
    return this.rows(
      "SELECT id, kind, target, payload, created_at FROM outbox WHERE delivered_at IS NULL ORDER BY created_at, id",
    ).map((row) => ({
      id: String(row["id"]),
      kind: String(row["kind"]),
      target: String(row["target"]),
      payload: JSON.parse(String(row["payload"])) as unknown,
      createdAt: Number(row["created_at"]),
    }));
  }

  private markDelivered(id: string): Result<{ delivered: boolean }> {
    const at = now();
    const existing = this.one("SELECT delivered_at FROM outbox WHERE id = ?", id);
    if (existing === undefined) return failure("wrong-binding", "unknown outbox message");
    if (existing["delivered_at"] === null) {
      this.ctx.storage.sql.exec("UPDATE outbox SET delivered_at = ? WHERE id = ?", at, id);
    }
    return value({ delivered: true });
  }

  /** Deliver queued messages to operation authority. A failure leaves the
   * message pending and schedules a retry; the operation's `/intake` is the
   * only receiver. */
  private async drain(): Promise<{ delivered: number; pending: number }> {
    let delivered = 0;
    for (const message of this.outboxRows()) {
      const kind = String(message["kind"]);
      const payload = message["payload"] as Record<string, unknown>;
      const targets = FAN_OUT_KINDS.has(kind)
        ? [...new Set(this.rows("SELECT DISTINCT operation_id FROM invitations").map((row) => String(row["operation_id"])))]
        : [String(message["target"])];
      let ok = true;
      for (const target of targets) {
        if (target.length === 0) continue;
        const stub = this.env.OPERATION.get(this.env.OPERATION.idFromName(target));
        const response = await stub.fetch("https://operation.internal/intake", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, messageId: String(message["id"]) }),
        });
        if (!response.ok) ok = false;
      }
      if (ok) {
        this.markDelivered(String(message["id"]));
        delivered += 1;
      }
    }
    const pending = this.outboxRows().length;
    if (pending > 0) await this.ctx.storage.setAlarm(Date.now() + 1000);
    return { delivered, pending };
  }

  private exportSnapshot(): ExportSnapshot {
    return {
      schemaVersion: String(this.one("SELECT value FROM meta WHERE key = 'schema_version'")?.["value"] ?? "0"),
      coordinator: "organization",
      tables: readTables(this.ctx.storage.sql, organizationTables),
    };
  }

  private restoreSnapshot(input: unknown): Result<{ restored: boolean }> {
    if (typeof input !== "object" || input === null) return failure("invalid-command", "snapshot must be an object");
    const snapshot = input as Partial<ExportSnapshot>;
    if (snapshot.coordinator !== "organization") return failure("invalid-command", "snapshot is not organization state");
    const version = String(this.one("SELECT value FROM meta WHERE key = 'schema_version'")?.["value"] ?? "0");
    if (snapshot.schemaVersion !== version && snapshot.schemaVersion !== "1") {
      return failure("invalid-command", "snapshot schema version does not match");
    }
    if (typeof snapshot.tables !== "object" || snapshot.tables === null) return failure("invalid-command", "snapshot has no tables");
    this.ctx.storage.transactionSync(() => {
      restoreTables(
        this.ctx.storage.sql,
        organizationTables,
        snapshot.tables as Readonly<Record<string, readonly StateRow[]>>,
      );
    });
    return value({ restored: true });
  }

  override async alarm(): Promise<void> {
    await this.drain();
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const json = (body: unknown, status = 200): Response =>
      Response.json(body, { status });
    const readBody = async (): Promise<Record<string, unknown>> => asRecord(await request.json());

    try {
      if (request.method === "POST" && url.pathname === "/bootstrap") {
        const body = await readBody();
        const input: BootstrapInput = {
          organizationId: asString(body["organizationId"], "organizationId"),
          ...(body["displayName"] === undefined ? {} : { displayName: asString(body["displayName"], "displayName") }),
          actors: asArray(body["actors"], "actors").map((entry) => {
            const actor = asRecord(entry);
            return {
              actorId: asString(actor["actorId"], "actorId"),
              ...(actor["displayName"] === undefined ? {} : { displayName: asString(actor["displayName"], "displayName") }),
              ...(actor["disabled"] === true ? { disabled: true } : {}),
            };
          }),
          principalLinks: asArray(body["principalLinks"], "principalLinks").map((entry) => {
            const link = asRecord(entry);
            return {
              provider: asString(link["provider"], "provider"),
              subject: asString(link["subject"], "subject"),
              actorId: asString(link["actorId"], "actorId"),
            };
          }),
          orgAdmins: asArray(body["orgAdmins"], "orgAdmins").map((entry) => asString(entry, "orgAdmins entry")),
          ...(body["sealedIdpConfig"] === undefined ? {} : { sealedIdpConfig: asString(body["sealedIdpConfig"], "sealedIdpConfig") }),
        };
        return json(this.bootstrap(input));
      }

      if (request.method === "GET" && url.pathname === "/resolve") {
        return json(this.resolve(
          asString(url.searchParams.get("provider"), "provider"),
          asString(url.searchParams.get("subject"), "subject"),
        ));
      }

      if (request.method === "GET" && url.pathname === "/principal-links") {
        return json(value({ links: this.principalLinks() }));
      }

      if (request.method === "POST" && url.pathname === "/principal-link") {
        const body = await readBody();
        const result = this.linkPrincipal({
          provider: asString(body["provider"], "provider"),
          subject: asString(body["subject"], "subject"),
          actorId: asString(body["actorId"], "actorId"),
        });
        return json(result, result.ok ? 200 : result.failure.kind === "unavailable" ? 503 : 400);
      }

      if (request.method === "POST" && url.pathname === "/activation-request") {
        const body = await request.json();
        const input = asRecord(body);
        return json(this.activationRequest({
          actorId: asString(input["actorId"], "actorId"),
          byActorId: asString(input["byActorId"], "byActorId"),
          secretHash: asString(input["secretHash"], "secretHash"),
          ...(input["operator"] === true ? { operator: true } : {}),
        }));
      }

      if (request.method === "POST" && url.pathname === "/activation-inspect") {
        const body = asRecord(await request.json());
        return json(this.activationInspect(asString(body["secretHash"], "secretHash")));
      }

      if (request.method === "POST" && url.pathname === "/activation-preflight") {
        const body = asRecord(await request.json());
        return json(this.activationPreflight({
          secretHash: asString(body["secretHash"], "secretHash"),
          provider: asString(body["provider"], "provider"),
          subject: asString(body["subject"], "subject"),
        }));
      }

      if (request.method === "POST" && url.pathname === "/activation-accept") {
        const body = asRecord(await request.json());
        return json(this.activationAccept({
          secretHash: asString(body["secretHash"], "secretHash"),
          provider: asString(body["provider"], "provider"),
          subject: asString(body["subject"], "subject"),
        }));
      }

      if (request.method === "POST" && (url.pathname === "/revoke-activation" || url.pathname === "/unlink-principal")) {
        const body = asRecord(await request.json());
        const input: RecoveryInput = {
          actorId: asString(body["actorId"], "actorId"),
          byActorId: asString(body["byActorId"], "byActorId"),
          idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
          ...(body["operator"] === true ? { operator: true } : {}),
        };
        return json(url.pathname === "/revoke-activation"
          ? this.revokeActivation(input)
          : this.unlinkPrincipal(input));
      }

      if (request.method === "POST" && url.pathname === "/invite") {
        const body = await readBody();
        return json(this.invite(
          asString(body["invitationId"], "invitationId"),
          asString(body["operationId"], "operationId"),
        ));
      }

      if (request.method === "POST" && url.pathname === "/intake") {
        const body = await readBody();
        const kind = asString(body["kind"], "kind");
        if (kind === "invitation") {
          const result = this.invite(
            asString(body["invitationId"], "invitationId"),
            asString(body["operationId"], "operationId"),
          );
          return json(result, result.ok ? 200 : 503);
        }
        if (kind === "participation-revoked") {
          const operationId = asString(body["operationId"], "operationId");
          const at = now();
          return json(this.ctx.storage.transactionSync(() => {
            this.ctx.storage.sql.exec(
              "UPDATE invitations SET status = 'revoked', updated_at = ? WHERE operation_id = ? AND status IN ('pending', 'accepted')",
              at,
              operationId,
            );
            this.audit("operation", `participation in ${operationId} revoked by operation`, at);
            return value({ applied: true });
          }));
        }
        return json(failure("invalid-command", `unknown intake kind ${kind}`), 400);
      }

      if (request.method === "POST" && url.pathname === "/drain") {
        return json(value(await this.drain()));
      }

      if (request.method === "POST" && url.pathname === "/accept") {
        const body = await readBody();
        return json(this.accept({
          operationId: asString(body["operationId"], "operationId"),
          actorId: asString(body["actorId"], "actorId"),
          idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
        }));
      }

      if (request.method === "POST" && url.pathname === "/revoke") {
        const body = await readBody();
        return json(this.revoke({
          operationId: asString(body["operationId"], "operationId"),
          actorId: asString(body["actorId"], "actorId"),
          idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
        }));
      }

      if (request.method === "POST" && url.pathname === "/disable") {
        const body = await readBody();
        return json(this.disable({
          actorId: asString(body["actorId"], "actorId"),
          byActorId: asString(body["byActorId"], "byActorId"),
          idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
        }));
      }

      if (request.method === "POST" && url.pathname === "/create-actor") {
        const body = await readBody();
        return json(this.createActor({
          actorId: asString(body["actorId"], "actorId"),
          ...(body["displayName"] === undefined ? {} : { displayName: asString(body["displayName"], "displayName") }),
          byActorId: asString(body["byActorId"], "byActorId"),
          idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
        }));
      }

      if (request.method === "POST" && url.pathname === "/update-actor") {
        const body = await readBody();
        return json(this.updateActor({
          actorId: asString(body["actorId"], "actorId"),
          displayName: body["displayName"] === null ? null : asString(body["displayName"], "displayName"),
          byActorId: asString(body["byActorId"], "byActorId"),
          idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
        }));
      }

      if (request.method === "POST" && (url.pathname === "/appoint-administrator" || url.pathname === "/retire-administrator")) {
        const body = await readBody();
        const input: AdministratorInput = {
          actorId: asString(body["actorId"], "actorId"),
          byActorId: asString(body["byActorId"], "byActorId"),
          idempotencyKey: asString(body["idempotencyKey"], "idempotencyKey"),
        };
        return json(url.pathname === "/appoint-administrator"
          ? this.appointAdministrator(input)
          : this.retireAdministrator(input));
      }

      if (request.method === "GET" && url.pathname === "/admin") {
        const actorId = asString(url.searchParams.get("actorId"), "actorId");
        return json(value({ admin: this.isAdmin(actorId) }));
      }

      if (request.method === "GET" && url.pathname === "/actor") {
        const actorId = asString(url.searchParams.get("actorId"), "actorId");
        const actor = this.actor(actorId);
        return actor === undefined
          ? json(failure("unauthenticated", "unknown actor"), 404)
          : json(value({
              ...actor,
              linked: this.one("SELECT 1 AS present FROM principal_links WHERE actor_id = ? LIMIT 1", actorId) !== undefined,
            }));
      }

      if (request.method === "GET" && url.pathname === "/roster") {
        // the reconciliation direction: an operation pulls this to repair a
        // roster push that never arrived
        return json(value({
          organizationId: this.organizationId() ?? null,
          actors: this.roster(),
        }));
      }

      if (request.method === "GET" && url.pathname === "/idp-config") {
        // the sealed provider configuration, for the runtime's exchange —
        // internal surface only (the coordinator is reachable solely through
        // the Worker), and parsed by the runtime, never here
        const row = this.one(
          "SELECT sealed_idp_config FROM organization LIMIT 1",
        );
        return json(value({
          present: row !== undefined && row["sealed_idp_config"] !== null,
          ...(row !== undefined && row["sealed_idp_config"] !== null
            ? { config: String(row["sealed_idp_config"]) }
            : {}),
        }));
      }

      if (request.method === "GET" && url.pathname === "/organization") {
        const organizationId = this.organizationId();
        const organization = organizationId === undefined
          ? undefined
          : this.one("SELECT display_name FROM organization WHERE organization_id = ?", organizationId);
        return json(value({
          organizationId: organizationId ?? null,
          displayName: organization?.["display_name"] ?? null,
        }));
      }

      if (request.method === "POST" && url.pathname === "/reset") {
        for (const table of ["organization", "actors", "principal_links", "activation_requests", "org_admins", "invitations", "audit", "claims", "outbox"]) {
          this.ctx.storage.sql.exec(`DELETE FROM ${table}`);
        }
        return json(value({ reset: true }));
      }

      if (request.method === "GET" && url.pathname === "/status") {
        return json(value(this.status()));
      }

      if (request.method === "GET" && url.pathname === "/export") {
        return json(value(this.exportSnapshot()));
      }

      if (request.method === "POST" && url.pathname === "/restore") {
        return json(this.restoreSnapshot(await request.json()));
      }

      if (request.method === "GET" && url.pathname === "/audit") {
        return json(value(this.auditRows()));
      }

      if (request.method === "GET" && url.pathname === "/outbox") {
        return json(value(this.outboxRows()));
      }

      const delivered = /^\/outbox\/([^/]+)\/delivered$/.exec(url.pathname);
      if (request.method === "POST" && delivered !== null) {
        return json(this.markDelivered(decodeURIComponent(delivered[1] ?? "")));
      }

      return json(failure("wrong-binding", "unknown organization route"), 404);
    } catch (error) {
      return json(failure("invalid-command", error instanceof Error ? error.message : "invalid request"), 400);
    }
  }
}
