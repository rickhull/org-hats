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
  OUTBOX_DELIVERED_RETENTION_SECONDS,
  OUTBOX_DRAIN_LIMIT,
  type ExportSnapshot,
  type StateRow,
} from "./state";
import { initializeOrganizationSchema, ORGANIZATION_SCHEMA_VERSION } from "./schema/organization";
import { displayLabelFailure, identifierFailure } from "./validation";
import { handleOrganizationRequest } from "./http/organization";

/** One organization authority. The object owns the facts that stay stable
 * while the organization participates in several operations: actors,
 * verified-principal links, organization administrators, the organization's
 * side of invitations, audit, idempotency claims, and its outbox. */

type Row = Record<string, string | number | null>;

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

export interface BootstrapInput {
  readonly organizationId: string;
  readonly longName?: string;
  /** The short display label, presentation only and never an address. */
  readonly shortName?: string;
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

export interface AcceptInput {
  readonly operationId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
}

export interface RevokeInput extends AcceptInput {}

export interface DisableInput {
  readonly actorId: string;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

export interface ActivationRequestInput {
  readonly actorId: string;
  readonly byActorId: string;
  readonly secretHash: string;
  readonly operator?: boolean;
  /** Attribution only, never authorization: the identity the ops caller
   * claimed, recorded in place of the bare literal `operator`. */
  readonly operatorId?: string;
}

export interface ActivationAcceptInput {
  readonly secretHash: string;
  readonly provider: string;
  readonly subject: string;
}

export interface RecoveryInput {
  readonly actorId: string;
  readonly byActorId: string;
  readonly idempotencyKey: string;
  readonly operator?: boolean;
  /** Attribution only, never authorization. */
  readonly operatorId?: string;
}

export interface CreateActorInput {
  readonly actorId: string;
  readonly displayName?: string;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

export interface UpdateActorInput {
  readonly actorId: string;
  /** `null` clears the display name; the field is required so a retry cannot
   * change shape between absent and null. */
  readonly displayName: string | null;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

export interface AdministratorInput {
  readonly actorId: string;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

export class OrganizationAuthority extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    initializeOrganizationSchema(this.ctx.storage.sql);
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

  private outbox(kind: string, target: string, payload: Record<string, unknown>, at: number): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO outbox (id, kind, target, payload, created_at) VALUES (?, ?, ?, ?, ?)",
      `ob-${crypto.randomUUID()}`,
      kind,
      target,
      payloadOf(payload),
      at,
    );
  }

