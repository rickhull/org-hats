// The persistence port. One async interface; the core never sees a driver.
//
// Two questions, both async, matching D1's shape. The core states the
// organization-side read rule (see organizationsOf, scopeCovers); an adapter
// answers the query — and may union the host's cross-organization peers on top
// to own the whole read answer.
//
// Two notes for adapter writers, both learned from a consumer:
//
// 1. **Memoize `hatsOf` per request.** The port looks like a cheap pure
//    function from the outside, and the naive wiring is the one a reader
//    reaches for first — but `decide` asks once per decision, and a request
//    path may decide several times (`/api/me`, dashboards). Memoizing in the
//    adapter, per request, is the host's expected move.
// 2. **An adapter may run under enforced foreign keys.** D1 enforces them;
//    the reference turns them on explicitly. It orders inserts — the scope
//    row precedes whatever references it.
/** A request-scoped memo over the port — the executable form of the header's
 * memoize instruction. `decide` asks `hatsOf` once per decision and a
 * request path may decide several times (`/api/me`, dashboards); this
 * answers them from one read, which is also one *consistent* read — two
 * decisions in a request cannot disagree about the held hats mid-request.
 *
 * Construct **one per request** and never share it across requests: the memo
 * is a snapshot with a one-request lifetime (the shape Zanzibar gives a
 * zookie), and rule 7's immediacy — revocation lands on the *next* request —
 * is exactly what it must not outlive. */
export function perRequest(repo) {
    const byActor = new Map();
    return {
        hatsOf(actorId, operationId) {
            let byOperation = byActor.get(actorId);
            if (byOperation === undefined) {
                byOperation = new Map();
                byActor.set(actorId, byOperation);
            }
            let hats = byOperation.get(operationId);
            if (hats === undefined) {
                hats = repo.hatsOf(actorId, operationId); // memoize the promise: single-flight, no double query
                byOperation.set(operationId, hats);
            }
            return hats;
        },
        readableTeamsAt: (hats, operationId, scopePath) => repo.readableTeamsAt(hats, operationId, scopePath),
    };
}
