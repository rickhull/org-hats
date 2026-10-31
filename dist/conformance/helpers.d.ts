import { type ActorId, type FailureKind, type OperationId, type SignedAccessEnvelope } from "../contract.js";
import type { AccessIssue, AuthorityCommand, CommandResult, PrincipalEvidence } from "../authority/types.js";
import { type Verified, type VerifyContext } from "../access/verify.js";
import { type ConformancePrincipal, type ConformanceWorld } from "./world.js";
export declare const assert: (condition: unknown, message: string) => asserts condition;
export declare const equal: <T>(actual: T, expected: T, message: string) => void;
export declare const deepEqual: (actual: unknown, expected: unknown, message: string) => void;
export declare const expectFailure: (result: object, kind: FailureKind, message: string) => void;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CommandBody = DistributiveOmit<AuthorityCommand, "interfaceVersion" | "idempotencyKey" | "authorization">;
export declare const command: (world: ConformanceWorld, body: CommandBody, authorization: AuthorityCommand["authorization"], key: string) => Promise<CommandResult>;
export declare const envelopeAuth: (envelope: SignedAccessEnvelope) => AuthorityCommand["authorization"];
export declare const freshAuth: (entry: ConformancePrincipal, operationId: OperationId) => AuthorityCommand["authorization"];
export declare const issue: (world: ConformanceWorld, entry: ConformancePrincipal, operationId: OperationId) => Promise<AccessIssue>;
export declare const requestActivation: (world: ConformanceWorld, entry: ConformancePrincipal, actor: ActorId) => Promise<{
    readonly secret: string;
}>;
export declare const acceptActivation: (world: ConformanceWorld, secret: string, evidence: PrincipalEvidence) => Promise<import("../contract.js").Failed | import("../authority/types.js").ActivationAcceptance>;
export declare const verifyOk: (world: ConformanceWorld, envelope: SignedAccessEnvelope, context: VerifyContext) => Promise<Verified>;
/** Invite, accept, and grant the invitee's first hat; returns the operation
 * administrator's envelope for the rest of the case. */
export declare const admitInvitee: (world: ConformanceWorld) => Promise<AccessIssue>;
export {};
