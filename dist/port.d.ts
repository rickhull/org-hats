import type { HeldHat, Id } from "./core.ts";
export interface OrgHatsRepository {
    /** Every hat the actor holds in one operation, with its role's actions,
     * its anchor scope path, and (optionally) display names resolved.
     * Memoize per request — see the header. */
    hatsOf(actorId: Id, operationId: Id): Promise<readonly HeldHat[]>;
    /** The teams readable at a scope — the organization rule, plus whatever the
     * host adds (a consumer may union its site-local, supervisors-only peers). */
    readableTeamsAt(hats: readonly HeldHat[], operationId: Id, scopePath: string): Promise<readonly Id[]>;
}
