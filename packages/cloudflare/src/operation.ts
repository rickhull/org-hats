import { DurableObject } from "cloudflare:workers";
import {
  actionsOf,
  actorId,
  assembleAccessClaims,
  canonicalJson,
  epochSeconds,
  operationId,
  organizationId,
  siteId,
  teamId,
  validatePolicyBundle,
  type AccessEnvelopeClaimsV1,
  type ActorId,
  type AuthenticationFacts,
  type FailureKind,
  type Failure,
  type GrantTarget,
  type HatSummary,
  type JsonValue,
  type OperationId,
  type OrganizationId,
  type PolicyBundle,
  type RefreshHandleOutcome,
  type SiteId,
  type TeamId,
  type Unbranded,
} from "org-hats/authority";
import {
  isHostnameLabel,
  isSitePath,
  transitionParticipation,
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
  OUTBOX_DELIVERED_RETENTION_SECONDS,
  OUTBOX_DRAIN_LIMIT,
} from "./state";
import { initializeOperationSchema } from "./schema/operation";
import { displayLabelFailure, identifierFailure } from "./validation";
import { handleOperationRequest } from "./http/operation";
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
/** How stale the org-actor projection may get before reconciliation pulls it
 * again. The push channel carries a change immediately; this interval bounds
 * only how long a *dropped* message can go unrepaired, so it is a
 * convergence budget and never the revocation window. */
const ROSTER_RECONCILE_SECONDS = 15 * 60;

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

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** The three columns a target is stored as: the discriminant and the two
 * nullable id columns. Written once, so the rows cannot disagree with the
 * union. */
const targetColumns = (target: Unbranded<GrantTarget>): readonly [string, string | null, string | null] =>
  target.kind === "team" ? ["team", target.teamId, null] : ["site", null, target.siteId];

export interface SiteInput {
  readonly siteId: string;
  readonly longName?: string;
  /** The short display label, presentation only and distinct from `path`:
   * a site may be `PEC-ATL` to the people there and `atlanta` in a URL. */
  readonly shortName?: string;
  /** The canonical one-segment path beneath the operation hostname. */
  readonly path: string;
  readonly aliases: readonly string[];
}

export interface TeamInput {
  readonly teamId: string;
  readonly siteId: string;
  readonly organizationId: string;
  readonly displayName?: string;
}

export interface GrantInput {
  readonly grantId: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly role: string;
  readonly target: Unbranded<GrantTarget>;
  readonly primary?: boolean;
  readonly revoked?: boolean;
}

export interface TeamRequestInput {
  readonly teamId: string;
  readonly siteId: string;
  readonly organizationId: string;
  readonly displayName?: string;
  readonly byActorId: string;
  readonly byOrganizationId: string;
  readonly idempotencyKey: string;
}

