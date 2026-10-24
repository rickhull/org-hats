import { DurableObject } from "cloudflare:workers";
import {
  canonicalJson,
  type FailureKind,
  type JsonValue,
} from "org-hats/authority";
import type { Env } from "./env";

/** One organization authority. The object owns the facts that stay stable
 * while the organization participates in several operations: actors,
 * verified-principal links, organization administrators, the organization's
 * side of invitations, audit, idempotency claims, and its outbox. */
const SCHEMA_VERSION = "1";

type Row = Record<string, string | number | null>;

type Failure = {
  readonly kind: FailureKind;
  readonly detail?: string;
};

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

  private bootstrap(input: BootstrapInput): Result<{ organizationId: string }> {
    const at = now();
    return this.ctx.storage.transactionSync(() => {
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
      for (const actor of input.actors) {
        this.ctx.storage.sql.exec(
          `INSERT INTO actors (actor_id, display_name, disabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(actor_id) DO UPDATE SET
             display_name = excluded.display_name,
             updated_at = excluded.updated_at`,
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

  private invite(invitationId: string, operationId: string): Result<{ invitationId: string }> {
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
      this.audit(input.byActorId, `actor ${input.actorId} disabled`, at);
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

  async fetch(request: Request): Promise<Response> {
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

      if (request.method === "POST" && url.pathname === "/invite") {
        const body = await readBody();
        return json(this.invite(
          asString(body["invitationId"], "invitationId"),
          asString(body["operationId"], "operationId"),
        ));
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

      if (request.method === "GET" && url.pathname === "/status") {
        return json(value(this.status()));
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
