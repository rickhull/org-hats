// The request spine — the model's rules composed once, in the order they
// require, over the persistence port.
//
// The core states the rules as small predicates; the port answers the two
// async questions. What a host supplies between an incoming request and a
// decision is an *order*: resolve the held hats, filter to the wearable,
// resolve the claim against the wearable set (not the held set — that is
// rule 7), then compose capability with reach. Getting that order wrong is
// how a revoked claim authorizes an act. `decide` composes it once so the
// wrong order is inexpressible; `decideSpeak` does the same for the
// two-edge rule (rule 3, OH-QM-07).
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
  AUTHOR,
  atScope,
  onTeam,
  reach,
  wearableAt,
  wornHat,
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
  | "out-of-reach";

/** Why `decideSpeak` refused. The author half is `not-affiliated`: no *held*
 * grant over the target carries AUTHOR (rule 3). */
export type SpeakDenyReason = "unknown-actor" | "not-admitted" | "out-of-reach" | "not-affiliated";

/** One request, one act. Everything here is the application's context; the
 * model supplies only the order it is consulted in. */
export interface DecideRequest {
  readonly actorId: Id;
  readonly operationId: Id;
  /** Where the request happens — a scope path, `/acme/north/`. */
  readonly scopePath: string;
  /** The action — the application's vocabulary (`resolve`, `read_reports`). */
  readonly action: string;
  /** The team the act concerns; absent, the target is the scope itself. */
  readonly teamId?: Id | null;
  /** The hat the session claims — a grant id, re-validated here (rule 7). */
  readonly claimedHatId?: Id | null;
  /** Optional organization context (C31): when present, only that
   * organization's hats are wearable. The organization is request context,
   * never session-global. */
  readonly organizationId?: Id | null;
}

/** What every decision carries, allowed or denied — the audit facts minus
 * time and names, which the host adds (a host may extend `HeldHat` with
 * names for a legible row; it is structural and open). */
export interface DecisionCore {
  readonly target: Target;
  readonly action: string;
  /** How the worn hat was chosen; `null` when none was. */
  readonly fallback: HatSource | null;
  /** The claim as received, before validation. */
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

export interface SpeakAllow extends DecisionCore {
  readonly ok: true;
  readonly hat: HeldHat;
}

export interface SpeakDeny extends DecisionCore {
  readonly ok: false;
  readonly reason: SpeakDenyReason;
  readonly hat: HeldHat | null;
}

export type SpeakDecision = SpeakAllow | SpeakDeny;

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

function howWorn(hat: HeldHat, claimed: Id | null): HatSource {
  if (claimed !== null && hat.grant.id === claimed) return "claimed";
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
  const worn = wornHat(wearableAt(held, request.scopePath), request.claimedHatId ?? null);
  const claimed = request.claimedHatId ?? null;
  return { target, held, worn, fallback: worn === null ? null : howWorn(worn, claimed) };
}

// --- the two decisions -------------------------------------------------------

/** May the actor, wearing the hat in force, do this action on this target?
 * `can` split into its reasons: the role's capability, then the grant's
 * reach. */
export async function decide(repo: OrgHatsRepository, request: DecideRequest): Promise<Decision> {
  const claimed = request.claimedHatId ?? null;
  const { target, held, worn, fallback } = await loadWorn(repo, request);
  const base = { target, action: request.action, claimed };
  if (held.length === 0) return { ok: false, reason: "unknown-actor", hat: null, fallback: null, ...base };
  if (worn === null) return { ok: false, reason: "not-admitted", hat: null, fallback: null, ...base };
  if (!worn.actions.includes(request.action)) {
    return { ok: false, reason: "no-capability", hat: worn, fallback, ...base };
  }
  if (!reach(worn, target)) {
    return { ok: false, reason: "out-of-reach", hat: worn, fallback, ...base };
  }
  return { ok: true, hat: worn, fallback, ...base };
}

/** May the actor *speak for* the target — file, author, commit? The two-edge
 * rule (OH-QM-07): the worn hat must reach the target, and some *held* grant
 * over it must carry AUTHOR. The worn hat need not itself author, so a lead
 * files on their own team without switching hats. */
export async function decideSpeak(
  repo: OrgHatsRepository,
  request: DecideRequest,
): Promise<SpeakDecision> {
  const claimed = request.claimedHatId ?? null;
  const { target, held, worn, fallback } = await loadWorn(repo, request);
  const base = { target, action: request.action, claimed };
  if (held.length === 0) return { ok: false, reason: "unknown-actor", hat: null, fallback: null, ...base };
  if (worn === null) return { ok: false, reason: "not-admitted", hat: null, fallback: null, ...base };
  if (!reach(worn, target)) {
    return { ok: false, reason: "out-of-reach", hat: worn, fallback, ...base };
  }
  if (!held.some((h) => reach(h, target) && h.actions.includes(AUTHOR))) {
    return { ok: false, reason: "not-affiliated", hat: worn, fallback, ...base };
  }
  return { ok: true, hat: worn, fallback, ...base };
}
