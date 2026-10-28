import { type EpochSeconds } from "../contract.js";
/** Epoch seconds, branded from here on. The engine never reads a clock
 * except through this. */
export type Clock = {
    now(): EpochSeconds;
};
/** A fixed clock for deterministic tests; step it by mutation. The start is
 * caller data and stays a plain number — branding happens inside, because
 * the clock is the boundary where a number becomes the engine's time. */
export declare const fixedClock: (start: number) => Clock & {
    advance(seconds: number): void;
};
/** The wall clock: the in-memory runtime's real-time default. */
export declare const systemClock: () => Clock;
/** A 128-bit return-once bearer secret, unpadded base64url. */
export declare const randomActivationSecret: () => string;
/** What the engine signs envelopes with and verifies against. */
export interface Signer {
    readonly keyId: string;
    readonly algorithm: string;
    sign(payload: string): Promise<string>;
    verify(payload: string, signature: string): Promise<boolean>;
    /** The public key, base64 raw bytes — what verifiers receive first. */
    publicKey(): Promise<string>;
}
/** Ed25519 via Web Platform crypto — the one algorithm v1 ships. */
export declare const webCryptoSigner: (keyId: string) => Promise<Signer>;
/** SHA-256 hex, for hashing refresh handles at rest. */
export declare const sha256Hex: (value: string) => Promise<string>;
/** A counter for opaque ids: deterministic, unique within an engine. */
export declare const counter: () => () => number;
