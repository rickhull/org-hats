// The persistence port. One async interface; the core never sees a driver.
//
// Two questions, both async, matching D1's shape. The core states the
// organization-side read rule (see organizationsOf, scopeCovers); an adapter
// answers the query — and may union the host's cross-organization peers on top
// to own the whole read answer.
export {};
