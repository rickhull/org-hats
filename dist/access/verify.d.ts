import { type AccessEnvelopeClaimsV1, type EpochSeconds, type Failed, type OperationId, type Unbranded, type SiteId, type SignedAccessEnvelope } from "../contract.js";
import type { NeutralAccess } from "./types.js";
/** A verification-only key, keyed by id. Rotation is two live keys in the
 * map; retirement is removing the old one after its last envelope expires. */
export interface VerifyKey {
    readonly keyId: string;
    verify(payload: string, signature: string): Promise<boolean>;
}
export interface VerifyContext {
    /** Epoch seconds; defaults to the wall clock. Deterministic tests inject.
     * Plain number: `Unbranded<EpochSeconds>` — a host passes seconds and
     * never an epoch constructor. */
    now?: Unbranded<EpochSeconds>;
    /** The operation the caller is serving; a mismatch is `wrong-binding`.
     * Plain string: a host passes the id it holds in its own configuration. */
    expectedOperationId?: Unbranded<OperationId>;
    /** The site the caller is serving, when the caller is a site. */
    expectedSiteId?: Unbranded<SiteId>;
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
 * Verify an envelope and yield neutral access.
 *
 * Fail-closed order, and the order is the contract: the envelope format and
 * both version fields first, so nothing unrecognized is ever interpreted;
 * then the signature, because an unknown key id cannot verify; then expiry;
 * then the caller's expected bindings last, since a binding mismatch is only
 * meaningful once the claims are known to be authentic.
 *
 * What gates readability is the **envelope** version pair — `format`,
 * `envelope.v`, and the claims' own `v`. The claims also record the
 * `interfaceVersion` of the runtime that issued them, and that is
 * deliberately *not* a gate: it is issuer provenance, not a statement about
 * whether these claims can be read. An envelope outlives the call signatures
 * that produced it (src/contract.ts), so a host whose issuer has since moved
 * to a new command vocabulary must not have every live session rejected for
 * it. Any change to what the claims *mean* moves `ACCESS_ENVELOPE_VERSION`,
 * and that is what this checks.
 */
export declare const verify: (envelope: SignedAccessEnvelope, keys: ReadonlyMap<string, VerifyKey>, context?: VerifyContext) => Promise<Verified | Failed>;
