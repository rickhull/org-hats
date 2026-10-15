// The request spine — the model's rules composed once, in the order they
// require, over the persistence port.
//
// The core states the rules as small predicates; the port answers the two
// async questions. What a host supplies between an incoming request and a
// decision is an *order*: resolve the held hats, filter to the wearable,
// resolve the claim against the wearable set (not the held set — that is
// rule 7), then compose capability with reach. Getting that order wrong is
// how a revoked claim authorizes an act. `decide` composes it once so the
// wrong order is inexpressible — including the two-edge shape: presence
// (the worn hat reaches) and standing (a held grant carries `heldAction`),
// the subtle held-versus-worn distinction hosts should not reimplement
// (OH-QM-07).
//
// A decision is data, never an exception: a denial is a first-class outcome
// with a reason, so the audit row (rule 5) has one shape for allow and deny.
// The host adds time, names, and the status mapping — 404 versus 403 is the
// application's to make (see docs/operations_layer.md: an unreadable thing
// is *not found*, never *forbidden*).
//
// This file is pure: no driver, no `node:*`, so it lives inside the fence
// and runs over any adapter — SQLite, D1, or a fake in tests.

import {
  atScope,
  heldCarries,
  onTeam,
  reach,
  wearableAt,
  wornHat,
  type HatClaim,
  type HeldHat,
  type Id,
  type Target,
} from "./core.ts";
import type { OrgHatsRepository } from "./port.ts";

/** How the worn hat was chosen — rule 5's signal. A claim that did not
 * resolve reports `default` / `primary` / `first`, so the drift is auditable
 * (OH-QM-04: a revoked claim falls back; it does not fail). */
export type HatSource = "claimed" | "default" | "primary" | "first";

/** Why `decide` refused. The host maps these to its own responses. */
export type DenyReason =
  /** The actor holds no grant in the operation. */
  | "unknown-actor"
  /** No hat is wearable at this scope (in this organization, if given). */
  | "not-admitted"
  /** The worn hat's role lacks the action. */
  | "no-capability"
  /** The worn hat's grant does not reach the target. */
  | "out-of-reach"
  /** No *held* grant over the target carries `heldAction`. */
  | "no-held-action";

/** One request, one act. Everything here is the application's context; the
 * model supplies only the order it is consulted in. */
export interface DecideRequest {
  readonly actorId: Id;
  readonly operationId: Id;
  /** Where the request happens — a scope path, `/riverbend/bigpark/`. */
  readonly scopePath: string;
  /** The action the worn hat must carry — the application's vocabulary
   * (`resolve`, `read_log`). Absent when the act's only requirements are
   * presence and standing: the two-edge shape, where the worn hat need only
   * reach the target. */
  readonly action?: string | null;
  /** When set, additionally require a *held* grant over the target carrying
   * this action — the standing half of the two-edge rule, checked against
   * what the actor holds, not what is worn. What the action *means*
   * (membership, filing, representation) is the application's policy. */
  readonly heldAction?: string | null;
  /** The team the act concerns; absent, the target is the scope itself. */
  readonly teamId?: Id | null;
  /** The hat the session claims — a grant id, or a matcher (`HatClaim`): a
   * name-keyed claim passes `(hat) => hat.roleName === name` and never
   * translates ids. Re-validated here against the *wearable* set (rule 7). */
  readonly claimedHatId?: HatClaim | null;
  /** Optional organization context (C31): when present, only that
   * organization's hats are wearable. The organization is request context,
   * never session-global. */
  readonly organizationId?: Id | null;
}

/** What every decision carries, allowed or denied — the audit facts minus
 * time and names, which the host adds (an adapter fills `roleName` /
 * `teamName` / `scopeName`; a host may extend `HeldHat` further still). */
