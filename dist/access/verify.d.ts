import { type AccessEnvelopeClaimsV1, type Failed, type OperationId, type SiteId, type SignedAccessEnvelope } from "../contract.ts";
import type { NeutralAccess } from "./types.ts";
/** A verification-only key, keyed by id. Rotation is two live keys in the
 * map; retirement is removing the old one after its last envelope expires. */
export interface VerifyKey {
    readonly keyId: string;
    verify(payload: string, signature: string): Promise<boolean>;
}
export interface VerifyContext {
    /** Epoch seconds; defaults to the wall clock. Deterministic tests inject. */
    now?: number;
    /** The operation the caller is serving; a mismatch is `wrong-binding`. */
    expectedOperationId?: OperationId;
    /** The site the caller is serving, when the caller is a site. */
    expectedSiteId?: SiteId;
}
export interface Verified {
    readonly claims: AccessEnvelopeClaimsV1;
    readonly access: NeutralAccess;
}
/** Pure and platform-free, for tests and alternate runtimes: accepts any
 * verify predicate. */
export declare const verifyKeyOf: (keyId: string, verify: (payload: string, signature: string) => Promise<boolean>) => VerifyKey;
/** An Ed25519 verification key from the base64 raw public bytes the issuer
 * distributed. Web Platform crypto through structural types — the fence
 * stays `types: []`. */
export declare const ed25519VerifyKey: (keyId: string, rawPublicKeyBase64: string) => Promise<VerifyKey>;
/**
 * Verify an envelope and yield neutral access. Fail-closed order: format and
 * versions first (nothing unrecognized is interpreted), then the signature
 * (an unknown key id cannot verify), then expiry, then the caller's expected
 * bindings.
 */
export declare const verify: (envelope: SignedAccessEnvelope, keys: ReadonlyMap<string, VerifyKey>, context?: VerifyContext) => Promise<Verified | Failed>;