export interface TeamAdmitInput {
  readonly teamId: string;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

export interface TeamUpdateInput {
  readonly teamId: string;
  readonly displayName: string | null;
  readonly byActorId: string;
  readonly byOrganizationId: string;
  readonly idempotencyKey: string;
}

export interface TeamRetireInput {
  readonly teamId: string;
  readonly byActorId: string;
  readonly byOrganizationId: string;
  readonly asOperationAdmin: boolean;
  readonly idempotencyKey: string;
}

export interface ParticipationInput {
  readonly organizationId: string;
  readonly status: "invited" | "accepted" | "active" | "revoked";
}

export interface BootstrapInput {
  readonly operationId: string;
  readonly longName?: string;
  /** The short display label, presentation only and never an address. */
  readonly shortName?: string;
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

export interface InviteInput {
  readonly invitationId?: string;
  readonly organizationId: string;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

/** One organization actor as the projection carries it: who they are and
 * whether they are disabled. Nothing else crosses — see `org_actors`. */
export interface RosterActor {
  readonly actorId: string;
  readonly disabled: boolean;
}

export interface IntakeMessage {
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

export interface GrantCommand {
  readonly grantId?: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly role: string;
  readonly target: Unbranded<GrantTarget>;
  readonly primary?: boolean;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

export interface RevokeGrantCommand {
  readonly grantId: string;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

export interface SelectHatCommand {
  readonly grantId: string;
  readonly actorId: string;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

export interface AccessRequestCommand {
  readonly requestId?: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly note?: string;
  readonly idempotencyKey: string;
}

export interface AdmitCommand {
  readonly organizationId: string;
  readonly actorId: string;
  readonly byActorId: string;
  readonly idempotencyKey: string;
}

/** A full replace of the operation's routing facts. Every site must be named;
 * a partial set would leave a routing projection with no source. */
export interface RoutingFactsInput {
  readonly slug: string;
  readonly sites: readonly { readonly siteId: string; readonly path: string }[];
}

/** How and when the principal authenticated arrives with the evidence and
 * lives on the refresh record; the claims assembler owns the shape. */

export class OperationAuthority extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    initializeOperationSchema(this.ctx.storage.sql);
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
    // Display labels are checked before anything is written, by the same rule
    // the command paths use: a label refused here never persists, and a
    // refusal leaves the operation unbootstrapped rather than half-named.
    // Both labels, not just the short one — an unvalidated field beside a
    // validated one at one boundary is an asymmetry nothing justifies.
    for (const [value, label] of [
      [input.longName, "operation long name"],
      [input.shortName, "operation short name"],
    ] as const) {
      const nameFailure = displayLabelFailure(value, label);
      if (nameFailure !== undefined) return { ok: false, failure: nameFailure };
    }
    for (const site of input.sites) {
      for (const [value, label] of [
        [site.longName, `site ${site.siteId} long name`],
        [site.shortName, `site ${site.siteId} short name`],
      ] as const) {
        const nameFailure = displayLabelFailure(value, label);
        if (nameFailure !== undefined) return { ok: false, failure: nameFailure };
      }
    }
    for (const team of input.teams) {
      const nameFailure = displayLabelFailure(team.displayName, `team ${team.teamId} display name`);
      if (nameFailure !== undefined) return { ok: false, failure: nameFailure };
    }
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
          (operation_id, display_name, short_name, slug, bounded, policy_json, admin_roles_json, configure_actions_json, envelope_lifetime_seconds, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(operation_id) DO UPDATE SET
           display_name = excluded.display_name,
           short_name = excluded.short_name,
           slug = excluded.slug,
           bounded = excluded.bounded,
           policy_json = excluded.policy_json,
           admin_roles_json = excluded.admin_roles_json,
           configure_actions_json = excluded.configure_actions_json,
           envelope_lifetime_seconds = excluded.envelope_lifetime_seconds,
           updated_at = excluded.updated_at`,
        input.operationId,
        input.longName ?? null,
        input.shortName ?? null,
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
          `INSERT INTO sites (site_id, display_name, short_name, path, aliases_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(site_id) DO UPDATE SET
             display_name = excluded.display_name,
             short_name = excluded.short_name,
             path = excluded.path,
             aliases_json = excluded.aliases_json,
             updated_at = excluded.updated_at`,
          site.siteId,
          site.longName ?? null,
          site.shortName ?? null,
          site.path,
          canonicalJson(site.aliases as unknown as JsonValue),
          at,
          at,
        );
      }
      // Bootstrap seeds teams as active and never overwrites an existing
      // team: a retired id stays retired, and a later rename survives a
      // re-bootstrap.
      for (const team of input.teams) {
        this.ctx.storage.sql.exec(
          `INSERT INTO teams (team_id, site_id, organization_id, display_name, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?)
           ON CONFLICT(team_id) DO NOTHING`,
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

  /** Run the real local writes, observe their data delta, and always roll
   * them back. Keep this synchronous: reconciliation and delivery are not
   * part of a preview, and no mutable in-memory state may escape it. */
  private bootstrapPreview(input: BootstrapInput): Result<{
    readonly coordinator: "operation";
    readonly changes: readonly {
      readonly table: string;
      readonly key: StateRow;
      readonly before: StateRow | null;
      readonly after: StateRow;
    }[];
  }> {
    const specs = operationTables.filter((spec) =>
      ["operation", "sites", "teams", "grants", "participations"].includes(spec.name));
    const data = (row: StateRow): StateRow => Object.fromEntries(
      Object.entries(row).filter(([column]) => column !== "created_at" && column !== "updated_at"),
    );
    const rollback = {};
    let result: ReturnType<OperationAuthority["bootstrapPreview"]> = failure("unavailable");
    try {
      this.ctx.storage.transactionSync(() => {
        const before = readTables(this.ctx.storage.sql, specs);
        const applied = this.bootstrap(input);
        if (!applied.ok) {
          result = applied;
        } else {
          const after = readTables(this.ctx.storage.sql, specs);
          const changes = specs.flatMap((spec) => {
            const columns = spec.orderBy.split(", ");
            const keyOf = (row: StateRow): StateRow => Object.fromEntries(columns.map((key) => [key, row[key] ?? null]));
            const previous = new Map((before[spec.name] ?? []).map((row) => [JSON.stringify(keyOf(row)), data(row)]));
            return (after[spec.name] ?? []).flatMap((row) => {
              const key = keyOf(row);
              const prior = previous.get(JSON.stringify(key)) ?? null;
              const next = data(row);
              return JSON.stringify(prior) === JSON.stringify(next)
                ? [] : [{ table: spec.name, key, before: prior, after: next }];
            });
          });
          result = value({ coordinator: "operation" as const, changes });
        }
        // Throw even on success: a returned value would commit the outer
        // transaction, including the nested bootstrap's audit and timestamps.
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    return result;
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
      } else if (input.kind === "actor-disabled" || input.kind === "actor-unlinked") {
        if (input.organizationId === undefined || input.actorId === undefined) {
          return failure("invalid-command", `${input.kind} needs organizationId and actorId`);
        }
        this.revokeRefreshRecords(input.organizationId, input.actorId);
        this.audit(
          "outbox",
          `actor ${input.organizationId}/${input.actorId} ${input.kind === "actor-disabled" ? "disabled" : "unlinked"}; refresh records revoked`,
          at,
        );
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
        this.one("SELECT 1 AS present FROM teams WHERE team_id = ? AND status = 'active'", input.target.teamId) === undefined
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

  private requestTeam(input: TeamRequestInput): Result<{ applied: boolean }> {
    const at = now();
    const payload = payloadOf({
      kind: "request-team",
      teamId: input.teamId,
      siteId: input.siteId,
      organizationId: input.organizationId,
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      byActorId: input.byActorId,
    });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      const idFailure = identifierFailure(input.teamId, "team id");
      if (idFailure !== undefined) return { ok: false, failure: idFailure };
      const nameFailure = displayLabelFailure(input.displayName, "team display name");
      if (nameFailure !== undefined) return { ok: false, failure: nameFailure };
      const standing = this.one("SELECT status FROM participations WHERE organization_id = ?", input.organizationId);
      if (standing === undefined || String(standing["status"]) !== "active") {
        return failure("denied", "the organization does not actively participate in this operation");
      }
      if (this.one("SELECT 1 AS present FROM sites WHERE site_id = ?", input.siteId) === undefined) {
        return failure("invalid-command", "unknown site");
      }
      if (this.one("SELECT 1 AS present FROM teams WHERE team_id = ?", input.teamId) !== undefined) {
        return failure("invalid-command", "team id already exists");
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO teams (team_id, site_id, organization_id, display_name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
        input.teamId,
        input.siteId,
        input.organizationId,
        input.displayName ?? null,
        at,
        at,
      );
      this.audit(input.byActorId, `team ${input.teamId} requested by ${input.organizationId}`, at);
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true });
    });
  }

  private admitTeam(input: TeamAdmitInput): Result<{ applied: boolean }> {
    const at = now();
    const payload = payloadOf({ kind: "admit-team", teamId: input.teamId, byActorId: input.byActorId });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      const team = this.one("SELECT organization_id, status FROM teams WHERE team_id = ?", input.teamId);
      if (team === undefined) return failure("invalid-command", "unknown team");
      if (String(team["status"]) === "retired") return failure("invalid-command", "team is retired");
      if (String(team["status"]) === "pending") {
        this.ctx.storage.sql.exec(
          "UPDATE teams SET status = 'active', updated_at = ? WHERE team_id = ?",
          at,
          input.teamId,
        );
        this.audit(input.byActorId, `team ${input.teamId} admitted by ${String(team["organization_id"])}`, at);
      }
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true });
    });
  }

  private updateTeam(input: TeamUpdateInput): Result<{ applied: boolean }> {
    const at = now();
    const payload = payloadOf({
      kind: "update-team",
      teamId: input.teamId,
      displayName: input.displayName,
      byActorId: input.byActorId,
    });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      const team = this.one(
        "SELECT organization_id, status, display_name FROM teams WHERE team_id = ?",
        input.teamId,
      );
      if (team === undefined) return failure("invalid-command", "unknown team");
      if (String(team["organization_id"]) !== input.byOrganizationId) {
        return failure("denied", "the caller does not administer this team's organization");
      }
      const nameFailure = displayLabelFailure(input.displayName, "team display name");
      if (nameFailure !== undefined) return { ok: false, failure: nameFailure };
      if (String(team["status"]) === "retired") return failure("invalid-command", "team is retired");
      const current = team["display_name"] === null ? null : String(team["display_name"]);
      if (current !== input.displayName) {
        this.ctx.storage.sql.exec(
          "UPDATE teams SET display_name = ?, updated_at = ? WHERE team_id = ?",
          input.displayName,
          at,
          input.teamId,
        );
        this.audit(input.byActorId, `team ${input.teamId} display name updated`, at);
      }
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true });
    });
  }

  /** The teams one organization fields in this operation, with lifecycle
   * status — the teams half of the runtime's roster read. The runtime gates
   * that read on administrator standing before this is called. */
  teamsOf(organizationId: string): readonly {
    readonly teamId: string;
    readonly displayName?: string;
    readonly status: "pending" | "active" | "retired";
  }[] {
    return this.rows(
      "SELECT team_id, display_name, status FROM teams WHERE organization_id = ? ORDER BY team_id",
      organizationId,
    ).map((row) => ({
      teamId: row.team_id as string,
      ...(row.display_name === null || row.display_name === undefined ? {} : { displayName: row.display_name as string }),
      status: row.status as "pending" | "active" | "retired",
    }));
  }

  private retireTeam(input: TeamRetireInput): Result<{ applied: boolean }> {
    const at = now();
    const payload = payloadOf({
      kind: "retire-team",
      teamId: input.teamId,
      byActorId: input.byActorId,
      asOperationAdmin: input.asOperationAdmin,
    });
    return this.ctx.storage.transactionSync(() => {
      const replay = this.replay(input.idempotencyKey, payload);
      if (replay !== undefined) return replay;
      const team = this.one("SELECT organization_id, status FROM teams WHERE team_id = ?", input.teamId);
      if (team === undefined) return failure("invalid-command", "unknown team");
      if (!input.asOperationAdmin && String(team["organization_id"]) !== input.byOrganizationId) {
        return failure("denied", "the caller does not administer this team's organization");
      }
      if (String(team["status"]) !== "retired") {
        const affected = this.rows(
          "SELECT organization_id, actor_id FROM grants WHERE target_kind = 'team' AND team_id = ? AND revoked = 0",
          input.teamId,
        );
        this.ctx.storage.sql.exec(
          "UPDATE teams SET status = 'retired', updated_at = ? WHERE team_id = ?",
          at,
          input.teamId,
        );
        this.ctx.storage.sql.exec(
          "UPDATE grants SET revoked = 1, updated_at = ? WHERE target_kind = 'team' AND team_id = ? AND revoked = 0",
          at,
          input.teamId,
        );
        const actors = new Set(affected.map((row) => `${String(row["organization_id"])}/${String(row["actor_id"])}`));
        for (const entry of actors) {
          const [organizationId_, actorId_] = entry.split("/");
          if (organizationId_ !== undefined && actorId_ !== undefined) {
            this.revokeRefreshRecords(organizationId_, actorId_);
          }
        }
        this.audit(
          input.byActorId,
          `team ${input.teamId} retired; ${affected.length} grants revoked for ${actors.size} actors`,
          at,
        );
      }
      this.claim(input.idempotencyKey, payload, at);
      return value({ applied: true });
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
    for (const row of this.outboxBatch()) {
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
    this.pruneDeliveredOutbox(now());
    const pending = Number(
      this.one("SELECT COUNT(*) AS pending FROM outbox WHERE delivered_at IS NULL")?.["pending"] ?? 0,
    );
    if (pending > 0) await this.ctx.storage.setAlarm(Date.now() + 1000);
    // Reconciliation rides the drain the Worker already calls around every
    // command, so an operation in use converges without a standing alarm.
    // The cadence guard makes this a no-op on all but one call per interval;
    // an idle operation makes no decisions to be stale about, and the next
    // command reconciles before one is made.
    await this.reconcileRosters();
    return { delivered, pending };
  }

  /** Every pending row, for the operator read and the status count: a capped
   * read would under-report a backlog. */
  private outboxRows(): Row[] {
    return this.rows(
      "SELECT id, kind, target, payload, created_at FROM outbox WHERE delivered_at IS NULL ORDER BY created_at, id",
    );
  }

  /** At most `OUTBOX_DRAIN_LIMIT` rows per invocation: one row is one
   * coordinator subrequest, so this is the subrequest bound. The operation
   * side never fanned out, but an unbounded backlog is the same cliff. */
  private outboxBatch(): Row[] {
    return this.rows(
      `SELECT id, kind, target, payload, created_at FROM outbox WHERE delivered_at IS NULL
         ORDER BY created_at, id LIMIT ${OUTBOX_DRAIN_LIMIT}`,
    );
  }

  /** Spent rows leave after `OUTBOX_DELIVERED_RETENTION_SECONDS`; the outbox
   * is otherwise append-only. A delivered row is not evidence — the audit
   * trail is — and it is not what makes a retry safe. */
  private pruneDeliveredOutbox(at: number): void {
    this.ctx.storage.sql.exec(
      "DELETE FROM outbox WHERE delivered_at IS NOT NULL AND delivered_at < ?",
      at - OUTBOX_DELIVERED_RETENTION_SECONDS,
    );
  }

  private markDelivered(id: string): void {
    this.ctx.storage.sql.exec("UPDATE outbox SET delivered_at = ? WHERE id = ?", now(), id);
  }

  private auditRows(): readonly Row[] {
    return this.rows("SELECT seq, at, actor, fact FROM audit ORDER BY seq");
  }

  private status(): Record<string, unknown> {
    const count = (table: string): number => Number(this.one(`SELECT COUNT(*) AS n FROM ${table}`)?.["n"] ?? 0);
    const siteCount = count("sites");
    const operationSlug = this.one("SELECT slug FROM operation LIMIT 1")?.["slug"] ?? null;
    const sitesWithPath = Number(this.one("SELECT COUNT(*) AS n FROM sites WHERE path IS NOT NULL")?.["n"] ?? 0);
    return {
      schemaVersion: String(this.one("SELECT value FROM meta WHERE key = 'schema_version'")?.["value"] ?? "0"),
      operationId: this.operationId() ?? null,
      operationSlug,
      sitesWithPath,
      // explicit, so a restored old export cannot look complete just because
      // the counts an operator happened to read were not compared
      routingFactsComplete: operationSlug !== null && sitesWithPath === siteCount,
      policyId: this.policy()?.id ?? null,
      policyVersion: this.policy()?.version ?? null,
      sites: siteCount,
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
      operationShortName: this.one("SELECT short_name FROM operation LIMIT 1")?.["short_name"] ?? null,
      policy: this.policy() ?? null,
      // The column is `display_name` and the field is `longName`: the wire
      // name moved at interface 4 and the column deliberately did not.
      // Renaming the column would make every export taken before the rename
      // restore with the long name silently null, because `restoreTables`
      // inserts by current column name (plans/display_labels.md § Step 2).
      sites: this.rows("SELECT site_id, display_name, short_name, path, aliases_json FROM sites ORDER BY site_id").map((row) => ({
        siteId: String(row["site_id"]),
        longName: row["display_name"],
        shortName: row["short_name"],
        path: row["path"],
        aliases: JSON.parse(String(row["aliases_json"])) as unknown,
      })),
      teams: this.rows("SELECT team_id, site_id, organization_id, display_name, status FROM teams ORDER BY team_id"),
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
      ...(row["display_name"] === null ? {} : { longName: rowText(row, "display_name") }),
      ...(row["path"] === null ? {} : { path: rowText(row, "path") }),
      aliases: JSON.parse(rowText(row, "aliases_json")) as string[],
    }));
    const teams = this.rows("SELECT team_id, site_id, organization_id, display_name FROM teams WHERE status = 'active'").map((row) => ({
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
    // The claim shape is the portable assembler's: the coordinator supplies
    // only what it owns — the bootstrapped snapshot, the active bundle, and
    // the deployment's configure vocabulary.
    const claims = assembleAccessClaims({
      snapshot,
      policy,
      operationId,
      organizationId,
      actorId,
      configureActions: this.configureActions(),
      envelopeLifetimeSeconds: this.envelopeLifetime(),
      issuedAt: epochSeconds(now()),
      ...(auth !== undefined ? { auth } : {}),
    });
    return "kind" in claims ? failure(claims.kind, claims.detail) : value({ claims });
  }

  private async mintRefresh(): Promise<{ handle: string; handleHash: string; at: number }> {
    const handle = `rh-${crypto.randomUUID()}`;
    return { handle, handleHash: await sha256Hex(handle), at: now() };
  }

  private insertRefresh(
    handleHash: string,
    organizationId: string,
    actorId: string,
    auth: AuthenticationFacts | undefined,
    at: number,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO refresh_records (handle_hash, organization_id, actor_id, revoked, superseded, amr_json, auth_time, created_at)
       VALUES (?, ?, ?, 0, 0, ?, ?, ?)`,
      handleHash,
      organizationId,
      actorId,
      auth?.amr === undefined ? null : canonicalJson(auth.amr as unknown as JsonValue),
      auth?.authTime ?? null,
      at,
    );
  }

