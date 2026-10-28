import { type Failure, type OperationId, type OrganizationId } from "../contract.js";
import type { Clock, Signer } from "./internal.js";
import type { ActivationAcceptInput, ActivationAcceptance, ActivationInspectInput, ActivationInspection, ActivationRequestInput, ActivationRequestResult, AuthorityCommand, Failed } from "./types.js";
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
    readonly configureActions: readonly string[];
    readonly activationLifetime: number;
    readonly activationSecret: () => string;
}
export interface OrganizationCoordinator {
    resolvePrincipal(authorization: AuthorityCommand["authorization"], boundTo?: OperationId): Promise<Principal | Failure>;
    command: CommandHandler;
    activationRequest(input: ActivationRequestInput): Promise<ActivationRequestResult | Failed>;
    activationInspect(input: ActivationInspectInput): Promise<ActivationInspection | Failed>;
    activationAccept(input: ActivationAcceptInput): Promise<ActivationAcceptance | Failed>;
}
export declare const createOrganizationCoordinator: (deps: OrganizationDeps) => OrganizationCoordinator;