export interface DecisionCore {
  readonly target: Target;
  /** The capacity action as received, or `null` in the two-edge shape. */
  readonly action: string | null;
  /** How the worn hat was chosen; `null` when none was. */
  readonly fallback: HatSource | null;
  /** The claim as the audit row wants it: the id when the claim was an id;
   * for a matcher claim, the grant id it resolved to when it resolved, and
   * `null` when it fell back (the host records its own claim token
   * alongside). */
  readonly claimed: Id | null;
}

export interface DecisionAllow extends DecisionCore {
  readonly ok: true;
  readonly hat: HeldHat;
}

export interface DecisionDeny extends DecisionCore {
  readonly ok: false;
  readonly reason: DenyReason;
  /** The hat that was worn when the decision denied — for the audit row. */
  readonly hat: HeldHat | null;
}

export type Decision = DecisionAllow | DecisionDeny;

// --- the spine's shared head -------------------------------------------------
//
// Rules 1, 7, and 8 in order: load the hats held in the operation, narrow by
// the organization if the request carries one, filter to what is wearable at
// the scope (rule 8), then resolve the claim against the *wearable* set
// (rule 7) in `wornHat`'s order.

interface Worn {
  readonly target: Target;
  readonly held: readonly HeldHat[];
  readonly worn: HeldHat | null;
  readonly fallback: HatSource | null;
}

function howWorn(hat: HeldHat, claim: HatClaim | null): HatSource {
  if (claim !== null && (typeof claim === "string" ? hat.grant.id === claim : claim(hat))) return "claimed";
  if (hat.grant.default) return "default";
  if (hat.grant.primary) return "primary";
  return "first";
}

async function loadWorn(repo: OrgHatsRepository, request: DecideRequest): Promise<Worn> {
  const target =
    request.teamId != null ? onTeam(request.teamId, request.scopePath) : atScope(request.scopePath);
  const allHeld = await repo.hatsOf(request.actorId, request.operationId);
  const held =
    request.organizationId != null
      ? allHeld.filter((h) => h.grant.organizationId === request.organizationId)
      : allHeld;
  const claim = request.claimedHatId ?? null;
  const worn = wornHat(wearableAt(held, request.scopePath), claim);
  return {
    target,
    held,
    worn,
    fallback: worn === null ? null : howWorn(worn, claim),
  };
}

/** The claim as the audit row wants it (see `DecisionCore.claimed`). */
function claimRecorded(claim: HatClaim | null, worn: HeldHat | null, fallback: HatSource | null): Id | null {
  if (typeof claim === "string") return claim;
  return fallback === "claimed" && worn !== null ? worn.grant.id : null;
}

// --- the decision ------------------------------------------------------------

/** May the actor, wearing the hat in force, do this act on this target?
 * `can` split into its reasons — the role's capability, then the grant's
 * reach — with the two-edge shape folded in: set `heldAction` and the
 * decision additionally requires a *held* grant over the target carrying
 * it (presence from the worn hat, standing from a held one — OH-QM-07). */
export async function decide(repo: OrgHatsRepository, request: DecideRequest): Promise<Decision> {
  const { target, held, worn, fallback } = await loadWorn(repo, request);
  const base = { target, action: request.action ?? null, claimed: claimRecorded(request.claimedHatId ?? null, worn, fallback) };
  if (held.length === 0) return { ok: false, reason: "unknown-actor", hat: null, fallback: null, ...base };
  if (worn === null) return { ok: false, reason: "not-admitted", hat: null, fallback: null, ...base };
  if (request.action != null && !worn.actions.includes(request.action)) {
    return { ok: false, reason: "no-capability", hat: worn, fallback, ...base };
  }
  if (!reach(worn, target)) {
    return { ok: false, reason: "out-of-reach", hat: worn, fallback, ...base };
  }
  if (request.heldAction != null && !heldCarries(held, target, request.heldAction)) {
    return { ok: false, reason: "no-held-action", hat: worn, fallback, ...base };
  }
  return { ok: true, hat: worn, fallback, ...base };
}
