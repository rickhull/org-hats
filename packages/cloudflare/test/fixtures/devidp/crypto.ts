/**
 * The small amount of encoding and signing a provider needs.
 *
 * Kept apart from the routes so the route handlers read as protocol rather
 * than as byte manipulation.
 */

const encoder = new TextEncoder();

export const b64url = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const b64urlJson = (value: unknown): string => b64url(encoder.encode(JSON.stringify(value)));

export const b64urlDecode = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const b64Decode = (s: string): Uint8Array => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** The ID-token signing key, imported from configuration rather than
 *  generated, so every isolate signs with the key the JWKS advertises. */
export const signingKey = (pkcs8Base64: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "pkcs8",
    b64Decode(pkcs8Base64) as unknown as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

/** A published JWK: the Workers `JsonWebKey` type omits `kid`, `alg`, and
 *  `use`, which a key set must carry for a relying party to select a key. */
export interface PublishedJwk extends JsonWebKey {
  readonly kid: string;
  readonly alg: "ES256";
  readonly use: "sig";
}

/** The public half, as the one JWK this provider advertises. */
export const publicJwk = async (pkcs8Base64: string, kid: string): Promise<PublishedJwk> => {
  // A PKCS#8 import cannot be exported as public, so the public half is
  // derived by importing the private key as extractable and re-exporting.
  const priv = await crypto.subtle.importKey(
    "pkcs8",
    b64Decode(pkcs8Base64) as unknown as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"],
  );
  const jwk = (await crypto.subtle.exportKey("jwk", priv)) as JsonWebKey;
  if (jwk.kty === undefined || jwk.crv === undefined || jwk.x === undefined || jwk.y === undefined) {
    throw new Error("the exported P-256 key is incomplete");
  }
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid, alg: "ES256", use: "sig" };
};

export const hmacKey = (secretHex: string): Promise<CryptoKey> => {
  const raw = new Uint8Array((secretHex.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));
  return crypto.subtle.importKey(
    "raw",
    raw as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
};

export const hmacSign = async (payload: string, key: CryptoKey): Promise<string> =>
  b64url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(payload) as unknown as ArrayBuffer),
    ),
  );

export const hmacVerify = (payload: string, signature: string, key: CryptoKey): Promise<boolean> =>
  crypto.subtle.verify(
    "HMAC",
    key,
    b64urlDecode(signature) as unknown as ArrayBuffer,
    encoder.encode(payload) as unknown as ArrayBuffer,
  );

/** An ES256 JWT.  The signature is raw r||s, which is what WebCrypto's
 *  ECDSA produces and what a JOSE verifier expects. */
export const signJwt = async (
  claims: Record<string, unknown>,
  key: CryptoKey,
  kid: string,
): Promise<string> => {
  const payload = `${b64urlJson({ alg: "ES256", typ: "JWT", kid })}.${b64urlJson(claims)}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(payload) as unknown as ArrayBuffer,
  );
  return `${payload}.${b64url(new Uint8Array(signature))}`;
};

/** The PKCE check: S256 of the verifier must equal the stored challenge. */
export const pkceMatches = async (verifier: string, challenge: string): Promise<boolean> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(verifier) as unknown as ArrayBuffer,
  );
  return b64url(new Uint8Array(digest)) === challenge;
};
