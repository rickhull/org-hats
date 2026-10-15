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
import { atScope, heldCarries, onTeam, reach, wearableAt, wornHat, } from "./core.js";
function howWorn(hat, claim) {
    if (claim !== null && (typeof claim === "string" ? hat.grant.id === claim : claim(hat)))
        return "claimed";
    if (hat.grant.default)
        return "default";
    if (hat.grant.primary)
        return "primary";
    return "first";
}
async function loadWorn(repo, request) {
    const target = request.teamId != null ? onTeam(request.teamId, request.scopePath) : atScope(request.scopePath);
    const allHeld = await repo.hatsOf(request.actorId, request.operationId);
    const held = request.organizationId != null
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
function claimRecorded(claim, worn, fallback) {
    if (typeof claim === "string")
        return claim;
    return fallback === "claimed" && worn !== null ? worn.grant.id : null;
}
// --- the decision ------------------------------------------------------------
/** May the actor, wearing the hat in force, do this act on this target?
 * `can` split into its reasons — the role's capability, then the grant's
 * reach — with the two-edge shape folded in: set `heldAction` and the
 * decision additionally requires a *held* grant over the target carrying
 * it (presence from the worn hat, standing from a held one — OH-QM-07). */
export async function decide(repo, request) {
    const { target, held, worn, fallback } = await loadWorn(repo, request);
    const base = { target, action: request.action ?? null, claimed: claimRecorded(request.claimedHatId ?? null, worn, fallback) };
    if (held.length === 0)
        return { ok: false, reason: "unknown-actor", hat: null, fallback: null, ...base };
    if (worn === null)
        return { ok: false, reason: "not-admitted", hat: null, fallback: null, ...base };
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