  private async newRefresh(organizationId: string, actorId: string, auth?: AuthenticationFacts): Promise<{ handle: string; at: number }> {
    const next = await this.mintRefresh();
    this.insertRefresh(next.handleHash, organizationId, actorId, auth, next.at);
    return { handle: next.handle, at: next.at };
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

  /** The refresh liveness gate. This is the one deliberate synchronous
   * cross-coordinator read on a write path: it is read-only, narrow, and
   * fails closed. The projection remains the source for local command
   * validation; this gate exists because a lost roster push must not turn
   * a refresh handle into indefinite authority. */
  private async organizationActor(
    organizationId: OrganizationId,
    actorId: ActorId,
  ): Promise<{ readonly actorId: string; readonly disabled: boolean; readonly linked: boolean } | "unknown" | "unavailable"> {
    let response: Response;
    try {
      response = await this.env.ORGANIZATION
        .get(this.env.ORGANIZATION.idFromName(organizationId))
        .fetch(`https://authority.internal/actor?actorId=${encodeURIComponent(actorId)}`);
    } catch {
      return "unavailable";
    }
    if (response.status === 404) return "unknown";
    if (!response.ok) return "unavailable";
    try {
      const body = await response.json() as {
        readonly ok?: boolean;
        readonly value?: { readonly actorId: string; readonly disabled: boolean; readonly linked: boolean };
      };
      if (body.ok !== true || body.value === undefined) return "unavailable";
      return body.value;
    } catch {
      return "unavailable";
    }
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
    // Refresh is the exception to local-only decisions: resolve the actor at
    // the organization before reissuing. A lost roster push and a lost
    // actor-disabled message must not keep a disabled actor's session alive.
    const live = await this.organizationActor(organization, actor);
    if (live === "unknown") return failure("not-admitted", "actor is not known at the organization");
    if (live === "unavailable") return failure("unavailable", "the organization could not confirm the actor");
    if (live.disabled) return failure("not-admitted", "actor disabled");
    if (!live.linked) return failure("unauthenticated", "actor has no principal link");
    const built = this.buildClaims(organization, actor, auth);
    if (!built.ok) return built;
    // Mint outside the transaction; hash work has no place in a synchronous
    // commit. The transaction then re-reads the handle it is about to consume:
    // a concurrent refresh, a revoke, or a disable that applied while this
    // request awaited the organization must not leave a live second handle.
    const next = await this.mintRefresh();
    const rotated = this.ctx.storage.transactionSync(() => {
      const current = this.one(
        "SELECT revoked, superseded FROM refresh_records WHERE handle_hash = ?",
        hash,
      );
      if (
        current === undefined ||
        Number(current["revoked"]) === 1 ||
        Number(current["superseded"]) === 1
      ) {
        return false;
      }
      this.ctx.storage.sql.exec(
        "UPDATE refresh_records SET superseded = 1 WHERE handle_hash = ?",
        hash,
      );
      this.insertRefresh(next.handleHash, organization, actor, auth, next.at);
      return true;
    });
    if (!rotated) return failure("unauthenticated", "refresh handle is no longer live");
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
      `SELECT grants.role, grants.grant_id, grants.target_kind, grants.team_id,
              grants.site_id, grants.is_primary,
              CASE grants.target_kind
                WHEN 'team' THEN teams.display_name
                ELSE sites.display_name
              END AS target_display_name
         FROM grants
         LEFT JOIN teams ON teams.team_id = grants.team_id
         LEFT JOIN sites ON sites.site_id = grants.site_id
        WHERE grants.organization_id = ?
          AND grants.actor_id = ?
          AND grants.revoked = 0
        ORDER BY grants.grant_id`,
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
        grantId: rowText(row, "grant_id"),
        ...(row["target_display_name"] === null
          ? {}
          : { targetDisplayName: rowText(row, "target_display_name") }),
      });
    }
    return value({
      operationId: rowOperationId(operation),
      ...(operation["display_name"] === null ? {} : { operationLongName: rowText(operation, "display_name") }),
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
  private restoreSnapshot(input: unknown, operatorId?: string): Result<{ restored: boolean }> {
    if (typeof input !== "object" || input === null) return failure("invalid-command", "snapshot must be an object");
    const snapshot = input as Partial<ExportSnapshot>;
    if (snapshot.coordinator !== "operation") return failure("invalid-command", "snapshot is not operation state");
    // Older exports are intentionally restorable: `restoreTables` writes the
    // current columns and fills columns the older snapshot did not carry with
    // null, so the schema-2 → accepted-schema drill is a restore, not a
    // second bootstrap. An unknown or future version is still refused.
    const supported = new Set(["2", "3", "4", "5", "6"]);
    if (!supported.has(String(snapshot.schemaVersion))) {
      return failure("invalid-command", "snapshot schema version is not supported");
    }
    if (typeof snapshot.tables !== "object" || snapshot.tables === null) return failure("invalid-command", "snapshot has no tables");
    const tables = snapshot.tables as Readonly<Record<string, readonly StateRow[]>>;
    // Schema 5 added the team status column. A restored older export has no
    // status for its teams; those teams were all active by definition.
    const normalized = {
      ...tables,
      teams: (tables.teams ?? []).map((row) => ({ status: "active", ...row })),
    };
    this.ctx.storage.transactionSync(() => {
      restoreTables(
        this.ctx.storage.sql,
        operationTables,
        normalized,
      );
      // the projection is derived, so it is dropped rather than restored,
      // along with the stamps that would make a later image look stale
      this.ctx.storage.sql.exec("DELETE FROM org_actors");
      this.ctx.storage.sql.exec(
        "DELETE FROM meta WHERE key = 'roster_synced_at' OR key LIKE 'roster_at:%'",
      );
      // After the tables, never before: restore replaces the audit table with
      // the snapshot's rows, so a row written first would be overwritten by
      // the very act it records. This is the one entry a snapshot cannot
      // supply, and without it the most destructive privileged act in the
      // system leaves no trace that it happened.
      this.audit(operatorId ?? "operator", `state restored from a snapshot of schema ${String(snapshot.schemaVersion)}`, now());
    });
    return value({ restored: true });
  }

  /** Replace the operation's routing facts. This is a **backfill** act, not
   * a rename: the operation keeps no old-name history, so a registry rebuild
   * could not reconstruct a name authority no longer holds. Renames stay
   * ops-only until rename history exists. */
  private setRoutingFacts(input: RoutingFactsInput): Result<{ operationId: string }> {
    const operation = this.one("SELECT operation_id, slug FROM operation LIMIT 1");
    if (operation === undefined) return failure("unavailable", "operation is not bootstrapped");
    if (!isHostnameLabel(input.slug)) {
      return failure("invalid-command", `operation slug "${input.slug}" must be one DNS label and not www`);
    }
    const siteRows = this.rows("SELECT site_id, path, aliases_json FROM sites");
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
    const oldSlug = operation["slug"] === null || operation["slug"] === undefined ? "none" : String(operation["slug"]);
    const oldPaths = siteRows
      .map((row) => `${String(row["site_id"])}:${row["path"] === null || row["path"] === undefined ? "none" : String(row["path"])}`)
      .join(",");
    const newPaths = input.sites.map((site) => `${site.siteId}:${site.path}`).join(",");
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("UPDATE operation SET slug = ?, updated_at = ? WHERE operation_id = ?", input.slug, at, id);
      for (const site of input.sites) {
        this.ctx.storage.sql.exec("UPDATE sites SET path = ?, updated_at = ? WHERE site_id = ?", site.path, at, site.siteId);
      }
      this.audit("routing-facts", `routing facts set for ${id}: slug ${oldSlug} -> ${input.slug}; paths ${oldPaths} -> ${newPaths}`, at);
    });
    return value({ operationId: id });
  }