  /** A fact every participating operation must learn, enqueued as one
   * addressed row per operation rather than one row resolved at delivery.
   *
   * Resolving targets in the drain made a single row cost one subrequest per
   * operation, so the subrequests one invocation issues had no bound. One row
   * per target restores the bound, marks progress per operation — a target
   * that failed no longer forces a redelivery to the ones that succeeded —
   * and matches the portable engine, which has only ever addressed one target
   * per message.
   *
   * The cost is that an operation joining after this returns does not receive
   * this message. Reconciliation is the backstop: the roster pull carries
   * `disabled`, and an unlink that never arrived is still refused by the
   * operation's live organization read on refresh. */
  private outboxFanOut(kind: string, payload: Record<string, unknown>, at: number): void {
    for (const row of this.rows("SELECT DISTINCT operation_id FROM invitations")) {
      const target = String(row["operation_id"]);
      if (target.length === 0) continue;
      this.outbox(kind, target, payload, at);
    }
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
    this.outboxFanOut(
      "roster",
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
    // Checked before the transaction, by the same rule the command paths
    // use: a refused label never persists and leaves the organization
    // unbootstrapped rather than half-named.
    for (const [value, label] of [
      [input.longName, "organization long name"],
      [input.shortName, "organization short name"],
    ] as const) {
      const nameFailure = displayLabelFailure(value, label);
      if (nameFailure !== undefined) return { ok: false, failure: nameFailure };
    }
    for (const actor of input.actors) {
      const nameFailure = displayLabelFailure(actor.displayName, `actor ${actor.actorId} display name`);
      if (nameFailure !== undefined) return { ok: false, failure: nameFailure };
    }
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
          (organization_id, display_name, short_name, sealed_idp_config, sealed_idp_config_updated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(organization_id) DO UPDATE SET
           display_name = excluded.display_name,
           short_name = excluded.short_name,
           sealed_idp_config = COALESCE(excluded.sealed_idp_config, organization.sealed_idp_config),
           sealed_idp_config_updated_at = COALESCE(excluded.sealed_idp_config_updated_at, organization.sealed_idp_config_updated_at),
           updated_at = excluded.updated_at`,
        input.organizationId,
        input.longName ?? null,
        input.shortName ?? null,
        input.sealedIdpConfig ?? null,
        input.sealedIdpConfig === undefined ? null : at,
        at,
        at,
      );
      // Bootstrap seeds; it does not overwrite a roster fact the organization
      // now owns. A re-bootstrap adds unknown actors and leaves known ones
      // alone: it cannot revert a rename or re-enable a disabled actor.
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
      // Standing is a seed of creation, not a live writer. Once the
      // organization exists, its own appoint and retire commands own
      // standing; a re-bootstrap that names an administrator — including one
      // the organization retired — adds none. Retirement deletes the row, so
      // an idempotent insert here would silently undo it.
      if (existing === undefined) {
        for (const admin of input.orgAdmins) {
          this.ctx.storage.sql.exec(
            "INSERT OR IGNORE INTO org_admins (actor_id, created_at) VALUES (?, ?)",
            admin,
            at,
          );
        }
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
      this.audit(input.operator ? (input.operatorId ?? "operator") : input.byActorId, `activation for actor ${input.actorId} issued`, at);
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
      this.audit(input.operator ? (input.operatorId ?? "operator") : input.byActorId, `activation for actor ${input.actorId} revoked`, at);
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
      // the identity reset takes the local credentials with the links: a
      // stored key whose principal link is gone could never log in again,
      // and keeping it would leave recovery half-done
      this.ctx.storage.sql.exec("DELETE FROM credentials WHERE actor_id = ?", input.actorId);
      this.ctx.storage.sql.exec(
        "UPDATE activation_requests SET revoked_at = ? WHERE actor_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?",
        at, input.actorId, at,
      );
      this.outboxFanOut("actor-unlinked", {
        kind: "actor-unlinked", organizationId: this.organizationId(), actorId: input.actorId,
      }, at);
      this.audit(input.operator ? (input.operatorId ?? "operator") : input.byActorId, `principal links for actor ${input.actorId} removed`, at);
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
      this.outboxFanOut(
        "actor-disabled",
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
      const idFailure = identifierFailure(input.actorId, "actor id");
      if (idFailure !== undefined) return { ok: false, failure: idFailure };
      const nameFailure = displayLabelFailure(input.displayName);
      if (nameFailure !== undefined) return { ok: false, failure: nameFailure };
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
      const nameFailure = displayLabelFailure(input.displayName);
      if (nameFailure !== undefined) return { ok: false, failure: nameFailure };
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

  private intakeParticipationRevoked(operationId: string): Result<{ applied: boolean }> {
    const at = now();
    return this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE invitations SET status = 'revoked', updated_at = ? WHERE operation_id = ? AND status IN ('pending', 'accepted')",
        at,
        operationId,
      );
      this.audit("operation", `participation in ${operationId} revoked by operation`, at);
      return value({ applied: true });
    });
  }

  private actorView(actorId: string): {
    readonly actorId: string;
    readonly displayName?: string;
    readonly disabled: boolean;
    readonly linked: boolean;
    /** Administrator standing, live: presentation for hiding a surface,
     * never an authorization — commands check it at the handler. */
    readonly administrator: boolean;
  } | undefined {
    const actor = this.actor(actorId);
    if (actor === undefined) return undefined;
    return {
      ...actor,
      linked: this.one("SELECT 1 AS present FROM principal_links WHERE actor_id = ? LIMIT 1", actorId) !== undefined,
      administrator: this.isAdmin(actorId),
    };
  }

  /** The organization's own actor directory, names included: this is the
   * organization's state read by its administrator through the runtime's
   * roster gate, not the nameless projection image the operation pulls. */
  private actorDirectory(): readonly {
    readonly actorId: string;
    readonly displayName?: string;
    readonly disabled: boolean;
  }[] {
    return this.rows("SELECT actor_id, display_name, disabled FROM actors ORDER BY actor_id").map((row) => ({
      actorId: row.actor_id as string,
      ...(row.display_name === null || row.display_name === undefined ? {} : { displayName: row.display_name as string }),
      disabled: row.disabled === 1,
    }));
  }

  private rosterView(): {
    readonly organizationId: string | null;
    readonly actors: readonly { readonly actorId: string; readonly disabled: boolean }[];
  } {
    return {
      organizationId: this.organizationId() ?? null,
      actors: this.roster(),
    };
  }

  private idpConfig(): { readonly present: boolean; readonly config?: string } {
    const row = this.one("SELECT sealed_idp_config FROM organization LIMIT 1");
    return {
      present: row !== undefined && row["sealed_idp_config"] !== null,
      ...(row !== undefined && row["sealed_idp_config"] !== null
        ? { config: String(row["sealed_idp_config"]) }
        : {}),
    };
  }

  private organizationSummary(): { readonly organizationId: string | null; readonly longName: string | null } {
    const organizationId = this.organizationId();
    const organization = organizationId === undefined
      ? undefined
      : this.one("SELECT display_name FROM organization WHERE organization_id = ?", organizationId);
    const longName = organization?.["display_name"];
    return {
      organizationId: organizationId ?? null,
      longName: longName === undefined || longName === null ? null : String(longName),
    };
  }

  private reset(): Result<{ reset: true }> {
    for (const table of ["organization", "actors", "principal_links", "activation_requests", "org_admins", "invitations", "audit", "claims", "outbox"]) {
      this.ctx.storage.sql.exec(`DELETE FROM ${table}`);
    }
    return value({ reset: true });
  }

  private status(): Record<string, unknown> {
    const organizationId = this.organizationId();
    const organization = organizationId === undefined
      ? undefined
      : this.one("SELECT display_name, short_name, sealed_idp_config FROM organization WHERE organization_id = ?", organizationId);
    const count = (table: string): number => Number(this.one(`SELECT COUNT(*) AS n FROM ${table}`)?.["n"] ?? 0);
    return {
      schemaVersion: String(this.one("SELECT value FROM meta WHERE key = 'schema_version'")?.["value"] ?? "0"),
      organizationId: organizationId ?? null,
      longName: organization?.["display_name"] ?? null,
      shortName: organization?.["short_name"] ?? null,
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

  /** Every pending row, for the operator read and the status count. The cap
   * belongs to the drain, not to reads: a capped read would under-report a
   * backlog, which is the one moment an operator most needs to see it. */
  private outboxRows(): readonly Record<string, unknown>[] {
    return this.outboxSelect("");
  }

  /** The rows one drain may deliver. One row is one coordinator subrequest,
   * so this count is the subrequest bound. */
  private outboxBatch(): readonly Record<string, unknown>[] {
    return this.outboxSelect(`LIMIT ${OUTBOX_DRAIN_LIMIT}`);
  }

  private outboxSelect(limit: string): readonly Record<string, unknown>[] {
    return this.rows(
      `SELECT id, kind, target, payload, created_at FROM outbox WHERE delivered_at IS NULL
         ORDER BY created_at, id ${limit}`,
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
   * only receiver.
   *
   * At most `OUTBOX_DRAIN_LIMIT` rows per invocation. Every row is addressed
   * to one operation — fan-out is expanded at enqueue — so that count is also
   * the subrequest bound, and a backlog larger than the cap drains across
   * invocations on the alarm that already runs rather than failing as one
   * oversized batch. */
  private async drain(): Promise<{ delivered: number; pending: number }> {
    let delivered = 0;
    for (const message of this.outboxBatch()) {
      const target = String(message["target"]);
      if (target.length === 0) continue;
      const payload = message["payload"] as Record<string, unknown>;
      const stub = this.env.OPERATION.get(this.env.OPERATION.idFromName(target));
      const response = await stub.fetch("https://operation.internal/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, messageId: String(message["id"]) }),
      });
      if (response.ok) {
        this.markDelivered(String(message["id"]));
        delivered += 1;
      }
    }
    this.pruneDeliveredOutbox(now());
    const pending = this.pendingOutboxCount();
    if (pending > 0) await this.ctx.storage.setAlarm(Date.now() + 1000);
    return { delivered, pending };
  }

  /** Spent rows leave after `OUTBOX_DELIVERED_RETENTION_SECONDS`. The outbox
   * is otherwise append-only, and expanding fan-out at enqueue multiplies the
   * rows one event retains by the number of participating operations, so the
   * pruning is what keeps that trade neutral. A delivered row is not evidence
   * — the audit trail is — and it is not what makes a retry safe. */
  private pruneDeliveredOutbox(at: number): void {
    this.ctx.storage.sql.exec(
      "DELETE FROM outbox WHERE delivered_at IS NOT NULL AND delivered_at < ?",
      at - OUTBOX_DELIVERED_RETENTION_SECONDS,
    );
  }

  private pendingOutboxCount(): number {
    return Number(this.one("SELECT COUNT(*) AS pending FROM outbox WHERE delivered_at IS NULL")?.["pending"] ?? 0);
  }

  /** Store a local credential's public facts. The COSE key is stored as
   * canonical JSON of the decoded key — the same fields a verifier needs,
   * readable in an export, and never a second CBOR encoding to own. The
   * credential's link to the actor is the ordinary `principal_links` row
   * `(webauthn, credential id)`; this table holds what verification needs,
   * and `unlink-principal` removes it with the link — the documented
   * identity reset. */
  private storeCredential(input: {
    readonly credentialId: string;
    readonly actorId: string;
    readonly key: { readonly alg: string; readonly [field: string]: unknown };
    readonly signCount: number;
    readonly backupEligible: boolean;
    readonly backedUp: boolean;
  }): Result<{ applied: boolean }> {
    const at = now();
    if (this.organizationId() === undefined) return failure("unavailable", "organization is not bootstrapped");
    return this.ctx.storage.transactionSync(() => {
      if (this.actor(input.actorId) === undefined) return failure("invalid-command", "unknown actor");
      const existing = this.one("SELECT actor_id FROM credentials WHERE credential_id = ?", input.credentialId);
      if (existing !== undefined) {
        return failure("invalid-command", "credential id already stored");
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO credentials
         (credential_id, actor_id, alg, key_json, sign_count, backup_eligible, backed_up, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.credentialId,
        input.actorId,
        input.key.alg,
        canonicalJson(input.key as unknown as JsonValue),
        input.signCount,
        input.backupEligible ? 1 : 0,
        input.backedUp ? 1 : 0,
        at,
        at,
      );
      return value({ applied: true });
    });
  }

  private credentialFor(credentialId: string): Result<{
    readonly actorId: string;
    readonly key: { readonly alg: string; readonly [field: string]: unknown };
    readonly signCount: number;
    readonly backupEligible: boolean;
    readonly backedUp: boolean;
  }> {
    const row = this.one(
      "SELECT actor_id, alg, key_json, sign_count, backup_eligible, backed_up FROM credentials WHERE credential_id = ?",
      credentialId,
    );
    if (row === undefined) return failure("unauthenticated", "credential is not registered");
    let key: { alg: string } | undefined;
    try {
      key = JSON.parse(String(row["key_json"])) as { alg: string };
    } catch {
      return failure("unavailable", "credential key is unreadable");
    }
    return value({
      actorId: String(row["actor_id"]),
      key: key as { readonly alg: string; readonly [field: string]: unknown },
      signCount: Number(row["sign_count"]),
      backupEligible: row["backup_eligible"] === 1,
      backedUp: row["backed_up"] === 1,
    });
  }

  /** Record the observed sign counter after a verified assertion. */
  private updateCredentialCounter(credentialId: string, signCount: number): Result<{ applied: boolean }> {
    const existing = this.one("SELECT 1 AS present FROM credentials WHERE credential_id = ?", credentialId);
    if (existing === undefined) return failure("invalid-command", "credential is not registered");
    this.ctx.storage.sql.exec(
      "UPDATE credentials SET sign_count = ?, updated_at = ? WHERE credential_id = ?",
      signCount,
      now(),
      credentialId,
    );
    return value({ applied: true });
  }

  /** Scoped cleanup for one deleted operation: its invitation records,
   * the outbox rows addressed to it, the replay claims whose payloads name
   * it, and the audit facts that reference it. Everything else — actors,
   * principal links, administrator standing, every other operation's
   * history — survives; this is not an organization wipe. Like the
   * operation-side delete it writes no audit row: the retained-nothing
   * contract covers the organization's facts about this operation too, and
   * the operator who ordered the deletion holds the trace. Idempotent. */
  private forgetOperation(operationId: string): Result<{ forgotten: boolean }> {
    return this.ctx.storage.transactionSync(() => {
      // collected before the invitations rows go, so audit facts naming an
      // invitation of this operation are scoped by identity, not by
      // substring that could catch another operation's invitation
      const invitationIds = this.rows(
        "SELECT invitation_id FROM invitations WHERE operation_id = ?",
        operationId,
      ).map((row) => String(row["invitation_id"]));
      this.ctx.storage.sql.exec("DELETE FROM invitations WHERE operation_id = ?", operationId);
      this.ctx.storage.sql.exec("DELETE FROM outbox WHERE target = ?", operationId);
      for (const row of this.rows("SELECT idempotency_key, payload FROM claims")) {
        let payload: unknown;
        try {
          payload = JSON.parse(String(row["payload"]));
        } catch {
          continue;
        }
        if (
          typeof payload === "object" && payload !== null &&
          (payload as { operationId?: unknown }).operationId === operationId
        ) {
          this.ctx.storage.sql.exec(
            "DELETE FROM claims WHERE idempotency_key = ?",
            String(row["idempotency_key"]),
          );
        }
      }
      for (const row of this.rows("SELECT seq, fact FROM audit")) {
        const fact = String(row["fact"]);
        // Suffix-anchored so one operation id cannot match inside another
        // (`op-1` must not catch `op-10`): the trailing word after the id in
        // every fact template is `revoked`, or the id ends the fact.
        const referencesOperation =
          fact.endsWith(` for ${operationId}`) ||
          fact.includes(` in ${operationId} revoked`) ||
          invitationIds.some((invitationId) => fact.startsWith(`invitation ${invitationId} `));
        if (referencesOperation) {
          this.ctx.storage.sql.exec("DELETE FROM audit WHERE seq = ?", Number(row["seq"]));
        }
      }
      return value({ forgotten: true });
    });
  }

  private exportSnapshot(): ExportSnapshot {
    return {
      schemaVersion: String(this.one("SELECT value FROM meta WHERE key = 'schema_version'")?.["value"] ?? "0"),
      coordinator: "organization",
      tables: readTables(this.ctx.storage.sql, organizationTables),
    };
  }

  private restoreSnapshot(input: unknown, operatorId?: string): Result<{ restored: boolean }> {
    if (typeof input !== "object" || input === null) return failure("invalid-command", "snapshot must be an object");
    const snapshot = input as Partial<ExportSnapshot>;
    if (snapshot.coordinator !== "organization") return failure("invalid-command", "snapshot is not organization state");
    // Every schema this coordinator has shipped is restorable, the operation
    // side's rule: `restoreTables` writes the current columns and fills the
    // ones an older export did not carry with null, so an older snapshot is a
    // restore rather than a second bootstrap. An unknown or future version is
    // still refused — a schema bump must not strand an export taken before it.
    const version = String(this.one("SELECT value FROM meta WHERE key = 'schema_version'")?.["value"] ?? "0");
    const supported = new Set(["1", "2", "3", ORGANIZATION_SCHEMA_VERSION, version]);
    if (!supported.has(String(snapshot.schemaVersion))) {
      return failure("invalid-command", "snapshot schema version does not match");
    }
    if (typeof snapshot.tables !== "object" || snapshot.tables === null) return failure("invalid-command", "snapshot has no tables");
    this.ctx.storage.transactionSync(() => {
      restoreTables(
        this.ctx.storage.sql,
        organizationTables,
        snapshot.tables as Readonly<Record<string, readonly StateRow[]>>,
      );
      // After the tables, never before: restore replaces the audit table with
      // the snapshot's rows, so a row written first would be overwritten by
      // the very act it records. This is the one entry that cannot come from
      // the snapshot — a restore otherwise leaves no trace that the most
      // destructive privileged act in the system happened at all.
      this.audit(operatorId ?? "operator", `state restored from a snapshot of schema ${String(snapshot.schemaVersion)}`, now());
    });
    return value({ restored: true });
  }

  override async alarm(): Promise<void> {
    await this.drain();
  }

  override async fetch(request: Request): Promise<Response> {
    return handleOrganizationRequest(request, {
      bootstrap: (input) => this.bootstrap(input),
      actorDirectory: () => this.actorDirectory(),
      resolve: (provider, subject) => this.resolve(provider, subject),
      principalLinks: () => this.principalLinks(),
      linkPrincipal: (input) => this.linkPrincipal(input),
      activationRequest: (input) => this.activationRequest(input),
      activationInspect: (secretHash) => this.activationInspect(secretHash),
      activationPreflight: (input) => this.activationPreflight(input),
      activationAccept: (input) => this.activationAccept(input),
      revokeActivation: (input) => this.revokeActivation(input),
      unlinkPrincipal: (input) => this.unlinkPrincipal(input),
      invite: (invitationId, operationId) => this.invite(invitationId, operationId),
      intakeParticipationRevoked: (operationId) => this.intakeParticipationRevoked(operationId),
      drain: () => this.drain(),
      accept: (input) => this.accept(input),
      revoke: (input) => this.revoke(input),
      disable: (input) => this.disable(input),
      createActor: (input) => this.createActor(input),
      updateActor: (input) => this.updateActor(input),
      appointAdministrator: (input) => this.appointAdministrator(input),
      retireAdministrator: (input) => this.retireAdministrator(input),
      isAdmin: (actorId) => this.isAdmin(actorId),
      actorView: (actorId) => this.actorView(actorId),
      rosterView: () => this.rosterView(),
      idpConfig: () => this.idpConfig(),
      organizationSummary: () => this.organizationSummary(),
      reset: () => this.reset(),
      status: () => this.status(),
      exportSnapshot: () => this.exportSnapshot(),
      forgetOperation: (operationId) => this.forgetOperation(operationId),
      storeCredential: (input) => this.storeCredential(input),
      credentialFor: (credentialId) => this.credentialFor(credentialId),
      updateCredentialCounter: (credentialId, signCount) => this.updateCredentialCounter(credentialId, signCount),
      restoreSnapshot: (input, operatorId) => this.restoreSnapshot(input, operatorId),
      auditRows: () => this.auditRows(),
      outboxRows: () => this.outboxRows(),
      markDelivered: (id) => this.markDelivered(id),
    });
  }
}
