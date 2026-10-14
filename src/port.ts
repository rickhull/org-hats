// The persistence port. One async interface; the core never sees a driver.
//
// Two questions, both async, matching D1's shape. The core states the
// organization-side read rule (see organizationsOf, scopeCovers); an adapter
// answers the query — and may union the host's cross-organization peers on top
// to own the whole read answer.

import type { HeldHat, Id } from "./core.ts";

export interface OrgHatsRepository {
  /** Every hat the actor holds in one operation, with its role's actions and
   * its anchor scope path resolved. */
  hatsOf(actorId: Id, operationId: Id): Promise<readonly HeldHat[]>;

  /** The teams readable at a scope — the organization rule, plus whatever the
   * host adds (a consumer may union its site-local, supervisors-only peers). */
  readableTeamsAt(hats: readonly HeldHat[], operationId: Id, scopePath: string): Promise<readonly Id[]>;
}
