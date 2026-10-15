import type { HeldHat, Id } from "./core.ts";
import type { OrgHatsRepository } from "./port.ts";
/** The hats an actor holds in an operation, as a fixture. */
export type FakeHats = (actorId: Id, operationId: Id) => readonly HeldHat[] | Promise<readonly HeldHat[]>;
/** The read answer, as a fixture. Optional: a fake that cannot read reads
 * nothing, which is the correct answer for act-only tests. */
export type FakeRead = (hats: readonly HeldHat[], operationId: Id, scopePath: string) => readonly Id[] | Promise<readonly Id[]>;
export declare function fakeRepository(hats: FakeHats, read?: FakeRead): OrgHatsRepository;
