// Internal seams of the in-memory authority engine: time, signing, hashing.
//
// These are injection points on the engine's configuration — inline
// structural types, not a published adapter SPI (docs/authority_redesign.md
// § Authority: no adapter interface is public until a second committed
// runtime implementation exists). The Cloudflare adapter implements the same
// shapes privately.
//
// Web Platform crypto is reached through minimal structural types rather
// than a DOM lib, so the portable fence (`types: []`) stays narrow and an
// accidental `document` still fails to compile. Byte codecs live in
// ../contract.ts — the encoding contract's single home. Nothing here is
// exported from a public subpath.
import { base64Decode, base64Encode, base64UrlDecode, base64UrlEncode, epochSeconds, utf8, } from "../contract.js";
/** A fixed clock for deterministic tests; step it by mutation. The start is
 * caller data and stays a plain number — branding happens inside, because
 * the clock is the boundary where a number becomes the engine's time. */
export const fixedClock = (start) => {
    let now = epochSeconds(start);
    return {
        now: () => now,
        advance: (seconds) => {
            now = epochSeconds(now + seconds);
        },
    };
};
/** The wall clock: the in-memory runtime's real-time default. */
export const systemClock = () => ({ now: () => epochSeconds(Math.floor(Date.now() / 1000)) });
const subtle = globalThis.crypto?.subtle;
const signerFromKeys = (subtle, keyId, pair) => ({
    keyId,
    algorithm: "Ed25519",
    publicKey: async () => base64Encode(new Uint8Array(await subtle.exportKey("raw", pair.publicKey))),
    sign: async (payload) => base64UrlEncode(new Uint8Array(await subtle.sign({ name: "Ed25519" }, pair.privateKey, utf8(payload)))),
    verify: async (payload, signature) => {
        try {
            return await subtle.verify({ name: "Ed25519" }, pair.publicKey, base64UrlDecode(signature), utf8(payload));
        }
        catch {
            return false;
        }
    },
});
/** Ed25519 via Web Platform crypto — the one algorithm v1 ships. */
export const webCryptoSigner = async (keyId) => {
    if (subtle === undefined)
        throw new Error("Web Platform crypto (crypto.subtle) is unavailable");
    const subtleInstance = subtle;
    return signerFromKeys(subtleInstance, keyId, await subtleInstance.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]));
};
/** SHA-256 hex, for hashing refresh handles at rest. */
export const sha256Hex = async (value) => {
    if (subtle === undefined)
        throw new Error("Web Platform crypto (crypto.subtle) is unavailable");
    const digest = await subtle.digest("SHA-256", utf8(value));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
/** A counter for opaque ids: deterministic, unique within an engine. */
export const counter = () => {
    let n = 0;
    return () => {
        n += 1;
        return n;
    };
};
