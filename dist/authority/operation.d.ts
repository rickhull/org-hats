import { type OperationId, type OrganizationId } from "../contract.js";
import { type Snapshot } from "../model.js";
import { type Clock, type Signer } from "./internal.js";
import type { AccessFromEvidenceInput, AccessIssue, AuthorityCommand, AuthorityContext, CommandResult, ContextRequest, Failed, RefreshInput } from "./types.js";
import { type OpState, type OrgState, type OutboxMessage, type CommandHandler, type PrincipalLink } from "./state.js";
export interface OperationDeps {
    readonly orgs: Map<OrganizationId, OrgState>;
    readonly ops: Map<OperationId, OpState>;
    readonly principalLinks: Map<string, PrincipalLink>;
    readonly outbox: OutboxMessage[];
    readonly clock: Clock;
    readonly signer: Signer;
    readonly nextId: () => number;
    readonly lifetime: number;
    readonly configureActions: readonly string[];
    readonly snapshotOf: (operationId: OperationId) => Snapshot | undefined;
}
export interface OperationCoordinator {
    accessFromEvidence(input: AccessFromEvidenceInput): Promise<AccessIssue | Failed>;
    refresh(input: RefreshInput): Promise<AccessIssue | Failed>;
    context(input: ContextRequest): Promise<AuthorityContext | Failed>;
    requestAccess(input: AuthorityCommand): CommandResult;
    command: CommandHandler;
}
export declare const createOperationCoordinator: (deps: OperationDeps) => OperationCoordinator;
