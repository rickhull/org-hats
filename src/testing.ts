// A fake port for tests. The port is two questions; a fake is two functions.
//
// Hosts test route wiring and decision mapping without a driver: supply the
// hats as literal `HeldHat` records — extended with names if the audit row
// needs legibility, since the interface is structural and open — and,
// optionally, the read answer. Pure, so it lives inside the fence.

import type { HeldHat, Id } from "./core.ts";
import type { OrgHatsRepository } from "./port.ts";

/** The hats an actor holds in an operation, as a fixture. */
export type FakeHats = (actorId: Id, operationId: Id) => readonly HeldHat[] | Promise<readonly HeldHat[]>;

/** The read answer, as a fixture. Optional: a fake that cannot read reads
 * nothing, which is the correct answer for act-only tests. */
export type FakeRead = (
  hats: readonly HeldHat[],
  operationId: Id,
  scopePath: string,
) => readonly Id[] | Promise<readonly Id[]>;

export function fakeRepository(hats: FakeHats, read?: FakeRead): OrgHatsRepository {
  return {
    async hatsOf(actorId, operationId) {
      return await hats(actorId, operationId);
    },
    async readableTeamsAt(list, operationId, scopePath) {
      return read ? await read(list, operationId, scopePath) : [];
    },
  };
}