  override async alarm(): Promise<void> {
    // `drain` reconciles behind the cadence guard, so the retry alarm
    // doubles as the projection's backstop.
    await this.drain();
  }

  override async fetch(request: Request): Promise<Response> {
    return handleOperationRequest(request, {
      bootstrap: (input) => this.bootstrap(input),
      bootstrapPreview: (input) => this.bootstrapPreview(input),
      reconcileRosters: (force) => this.reconcileRosters(force),
      setRoutingFacts: (input) => this.setRoutingFacts(input),
      invite: (input) => this.invite(input),
      intake: (input) => this.intake(input),
      revokeParticipation: (organizationId, byActorId, idempotencyKey) =>
        this.revokeParticipation(organizationId, byActorId, idempotencyKey),
      grant: (input) => this.grant(input),
      revokeGrant: (input) => this.revokeGrant(input),
      selectHat: (input) => this.selectHat(input),
      requestAccess: (input) => this.requestAccess(input),
      admit: (input) => this.admit(input),
      requestTeam: (input) => this.requestTeam(input),
      admitTeam: (input) => this.admitTeam(input),
      updateTeam: (input) => this.updateTeam(input),
      retireTeam: (input) => this.retireTeam(input),
      teamsOf: (organizationId) => this.teamsOf(organizationId),
      recordRefresh: (handleHash, organizationId, actorId) =>
        this.recordRefresh(handleHash, organizationId, actorId),
      issue: (organizationId, actorId, auth) => this.issue(organizationId, actorId, auth),
      refresh: (handle) => this.refresh(handle),
      reset: () => this.reset(),
      adminRoles: () => this.adminRoles(),
      configureActions: () => this.configureActions(),
      envelopeLifetime: () => this.envelopeLifetime(),
      context: (organizationId, actorId, role) => this.context(organizationId, actorId, role),
      drain: () => this.drain(),
      status: () => this.status(),
      exportSnapshot: () => this.exportSnapshot(),
      restoreSnapshot: (input, operatorId) => this.restoreSnapshot(input, operatorId),
      snapshot: () => this.snapshot(),
      auditRows: () => this.auditRows(),
      outboxRows: () => this.outboxRows(),
    });
  }
}
