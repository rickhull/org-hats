// Internal seams of the in-memory authority engine: time, signing, hashing.
//
// These are injection points on the engine's configuration — inline
// structural types, not a published adapter SPI (docs/authority_redesign.md
// § Authority: no adapter interface is public until a second committed
// runtime implementation exists). The Cloudflare adapter (M6) implements the
// same shapes privately.
//
// Web Platform crypto is reached through minimal structural types rather
// than a DOM lib, so the portable fence (`types: []`) stays narrow and an
// accidental `document` still fails to compile. Byte codecs live in
// ../contract.ts — the encoding contract's single home. Nothing here is
// exported from a public subpath.

import {
  base64Decode,
  base64Encode,
  base64UrlDecode,
  base64UrlEncode,
  epochSeconds,
  utf8,
  type EpochSeconds,
} from "../contract.ts";

/** Epoch seconds, branded from here on. The engine never reads a clock
 * except through this. */
export type Clock = { now(): EpochSeconds };

/** A fixed clock for deterministic tests; step it by mutation. The start is
 * caller data and stays a plain number — branding happens inside, because
 * the clock is the boundary where a number becomes the engine's time. */
export const fixedClock = (start: number): Clock & { advance(seconds: number): void } => {
  let now = epochSeconds(start);
  return {
    now: () => now,
    advance: (seconds) => {
      now = epochSeconds(now + seconds);
    },
  };
};

/** The wall clock: the in-memory runtime's real-time default. */
export const systemClock = (): Clock => ({ now: () => epochSeconds(Math.floor(Date.now() / 1000)) });

/** Opaque key material; the engine never inspects it. */
interface KeyLike {
  readonly type: string;
}

interface SubtleLike {
  generateKey(
    algorithm: { name: "Ed25519" },
    extractable: boolean,
    usages: readonly string[],
  ): Promise<{ privateKey: KeyLike; publicKey: KeyLike }>;
  exportKey(format: "raw", key: KeyLike): Promise<ArrayBuffer>;
  sign(algorithm: { name: "Ed25519" }, key: KeyLike, data: Uint8Array): Promise<ArrayBuffer>;
  verify(algorithm: { name: "Ed25519" }, key: KeyLike, signature: Uint8Array, data: Uint8Array): Promise<boolean>;
  digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
}

const subtle: SubtleLike | undefined = (globalThis as { crypto?: { subtle?: SubtleLike } }).crypto?.subtle;

/** What the engine signs envelopes with and verifies against. */
export interface Signer {
  readonly keyId: string;
  readonly algorithm: string;
  sign(payload: string): Promise<string>;
  verify(payload: string, signature: string): Promise<boolean>;
  /** The public key, base64 raw bytes — what verifiers receive first. */
  publicKey(): Promise<string>;
}

const signerFromKeys = (
  subtle: SubtleLike,
  keyId: string,
  pair: { privateKey: KeyLike; publicKey: KeyLike },
): Signer => ({
  keyId,
  algorithm: "Ed25519",
  publicKey: async () => base64Encode(new Uint8Array(await subtle.exportKey("raw", pair.publicKey))),
  sign: async (payload) =>
    base64UrlEncode(new Uint8Array(await subtle.sign({ name: "Ed25519" }, pair.privateKey, utf8(payload)))),
  verify: async (payload, signature) => {
    try {
      return await subtle.verify(
        { name: "Ed25519" },
        pair.publicKey,
        base64UrlDecode(signature),
        utf8(payload),
      );
    } catch {
      return false;
    }
  },
});

/** Ed25519 via Web Platform crypto — the one algorithm v1 ships. */
export const webCryptoSigner = async (keyId: string): Promise<Signer> => {
  if (subtle === undefined) throw new Error("Web Platform crypto (crypto.subtle) is unavailable");
  const subtleInstance = subtle;
  return signerFromKeys(
    subtleInstance,
    keyId,
    await subtleInstance.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]),
  );
};

/** SHA-256 hex, for hashing refresh handles at rest. */
export const sha256Hex = async (value: string): Promise<string> => {
  if (subtle === undefined) throw new Error("Web Platform crypto (crypto.subtle) is unavailable");
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
