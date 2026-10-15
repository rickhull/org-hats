import type { HeldHat, Id } from "./core.ts";
export interface OrgHatsRepository {
    /** Every hat the actor holds in one operation, with its role's actions,
     * its anchor scope path, and (optionally) display names resolved.
     * Memoize per request — see `perRequest` below. */
    hatsOf(actorId: Id, operationId: Id): Promise<readonly HeldHat[]>;
    /** The teams readable at a scope — the organization rule, plus whatever the
     * host adds (a consumer may union its site-local, supervisors-only peers). */
    readableTeamsAt(hats: readonly HeldHat[], operationId: Id, scopePath: string): Promise<readonly Id[]>;
}
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
export declare function perRequest(repo: OrgHatsRepository): OrgHatsRepository;
