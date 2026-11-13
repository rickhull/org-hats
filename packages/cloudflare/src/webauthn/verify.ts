// Signature verification shared by both WebAuthn ceremonies: the DER-to-raw
// conversion an ES256 assertion needs, the RS256 import, and the one call
// crypto.subtle makes. Real authenticators sign ASN.1 DER; WebCrypto's
// ECDSA verify takes raw r||s, so the conversion is part of the boundary
// rather than an authenticator-specific detail (docs/authority_redesign.md
// § Local credentials).

import type { CoseKey, ParseResult } from "./authenticator";

const fail = (reason: string): ParseResult<Uint8Array> => ({ ok: false, reason });

/** ASN.1 DER `ECDSA-Sig-Value` → the fixed 64-byte r||s WebCrypto verifies.
 * Strict on the encoding: a negative, non-minimal, truncated, or
 * over-long component is refused rather than repaired. */
export const ecdsaDerToRaw = (signature: Uint8Array): ParseResult<Uint8Array> => {
  // a P-256 signature is at most two 33-byte integers plus the sequence head
  if (signature.length < 8 || signature.length > 72) return fail("the signature is not a DER ECDSA sequence");
  if (signature[0] !== 0x30) return fail("the signature is not a DER sequence");
  const length = signature[1];
  if (length === undefined || length + 2 !== signature.length) {
    return fail("the signature's DER length does not match its bytes");
  }
  let offset = 2;
  const component = (): Uint8Array | undefined => {
    if (signature[offset] !== 0x02) return undefined;
    const size = signature[offset + 1];
    if (size === undefined || size === 0 || size > 33) return undefined;
    const start = offset + 2;
    const end = start + size;
    if (end > signature.length) return undefined;
    const bytes = signature.subarray(start, end);
    offset = end;
    if ((bytes[0]! & 0x80) !== 0) return undefined; // negative
    if (bytes.length === 33) {
      // the only 33-byte form is a leading zero before a high-bit integer
      if (bytes[0] !== 0) return undefined;
      const trimmed = bytes.subarray(1);
      if ((trimmed[0]! & 0x80) === 0) return undefined;
      return trimmed;
    }
    if (bytes.length > 32) return undefined;
    return bytes;
  };
  const r = component();
  if (r === undefined) return fail("the signature's r component is malformed");
  const s = component();
  if (s === undefined) return fail("the signature's s component is malformed");
  if (offset !== signature.length) return fail("the signature carries trailing bytes");
  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  return { ok: true, value: raw };
};

const base64UrlOf = (bytes: Uint8Array): string => {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Verify a ceremony signature over `signed` (authenticator data, and for a
 * registration the client-data hash appended). `false` is the whole refusal
 * surface: the caller turns it into its uniform answer. */
export const verifySignature = async (
  key: CoseKey,
  signed: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> => {
  try {
    if (key.alg === "ES256") {
      const converted = ecdsaDerToRaw(signature);
      if (!converted.ok) return false;
      const imported = await crypto.subtle.importKey(
        "raw",
        new Uint8Array([0x04, ...key.x, ...key.y]) as unknown as ArrayBuffer,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      return await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        imported,
        converted.value as unknown as ArrayBuffer,
        signed as unknown as ArrayBuffer,
      );
    }
    const imported = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: base64UrlOf(key.n), e: base64UrlOf(key.e), alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      imported,
      signature as unknown as ArrayBuffer,
      signed as unknown as ArrayBuffer,
    );
  } catch {
    // an unimportable or off-curve key is a refusal, not an exception
    return false;
  }
};
