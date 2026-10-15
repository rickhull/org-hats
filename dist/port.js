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
export {};
