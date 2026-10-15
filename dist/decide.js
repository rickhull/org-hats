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
import { AUTHOR, atScope, onTeam, reach, wearableAt, wornHat, } from "./core.js";
function howWorn(hat, claimed) {
    if (claimed !== null && hat.grant.id === claimed)
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
    const worn = wornHat(wearableAt(held, request.scopePath), request.claimedHatId ?? null);
    const claimed = request.claimedHatId ?? null;
    return { target, held, worn, fallback: worn === null ? null : howWorn(worn, claimed) };
}
// --- the two decisions -------------------------------------------------------
/** May the actor, wearing the hat in force, do this action on this target?
 * `can` split into its reasons: the role's capability, then the grant's
 * reach. */
export async function decide(repo, request) {
    const claimed = request.claimedHatId ?? null;
    const { target, held, worn, fallback } = await loadWorn(repo, request);
    const base = { target, action: request.action, claimed };
    if (held.length === 0)
        return { ok: false, reason: "unknown-actor", hat: null, fallback: null, ...base };
    if (worn === null)
        return { ok: false, reason: "not-admitted", hat: null, fallback: null, ...base };
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
export async function decideSpeak(repo, request) {
    const claimed = request.claimedHatId ?? null;
    const { target, held, worn, fallback } = await loadWorn(repo, request);
    const base = { target, action: request.action, claimed };
    if (held.length === 0)
        return { ok: false, reason: "unknown-actor", hat: null, fallback: null, ...base };
    if (worn === null)
        return { ok: false, reason: "not-admitted", hat: null, fallback: null, ...base };
    if (!reach(worn, target)) {
        return { ok: false, reason: "out-of-reach", hat: worn, fallback, ...base };
    }
    if (!held.some((h) => reach(h, target) && h.actions.includes(AUTHOR))) {
        return { ok: false, reason: "not-affiliated", hat: worn, fallback, ...base };
    }
    return { ok: true, hat: worn, fallback, ...base };
}
