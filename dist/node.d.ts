import { type Grant, type HeldHat, type Id } from "./core.ts";
import type { OrgHatsRepository } from "./port.ts";
import { Db } from "./db.ts";
export { Db };
export declare function installSchema(db: Db): void;
export interface GrantInput {
    team?: Id;
    scope?: Id;
    primary?: boolean;
    default?: boolean;
}
export declare class SqliteRepository implements OrgHatsRepository {
    readonly db: Db;
    constructor(db: Db);
    hatsOf(actorId: Id, operationId: Id): Promise<HeldHat[]>;
    readableTeamsAt(hats: readonly HeldHat[], _operationId: Id, scopePath: string): Promise<string[]>;
    scopePath(scopeId: Id): string | null;
    addScope(id: Id, parent?: Id | null, name?: Id): Id;
    addOrg(id: Id, operationId: Id, name: string): Id;
    addActor(id: Id, name: string): Id;
    addRole(id: Id, name: string): Id;
    addTeam(id: Id, orgId: Id, scopeId: Id, name: string): Id;
    grantCapability(roleId: Id, action: string): void;
    addGrant(id: Id, actorId: Id, roleId: Id, orgId: Id, input: GrantInput): Grant;
    revokeGrant(id: Id): void;
    private orgOfTeam;
}
