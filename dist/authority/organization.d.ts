import { type ActorId, type Failure, type OperationId, type OrganizationId } from "../contract.js";
import type { Clock, Signer } from "./internal.js";
import type { AuthorityCommand } from "./types.js";
import { type OpState, type OrgState, type OutboxMessage, type CommandHandler, type Principal, type PrincipalLink } from "./state.js";
export interface OrganizationDeps {
    readonly orgs: Map<OrganizationId, OrgState>;
    readonly ops: Map<OperationId, OpState>;
    readonly principalLinks: Map<string, PrincipalLink>;
    readonly outbox: OutboxMessage[];
    readonly clock: Clock;
    readonly signer: Signer;
    readonly nextId: () => number;
    readonly adminRoles: Readonly<Record<OperationId, readonly string[]>>;
    readonly orgAdmins: Readonly<Record<OrganizationId, readonly ActorId[]>>;
    readonly configureActions: readonly string[];
}
export interface OrganizationCoordinator {
    resolvePrincipal(authorization: AuthorityCommand["authorization"], boundTo?: OperationId): Promise<Principal | Failure>;
    command: CommandHandler;
}
export declare const createOrganizationCoordinator: (deps: OrganizationDeps) => OrganizationCoordinator;
