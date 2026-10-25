import { DurableObject } from "cloudflare:workers";
import {
  ACCESS_ENVELOPE_VERSION,
  AUTHORITY_INTERFACE_VERSION,
  actionsOf,
  actorId,
  canonicalJson,
  operationId,
  organizationId,
  siteId,
  teamId,
  validatePolicyBundle,
  type AccessEnvelopeClaimsV1,
  type ActorId,
  type FailureKind,
  type GrantTarget,
  type HatSummary,
  type JsonValue,
  type OperationId,
  type OrganizationId,
  type PolicyBundle,
  type RefreshHandleOutcome,
  type SiteBinding,
  type SiteId,
  type TeamId,
  type Unbranded,
} from "org-hats/authority";
import {
  isHostnameLabel,
  isSitePath,
  readReach,
  transitionParticipation,
  wearableGrants,
  type Grant,
  type Participation,
  type ParticipationEvent,
  type ParticipationTransition,
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
import {
  rowActorId,
  rowFlag,
  rowOperationId,
  rowOrganizationId,
  rowSiteId,
  rowTeamId,
  rowText,
} from "./row";

/** One operation authority. The object owns operation-local facts: sites,
 * teams, grants, participation, policy, refresh records, audit, claims, and
 * the outbox that carries invitations to organization authority. */
const SCHEMA_VERSION = "4";

/** How stale the org-actor projection may get before reconciliation pulls it
 * again. The push channel carries a change immediately; this interval bounds
 * only how long a *dropped* message can go unrepaired, so it is a
 * convergence budget and never the revocation window. */
const ROSTER_RECONCILE_SECONDS = 15 * 60;

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

// The command-handler seam: a request body carries opaque strings, and these
// are where one becomes a domain id. Declared outside the class so the
// coordinator's `organizationId`/`actorId` parameters cannot shadow them.
const asOrganizationId = (input: unknown, field: string): OrganizationId =>
  organizationId(asString(input, field));
const asActorId = (input: unknown, field: string): ActorId => actorId(asString(input, field));
const asOperationId = (input: unknown, field: string): OperationId =>
  operationId(asString(input, field));
const asSiteId = (input: unknown, field: string): SiteId => siteId(asString(input, field));
const asTeamId = (input: unknown, field: string): TeamId => teamId(asString(input, field));

/** A grant target, from a request body. The union is what makes "exactly
 * one target" a parse concern rather than a validation concern: the body
 * either names a team or a site, and anything else never becomes a
 * `GrantTarget` at all. */
const asGrantTarget = (input: unknown, field: string): Unbranded<GrantTarget> => {
  const target = asRecord(input);
  const kind = asString(target["kind"], `${field}.kind`);
  if (kind === "team") return { kind: "team", teamId: asString(target["teamId"], `${field}.teamId`) };
  if (kind === "site") return { kind: "site", siteId: asString(target["siteId"], `${field}.siteId`) };
  throw new Error(`${field}.kind must be "team" or "site"`);
};

/** The three columns a target is stored as: the discriminant and the two
 * nullable id columns. Written once, so the rows cannot disagree with the
 * union. */
const targetColumns = (target: Unbranded<GrantTarget>): readonly [string, string | null, string | null] =>
  target.kind === "team" ? ["team", target.teamId, null] : ["site", null, target.siteId];

interface SiteInput {
  readonly siteId: string;
  readonly displayName?: string;
  /** The canonical one-segment path beneath the operation hostname. */
  readonly path: string;
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
  readonly target: Unbranded<GrantTarget>;
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
  /** The one DNS label naming the operation hostname. */
  readonly slug: string;
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

/** One organization actor as the projection carries it: who they are and
 * whether they are disabled. Nothing else crosses — see `org_actors`. */
interface RosterActor {
  readonly actorId: string;
  readonly disabled: boolean;
}

interface IntakeMessage {
  readonly messageId: string;
  readonly kind: string;
  readonly invitationId?: string;
  readonly organizationId?: string;
  readonly operationId?: string;
  readonly actorId?: string;
  /** A `roster` message carries the organization's whole actor list: the
   * organization is the only writer, so a delivered image is the truth for
   * that organization and applying it is a full replace. */
  readonly actors?: readonly RosterActor[];
  /** When a `roster` image was taken, so a delayed delivery cannot overwrite
   * a newer image. */
  readonly at?: number;
}

interface GrantCommand {
  readonly grantId?: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly role: string;
  readonly target: Unbranded<GrantTarget>;
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

/** A full replace of the operation's routing facts. Every site must be named;
 * a partial set would leave a routing projection with no source. */
interface RoutingFactsInput {
  readonly slug: string;
  readonly sites: readonly { readonly siteId: string; readonly path: string }[];
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
        slug TEXT,
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
        path TEXT,
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
    // The org-actor projection: the authority-relevant tuple of a
    // participating organization's roster, and nothing more. Display names,
    // principal links, and provider configuration stay in the organization
    // object, which is the only writer of any of it — this operation holds a
    // copy solely so a decision it must make is a local, atomic read.
    sql.exec(
      `CREATE TABLE IF NOT EXISTS org_actors (
        organization_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        disabled INTEGER NOT NULL DEFAULT 0,
        synced_at INTEGER NOT NULL,
        PRIMARY KEY (organization_id, actor_id)
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
    // schema 4: operation routing facts (slug and site paths)
    const operationColumns = new Set(
      this.ctx.storage.sql.exec<{ readonly name: string }>("PRAGMA table_info(operation)")
        .toArray()
        .map((column) => String(column.name)),
    );
    if (!operationColumns.has("slug")) sql.exec("ALTER TABLE operation ADD COLUMN slug TEXT");
    const siteColumns = new Set(
      this.ctx.storage.sql.exec<{ readonly name: string }>("PRAGMA table_info(sites)")
        .toArray()
        .map((column) => String(column.name)),
    );
    if (!siteColumns.has("path")) sql.exec("ALTER TABLE sites ADD COLUMN path TEXT");
    // Every migration above is additive and runs unconditionally, so after
    // this constructor the object *is* at the current schema: the recorded
    // version must say so. `INSERT OR IGNORE` alone would leave an object
    // created at an earlier version reporting that version forever while
    // carrying the newer tables and columns.
    sql.exec("UPDATE meta SET value = ? WHERE key = 'schema_version'", SCHEMA_VERSION);
  }

  private rows(query: string, ...bindings: (string | number | null)[]): Row[] {
    return this.ctx.storage.sql.exec<Row>(query, ...bindings).toArray();
  }

  private one(query: string, ...bindings: (string | number | null)[]): Row | undefined {
    return this.rows(query, ...bindings)[0];
  }

  private operationId(): OperationId | undefined {
    const row = this.one("SELECT operation_id FROM operation LIMIT 1");
    return row === undefined ? undefined : rowOperationId(row);
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

  /** Apply a roster image for one organization. A full replace, because the
   * organization owns its roster: an actor the image omits is an actor that
   * no longer exists, and must not survive here.
   *
   * Monotonic in the image's own timestamp, not in arrival order. The outbox
   * delivers a message whose target was briefly unreachable after a later
   * one, so without this an older image could overwrite a newer one and
   * resurrect a disabled actor until the next reconciliation. Returns false
   * when the image was ignored as stale. The caller owns the transaction. */
  private replaceRoster(
    organizationId: string,
    actors: readonly RosterActor[],
    imageAt: number,
    at: number,
  ): boolean {
    const key = `roster_at:${organizationId}`;
    const applied = Number(this.one("SELECT value FROM meta WHERE key = ?", key)?.["value"] ?? 0);
    if (imageAt < applied) return false;
    this.ctx.storage.sql.exec("DELETE FROM org_actors WHERE organization_id = ?", organizationId);
    for (const actor of actors) {
      this.ctx.storage.sql.exec(
        "INSERT INTO org_actors (organization_id, actor_id, disabled, synced_at) VALUES (?, ?, ?, ?)",
        organizationId,
        actor.actorId,
        actor.disabled ? 1 : 0,
        imageAt,
      );
    }
    for (const [metaKey, metaValue] of [[key, imageAt], ["roster_synced_at", at]] as const) {
      this.ctx.storage.sql.exec(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        metaKey,
        String(metaValue),
      );
    }
    return true;
  }

  /** Pull one organization's roster. The reconciliation direction: used to
   * repair a dropped push, never to carry a revocation — it cannot run
   * inside `transactionSync`, which has no `await`. */
  private async pullRoster(organizationId: string): Promise<boolean> {
    const stub = this.env.ORGANIZATION.get(this.env.ORGANIZATION.idFromName(organizationId));
    const response = await stub.fetch("https://organization.internal/roster");
    if (!response.ok) return false;
    const body = (await response.json()) as {
      readonly ok?: boolean;
      readonly value?: { readonly actors?: readonly RosterActor[] };
    };
    const actors = body.value?.actors;
    if (body.ok !== true || actors === undefined) return false;
    const at = now();
    this.ctx.storage.transactionSync(() => {
      // a pull reads the organization's state as it is right now, so its
      // image is current by construction and never loses to a stored stamp
      this.replaceRoster(organizationId, actors, at, at);
    });
    return true;
  }

  /** Reconcile every actively participating organization's roster, at most
   * once per `ROSTER_RECONCILE_SECONDS` unless forced. Convergence after a
   * lost message; the immediate path is the push channel. */
  private async reconcileRosters(force = false): Promise<{ synced: number; organizations: number }> {
    const last = Number(this.one("SELECT value FROM meta WHERE key = 'roster_synced_at'")?.["value"] ?? 0);
    const organizationIds = this.rows(
      "SELECT organization_id FROM participations WHERE status = 'active' ORDER BY organization_id",
    ).map((row) => String(row["organization_id"]));
    if (!force && now() - last < ROSTER_RECONCILE_SECONDS) {
      return { synced: 0, organizations: organizationIds.length };
    }
    let synced = 0;
    for (const organizationId of organizationIds) {
      if (await this.pullRoster(organizationId)) synced += 1;
    }
    return { synced, organizations: organizationIds.length };
  }

  /** Decide a participation move with the portable state machine, against
   * the row as it stands.
   *
   * The same function the in-memory engine routes through — not an adjacent
   * copy of the rule. The `SELECT` supplies `current`, the decision is pure
   * and synchronous, so it runs inside `transactionSync` and the write that
   * follows commits with it. An `UPDATE ... SET status = 'active'` without
   * this is how an acceptance delivered after a revoke flipped `revoked`
   * back: no `CHECK` constraint can express a transition, only a set of
   * legal strings. */
  private participationTransition(organization: string, event: ParticipationEvent): ParticipationTransition {
    const operation = this.operationId();
    if (operation === undefined) return { ok: false, problem: "the operation is not bootstrapped" };
    const organization_ = organizationId(organization);
    const row = this.one("SELECT status FROM participations WHERE organization_id = ?", organization);
    const current: Participation | undefined = row === undefined
      ? undefined
      : {
          organizationId: organization_,
          operationId: operation,
          status: rowText(row, "status") as Participation["status"],
        };
    return transitionParticipation(organization_, operation, current, event);
  }

  private writeParticipation(participation: Participation, at: number): void {
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

  /** Revoke a participation through the state machine. An already-revoked
   * participation is a safe retry — the state the caller asked for is the
   * state that holds — while a participation that was never there is a
   * denial. Idempotency is this adapter's policy; that `revoked` never moves
   * back is the model's. */
  private revokeParticipationRow(
    organizationId: string,
    by: "operation" | "organization",
    at: number,
  ): { readonly ok: true } | { readonly ok: false; readonly problem: string } {
    const row = this.one("SELECT status FROM participations WHERE organization_id = ?", organizationId);
    if (row === undefined) return { ok: false, problem: "the organization is not participating" };
    if (String(row["status"]) === "revoked") return { ok: true };
    const revoked = this.participationTransition(organizationId, { kind: "revoke", by });
    if (!revoked.ok) return { ok: false, problem: revoked.problem };
    this.writeParticipation(revoked.participation, at);
    return { ok: true };
  }

  private bootstrap(input: BootstrapInput): Result<{ operationId: string }> {
    const problems = validatePolicyBundle(input.policy);
    if (problems.length > 0) return failure("invalid-command", problems.join("; "));
    // Routing facts are operation-authority facts. Validate the whole set
    // before opening the transaction: a bootstrap that writes half a
    // hostname namespace is a projection with no source.
    if (!isHostnameLabel(input.slug)) {
      return failure("invalid-command", `operation slug "${input.slug}" must be one DNS label and not www`);
    }
    const paths = new Set<string>();
    const aliases = new Set<string>();
    for (const site of input.sites) {
      if (!isSitePath(site.path)) {
        return failure("invalid-command", `site ${site.siteId} path "${site.path}" must be one segment`);
      }
      if (paths.has(site.path)) {
        return failure("invalid-command", `site path "${site.path}" is used more than once`);
      }
      paths.add(site.path);
      for (const alias of site.aliases) {
        if (!isHostnameLabel(alias)) {
          return failure("invalid-command", `site ${site.siteId} alias "${alias}" must be one DNS label and not www`);
        }
        if (alias === input.slug) {
          return failure("invalid-command", `site ${site.siteId} alias "${alias}" collides with the operation slug`);
        }
        if (aliases.has(alias)) {
          return failure("invalid-command", `alias "${alias}" is used more than once`);
        }
        aliases.add(alias);
      }
    }
    const at = now();
    return this.ctx.storage.transactionSync(() => {
      const existing = this.one("SELECT 1 AS present FROM operation WHERE operation_id = ?", input.operationId);
      this.ctx.storage.sql.exec(
        `INSERT INTO operation
          (operation_id, display_name, slug, bounded, policy_json, admin_roles_json, configure_actions_json, envelope_lifetime_seconds, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(operation_id) DO UPDATE SET
           display_name = excluded.display_name,
           slug = excluded.slug,
           bounded = excluded.bounded,
           policy_json = excluded.policy_json,
           admin_roles_json = excluded.admin_roles_json,
           configure_actions_json = excluded.configure_actions_json,
           envelope_lifetime_seconds = excluded.envelope_lifetime_seconds,
           updated_at = excluded.updated_at`,
        input.operationId,
        input.displayName ?? null,
        input.slug,
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
          `INSERT INTO sites (site_id, display_name, path, aliases_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(site_id) DO UPDATE SET
             display_name = excluded.display_name,
             path = excluded.path,
             aliases_json = excluded.aliases_json,
             updated_at = excluded.updated_at`,
          site.siteId,
          site.displayName ?? null,
          site.path,
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
          ...targetColumns(grant.target),
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
      // Revoke is terminal, so an invite only ever starts from nothing. The
      // previous `status != 'revoked'` guard let a revoked organization be
      // re-invited here while the in-memory engine refused it; the state
      // machine settles the disagreement in the model's favour.
      const invited = this.participationTransition(input.organizationId, { kind: "invite", by: "operation" });
      if (!invited.ok) return failure("denied", invited.problem);
      this.ctx.storage.sql.exec(
        `INSERT INTO invitations (invitation_id, organization_id, status, created_at, updated_at)
         VALUES (?, ?, 'invited', ?, ?)`,
        invitationId,
        input.organizationId,
        at,
        at,
      );
      this.writeParticipation(invited.participation, at);
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
        // Two events in the model's order — the organization accepted, the
        // operation activates — rather than one jump to `active`. Both steps
        // refuse to run from `revoked`, which is what makes an acceptance
        // delivered after a revoke a recorded no-op instead of a
        // resurrection. The message is still delivered: it arrived, it just
        // did not apply, and retrying it forever would not help.
        const accepted = this.participationTransition(organizationId, { kind: "accept", by: "organization" });
        if (!accepted.ok) {
          this.audit("outbox", `acceptance for ${organizationId} not applied: ${accepted.problem}`, at);
        } else {
          this.writeParticipation(accepted.participation, at);
          const activated = this.participationTransition(organizationId, { kind: "activate", by: "operation" });
          if (!activated.ok) {
            this.audit("outbox", `activation for ${organizationId} not applied: ${activated.problem}`, at);
          } else {
            this.writeParticipation(activated.participation, at);
            this.ctx.storage.sql.exec(
              "UPDATE invitations SET status = 'active', updated_at = ? WHERE invitation_id = ?",
              at,
              input.invitationId,
            );
            this.audit("outbox", `participation ${organizationId} active (canonical)`, at);
          }
        }
      } else if (input.kind === "participation-revoked") {
        if (input.organizationId === undefined) return failure("invalid-command", "revocation needs an organizationId");
        this.ctx.storage.sql.exec(
          "UPDATE invitations SET status = 'revoked', updated_at = ? WHERE organization_id = ? AND status IN ('invited', 'accepted', 'active')",
          at,
          input.organizationId,
        );
        const revoked = this.revokeParticipationRow(input.organizationId, "organization", at);
        this.ctx.storage.sql.exec(
          "UPDATE refresh_records SET revoked = 1 WHERE organization_id = ?",
          input.organizationId,
        );
        this.audit(
          "outbox",
          revoked.ok
            ? `participation ${input.organizationId} revoked`
            : `participation ${input.organizationId} not revoked: ${revoked.problem}`,
          at,
        );
      } else if (input.kind === "actor-disabled") {
        if (input.organizationId === undefined || input.actorId === undefined) {
          return failure("invalid-command", "actor-disabled needs organizationId and actorId");
        }
        this.revokeRefreshRecords(input.organizationId, input.actorId);
        this.audit("outbox", `actor ${input.organizationId}/${input.actorId} disabled; refresh records revoked`, at);
      } else if (input.kind === "roster") {
        if (input.organizationId === undefined) return failure("invalid-command", "roster needs an organizationId");
        if (input.actors === undefined) return failure("invalid-command", "roster needs an actors list");
        const imageAt = input.at ?? at;
        const applied = this.replaceRoster(input.organizationId, input.actors, imageAt, at);
        this.audit(
          "outbox",
          applied
            ? `roster for ${input.organizationId}: ${input.actors.length} actors, ${input.actors.filter((actor) => actor.disabled).length} disabled`
            : `roster for ${input.organizationId} ignored: image ${imageAt} is older than the applied one`,
          at,
        );
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
      const revoked = this.revokeParticipationRow(organizationId, "operation", at);
      if (!revoked.ok) return failure("denied", revoked.problem);
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
      target: input.target,
      primary: input.primary === true,
      byActorId: input.byActorId,
    });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      const policy = this.policy();
      if (policy === undefined) return failure("unavailable", "operation is not bootstrapped");
      if (!actionsOf(policy, input.role).found) return failure("invalid-command", `unknown role ${input.role}`);
      // A grant stands on an actor and a participation. The actor is an
      // organization-owned fact, so this reads the projection rather than
      // the other coordinator: a local, atomic check inside the same
      // transaction as the insert, where a cross-object lookup before the
      // transaction could only have offered a check-then-act window.
      if (this.one(
        "SELECT 1 AS present FROM org_actors WHERE organization_id = ? AND actor_id = ?",
        input.organizationId,
        input.actorId,
      ) === undefined) {
        return failure("invalid-command", "unknown actor");
      }
      const standing = this.one("SELECT status FROM participations WHERE organization_id = ?", input.organizationId);
      if (standing === undefined || String(standing["status"]) !== "active") {
        return failure("denied", "the organization does not actively participate in this operation");
      }
      // "exactly one target" is no longer checked here: `GrantTarget` is a
      // two-arm union, so neither-and-both never reach this far. What is
      // left is existence.
      if (
        input.target.kind === "team" &&
        this.one("SELECT 1 AS present FROM teams WHERE team_id = ?", input.target.teamId) === undefined
      ) {
        return failure("invalid-command", "unknown team");
      }
      if (
        input.target.kind === "site" &&
        this.one("SELECT 1 AS present FROM sites WHERE site_id = ?", input.target.siteId) === undefined
      ) {
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
        ...targetColumns(input.target),
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
    // Reconciliation rides the drain the Worker already calls around every
    // command, so an operation in use converges without a standing alarm.
    // The cadence guard makes this a no-op on all but one call per interval;
    // an idle operation makes no decisions to be stale about, and the next
    // command reconciles before one is made.
    await this.reconcileRosters();
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
      operationSlug: this.one("SELECT slug FROM operation LIMIT 1")?.["slug"] ?? null,
      sitesWithPath: Number(this.one("SELECT COUNT(*) AS n FROM sites WHERE path IS NOT NULL")?.["n"] ?? 0),
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
      orgActors: count("org_actors"),
      disabledOrgActors: Number(this.one("SELECT COUNT(*) AS n FROM org_actors WHERE disabled = 1")?.["n"] ?? 0),
      // so an operator reads a stale projection rather than inferring one
      rosterSyncedAt: Number(this.one("SELECT value FROM meta WHERE key = 'roster_synced_at'")?.["value"] ?? 0),
      rosterReconcileSeconds: ROSTER_RECONCILE_SECONDS,
    };
  }

  private snapshot(): Record<string, unknown> {
    return {
      operationId: this.operationId() ?? null,
      operationSlug: this.one("SELECT slug FROM operation LIMIT 1")?.["slug"] ?? null,
      policy: this.policy() ?? null,
      sites: this.rows("SELECT site_id, display_name, path, aliases_json FROM sites ORDER BY site_id").map((row) => ({
        siteId: String(row["site_id"]),
        displayName: row["display_name"],
        path: row["path"],
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
      // derived, and inspectable: `/snapshot` is the operator's view, while
      // `/export` carries only the operation's own facts
      orgActors: this.rows("SELECT organization_id, actor_id, disabled, synced_at FROM org_actors ORDER BY organization_id, actor_id"),
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

  /** The operation's state as the portable model reads it. The
   * organizations and actors come from the projection: they are the facts
   * the organization owns, copied here so `wearableGrants` can enforce
   * actor existence and the disabled flag — which it cannot do against a
   * roster the operation does not hold. */
  private modelSnapshot(): Snapshot | undefined {
    const operationId = this.operationId();
    if (operationId === undefined) return undefined;
    const operation = this.one("SELECT operation_id, slug FROM operation LIMIT 1");
    const slug = operation?.["slug"];
    const sites = this.rows("SELECT site_id, display_name, path, aliases_json FROM sites").map((row) => ({
      siteId: rowSiteId(row),
      operationId,
      ...(row["display_name"] === null ? {} : { displayName: rowText(row, "display_name") }),
      ...(row["path"] === null ? {} : { path: rowText(row, "path") }),
      aliases: JSON.parse(rowText(row, "aliases_json")) as string[],
    }));
    const teams = this.rows("SELECT team_id, site_id, organization_id, display_name FROM teams").map((row) => ({
      teamId: rowTeamId(row),
      siteId: rowSiteId(row),
      organizationId: rowOrganizationId(row),
      ...(row["display_name"] === null ? {} : { displayName: rowText(row, "display_name") }),
    }));
    const grants: Grant[] = this.rows("SELECT * FROM grants").map((row) => ({
      grantId: rowText(row, "grant_id"),
      operationId,
      organizationId: rowOrganizationId(row),
      actorId: rowActorId(row),
      role: rowText(row, "role"),
      target: row["target_kind"] === "team"
        ? { kind: "team", teamId: rowTeamId(row) }
        : { kind: "site", siteId: rowSiteId(row) },
      ...(rowFlag(row, "is_primary") ? { primary: true } : {}),
      ...(rowFlag(row, "revoked") ? { revoked: true } : {}),
    }));
    const participations = this.rows("SELECT organization_id, status FROM participations").map((row) => ({
      organizationId: rowOrganizationId(row),
      operationId,
      status: rowText(row, "status") as "invited" | "accepted" | "active" | "revoked",
    }));
    const actors = this.rows("SELECT organization_id, actor_id, disabled FROM org_actors").map((row) => ({
      organizationId: rowOrganizationId(row),
      actorId: rowActorId(row),
      ...(rowFlag(row, "disabled") ? { disabled: true } : {}),
    }));
    const organizationIds = [...new Set([
      ...teams.map((team) => team.organizationId),
      ...participations.map((participation) => participation.organizationId),
      ...actors.map((actor) => actor.organizationId),
    ])];
    return {
      organizations: organizationIds.map((id) => ({ organizationId: id })),
      actors,
      operations: [{ operationId, ...(slug === null || slug === undefined ? {} : { slug: String(slug) }) }],
      sites,
      teams,
      grants,
      participations,
    };
  }

  private buildClaims(organizationId: OrganizationId, actorId: ActorId, auth?: AuthenticationFacts): Result<{
    readonly claims: AccessEnvelopeClaimsV1;
  }> {
    const operationId = this.operationId();
    const policy = this.policy();
    if (operationId === undefined || policy === undefined) return failure("unavailable", "operation is not bootstrapped");
    const snapshot = this.modelSnapshot();
    if (snapshot === undefined) return failure("unavailable", "operation is not bootstrapped");
    const wearable = wearableGrants(snapshot, organizationId, actorId, operationId);
    if (wearable.length === 0) return failure("not-admitted");
    const rank = (grant: Grant): string =>
      `${grant.primary === true ? 0 : 1}|${grant.role}|${grant.target.kind === "team" ? grant.target.teamId : grant.target.siteId}|${grant.grantId}`;
    const hat = [...wearable].sort((left, right) => rank(left) < rank(right) ? -1 : rank(left) > rank(right) ? 1 : 0)[0];
    if (hat === undefined) return failure("not-admitted");
    const role = actionsOf(policy, hat.role);
    // the grants and the active bundle disagreeing is an administrator's
    // inconsistency, not an empty action list for this actor
    if (!role.found) {
      return failure("unavailable", `the policy bundle no longer carries the role "${hat.role}"`);
    }
    const actions = role.actions;
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
        const carried = actionsOf(policy, grant.role);
        if (!carried.found || !carried.actions.some((action) => configureActions.includes(action))) return [];
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

  private async issue(organizationId: OrganizationId, actorId: ActorId, auth?: AuthenticationFacts): Promise<Result<{
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
    const organization = rowOrganizationId(record);
    const actor = rowActorId(record);
    // the authentication event, not the envelope, survives the chain
    const auth: AuthenticationFacts | undefined =
      record["amr_json"] === null && record["auth_time"] === null
        ? undefined
        : {
            ...(record["amr_json"] === null ? {} : { amr: JSON.parse(String(record["amr_json"])) as string[] }),
            ...(record["auth_time"] === null ? {} : { authTime: Number(record["auth_time"]) }),
          };
    const built = this.buildClaims(organization, actor, auth);
    if (!built.ok) return built;
    this.ctx.storage.sql.exec(
      "UPDATE refresh_records SET superseded = 1 WHERE handle_hash = ?",
      hash,
    );
    const next = await this.newRefresh(organization, actor, auth);
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
      "org_actors",
    ]) {
      this.ctx.storage.sql.exec(`DELETE FROM ${table}`);
    }
    // the projection's stamps go with it: a reset object that keeps
    // `roster_at:*` would refuse the next image as stale and decide against
    // a roster it no longer holds
    this.ctx.storage.sql.exec(
      "DELETE FROM meta WHERE key = 'roster_synced_at' OR key LIKE 'roster_at:%'",
    );
    return value({ reset: true });
  }

  private context(organizationId: OrganizationId, actorId: ActorId, role: string): Result<{
    readonly operationId: OperationId;
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
    // Presentation may not invent an action list either: a grant naming a
    // role the bundle dropped makes the context unanswerable, not empty.
    const wearable: HatSummary[] = [];
    for (const row of this.rows(
      "SELECT role, target_kind, team_id, site_id, is_primary FROM grants WHERE organization_id = ? AND actor_id = ? AND revoked = 0 ORDER BY grant_id",
      organizationId,
      actorId,
    )) {
      const title = String(row["role"]);
      const carried = actionsOf(policy, title);
      if (!carried.found) {
        return failure("unavailable", `the policy bundle no longer carries the role "${title}"`);
      }
      wearable.push({
        role: title,
        actions: [...carried.actions],
        target: row["target_kind"] === "team"
          ? { kind: "team", teamId: rowText(row, "team_id") }
          : { kind: "site", siteId: rowText(row, "site_id") },
        primary: rowFlag(row, "is_primary"),
      });
    }
    return value({
      operationId: rowOperationId(operation),
      ...(operation["display_name"] === null ? {} : { operationDisplayName: rowText(operation, "display_name") }),
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

  /** Restore the operation's own facts. The org-actor projection is not in
   * the snapshot (see `operationTables`) and is cleared here, so a restored
   * object decides nothing from a stale roster: every actor reads as
   * unknown — `not-admitted` — until a rebuild lands. The caller rebuilds
   * by pulling immediately afterwards. */
  private restoreSnapshot(input: unknown): Result<{ restored: boolean }> {
    if (typeof input !== "object" || input === null) return failure("invalid-command", "snapshot must be an object");
    const snapshot = input as Partial<ExportSnapshot>;
    if (snapshot.coordinator !== "operation") return failure("invalid-command", "snapshot is not operation state");
    // Older exports are intentionally restorable: `restoreTables` writes the
    // current columns and fills columns the older snapshot did not carry with
    // null, so the schema-2 → accepted-schema drill is a restore, not a
    // second bootstrap. An unknown or future version is still refused.
    const supported = new Set(["2", "3", "4"]);
    if (!supported.has(String(snapshot.schemaVersion))) {
      return failure("invalid-command", "snapshot schema version is not supported");
    }
    if (typeof snapshot.tables !== "object" || snapshot.tables === null) return failure("invalid-command", "snapshot has no tables");
    this.ctx.storage.transactionSync(() => {
      restoreTables(
        this.ctx.storage.sql,
        operationTables,
        snapshot.tables as Readonly<Record<string, readonly StateRow[]>>,
      );
      // the projection is derived, so it is dropped rather than restored,
      // along with the stamps that would make a later image look stale
      this.ctx.storage.sql.exec("DELETE FROM org_actors");
      this.ctx.storage.sql.exec(
        "DELETE FROM meta WHERE key = 'roster_synced_at' OR key LIKE 'roster_at:%'",
      );
    });
    return value({ restored: true });
  }

  /** Replace the operation's routing facts. A rename is an ops act: the
   * operation keeps no rename history, so a self-service rename waits until
   * there is one; the registry's temporary redirect covers the change. */
  private setRoutingFacts(input: RoutingFactsInput): Result<{ operationId: string }> {
    const operation = this.one("SELECT operation_id, slug FROM operation LIMIT 1");
    if (operation === undefined) return failure("unavailable", "operation is not bootstrapped");
    if (!isHostnameLabel(input.slug)) {
      return failure("invalid-command", `operation slug "${input.slug}" must be one DNS label and not www`);
    }
    const siteRows = this.rows("SELECT site_id, aliases_json FROM sites");
    const known = new Set(siteRows.map((row) => String(row["site_id"])));
    const provided = new Set<string>();
    const paths = new Set<string>();
    for (const site of input.sites) {
      if (!known.has(site.siteId)) return failure("invalid-command", `unknown site ${site.siteId}`);
      if (provided.has(site.siteId)) return failure("invalid-command", `site ${site.siteId} is named twice`);
      provided.add(site.siteId);
      if (!isSitePath(site.path)) {
        return failure("invalid-command", `site ${site.siteId} path "${site.path}" must be one segment`);
      }
      if (paths.has(site.path)) return failure("invalid-command", `site path "${site.path}" is used more than once`);
      paths.add(site.path);
    }
    if (provided.size !== known.size) {
      return failure("invalid-command", "routing facts must name every site");
    }
    const aliases = new Set<string>();
    for (const row of siteRows) {
      for (const alias of JSON.parse(rowText(row, "aliases_json")) as string[]) {
        if (!isHostnameLabel(alias)) {
          return failure("invalid-command", `site ${String(row["site_id"])} alias "${alias}" is not one DNS label or is www`);
        }
        if (alias === input.slug) {
          return failure("invalid-command", `alias "${alias}" collides with the operation slug`);
        }
        if (aliases.has(alias)) return failure("invalid-command", `alias "${alias}" is used more than once`);
        aliases.add(alias);
      }
    }
    const at = now();
    const id = rowOperationId(operation);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("UPDATE operation SET slug = ?, updated_at = ? WHERE operation_id = ?", input.slug, at, id);
      for (const site of input.sites) {
        this.ctx.storage.sql.exec("UPDATE sites SET path = ?, updated_at = ? WHERE site_id = ?", site.path, at, site.siteId);
      }
      this.audit("routing-facts", `routing facts set for ${id}`, at);
    });
    return value({ operationId: id });
  }

  async alarm(): Promise<void> {
    // `drain` reconciles behind the cadence guard, so the retry alarm
    // doubles as the projection's backstop.
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
          slug: asString(body["slug"], "slug"),
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
              path: asString(site["path"], "path"),
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
              target: asGrantTarget(grant["target"], "target"),
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
        const bootstrapped = this.bootstrap(input);
        // Populate the projection before anything reads it. A bootstrap that
        // declares active participations and grants must be able to issue on
        // the next request, and the push channel carries only changes made
        // after the relationship exists — so the first image has to be
        // pulled here.
        if (bootstrapped.ok) await this.reconcileRosters(true);
        return json(bootstrapped);
      }

      if (request.method === "POST" && url.pathname === "/routing-facts") {
        const body = await readBody();
        return json(this.setRoutingFacts({
          slug: asString(body["slug"], "slug"),
          sites: asArray(body["sites"], "sites").map((entry) => {
            const site = asRecord(entry);
            return { siteId: asString(site["siteId"], "siteId"), path: asString(site["path"], "path") };
          }),
        }));
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
          ...(typeof body["at"] === "number" ? { at: body["at"] } : {}),
          ...(body["actors"] === undefined ? {} : {
            actors: asArray(body["actors"], "actors").map((entry) => {
              const actor = asRecord(entry);
              return {
                actorId: asString(actor["actorId"], "actorId"),
                disabled: actor["disabled"] === true,
              };
            }),
          }),
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
          target: asGrantTarget(body["target"], "target"),
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
          asOrganizationId(body["organizationId"], "organizationId"),
          asActorId(body["actorId"], "actorId"),
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
          asOrganizationId(body["organizationId"], "organizationId"),
          asActorId(body["actorId"], "actorId"),
          asString(body["role"], "role"),
        ));
      }

      if (request.method === "POST" && url.pathname === "/reconcile-rosters") {
        // forced reconciliation, for an operator repairing a stale
        // projection and for tests that must not wait out the cadence
        return json(value(await this.reconcileRosters(true)));
      }

      if (request.method === "POST" && url.pathname === "/drain") {
        return json(value(await this.drain()));
      }

      if (request.method === "GET" && url.pathname === "/status") return json(value(this.status()));
      if (request.method === "GET" && url.pathname === "/export") return json(value(this.exportSnapshot()));
      if (request.method === "POST" && url.pathname === "/restore") {
        const restored = this.restoreSnapshot(await request.json());
        // rebuild the derived projection, so a restored operation can decide
        // again without waiting for the reconciliation interval
        if (restored.ok) await this.reconcileRosters(true);
        return json(restored);
      }
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
