// The provider-callback exchange — Cloudflare runtime surface, not portable
// seam (docs/authority_redesign.md § Identity boundary): discovery, the
// authorization-code POST, JWKS with rotation refetch, and ID-token
// verification execute where the client secret is sealed, and the only thing
// that comes back is typed, verified principal evidence.
//
// The positions (relay, 2026-10-25, accepted by the consumer):
//   1. the input is what the callback already holds — explicit, no handle;
//   2. the helper returns evidence; issuance stays `accessFromProviderEvidence`;
//   3. the caller passes the expected nonce; the runtime verifies it;
//   4. discovery and JWKS live here, with the secret, not in the host.

import { AUTHORITY_INTERFACE_VERSION, type PrincipalEvidence, type Failure } from "org-hats/authority";
import { base64UrlDecode, utf8 } from "org-hats/access";

/** What the host's callback already holds when it calls. Nothing here is
 * derivable from a handle, and nothing here is a secret. */
export interface EvidenceFromProviderCodeInput {
  readonly interfaceVersion: typeof AUTHORITY_INTERFACE_VERSION;
  readonly operationId: string;
  /** The issuer identifier, exactly as the host configured it. */
  readonly issuer: string;
  readonly clientId: string;
  readonly redirectUri: string;
  /** The authorization code from the callback query. */
  readonly code: string;
  /** The PKCE verifier the host generated before the redirect. */
  readonly codeVerifier: string;
  /** The nonce the host expects; the runtime verifies the token against it. */
  readonly expectedNonce: string;
}

export type EvidenceFromProviderCodeResult =
  | { readonly ok: true; readonly evidence: PrincipalEvidence }
  | { readonly ok: false; readonly failure: Failure };

const failed = (failure: Failure): EvidenceFromProviderCodeResult => ({ ok: false, failure });

// --- discovery and JWKS caching ---------------------------------------------------
//
// Per isolate, keyed by issuer, with a TTL. An unknown or failing signature
// triggers exactly one refetch per exchange, which is the rotation window.

interface Discovery {
  /** The token endpoint, where the authorization code is exchanged. The
   * authorization endpoint is the browser redirect and belongs to the host;
   * the exchange never needs it. */
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
}

/** A JWKS key with the JWS-registration fields `workers-types` leaves off
 * `JsonWebKey`. */
type Jwk = JsonWebKey & { readonly kid?: string };

const DISCOVERY_TTL_SECONDS = 24 * 60 * 60;
const JWKS_TTL_SECONDS = 60 * 60;

const discoveryCache = new Map<string, { value: Discovery; expiresAt: number }>();
const jwksCache = new Map<string, { value: readonly Jwk[]; expiresAt: number }>();

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** A discovery document that is reachable but not trustworthy: the provider
 * answered, and the answer is wrong. Distinct from a network failure so the
 * exchange can report `unauthenticated` rather than `unavailable`. */
class MetadataError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`fetch ${url} failed with ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new MetadataError("the provider returned invalid JSON");
  }
};

/** RFC 8414 §2.1: the server metadata endpoints are https URLs. */
const httpsEndpoint = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new MetadataError(`the discovery document lacks ${field}`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MetadataError(`the discovery document's ${field} is not a URL`);
  }
  if (url.protocol !== "https:") {
    throw new MetadataError(`the discovery document's ${field} must use https`);
  }
  return value;
};

const discoveryOf = async (issuer: string): Promise<Discovery> => {
  const cached = discoveryCache.get(issuer);
  if (cached !== undefined && cached.expiresAt > nowSeconds()) return cached.value;
  const url = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  const document = await fetchJson(url);
  if (!isRecord(document)) throw new MetadataError("the discovery document is not an object");
  // RFC 8414 §3.3: `issuer` is required and must identify this issuer.
  if (document["issuer"] !== issuer) {
    throw new MetadataError("the discovery document names a different issuer");
  }
  const value: Discovery = {
    tokenEndpoint: httpsEndpoint(document["token_endpoint"], "token_endpoint"),
    jwksUri: httpsEndpoint(document["jwks_uri"], "jwks_uri"),
  };
  discoveryCache.set(issuer, { value, expiresAt: nowSeconds() + DISCOVERY_TTL_SECONDS });
  return value;
};

const jwksOf = async (issuer: string, jwksUri: string): Promise<readonly Jwk[]> => {
  const cached = jwksCache.get(issuer);
  if (cached !== undefined && cached.expiresAt > nowSeconds()) return cached.value;
  const document = (await fetchJson(jwksUri)) as { keys?: unknown };
  if (!Array.isArray(document.keys)) throw new Error("the JWKS document has no keys");
  const value = document.keys as Jwk[];
  jwksCache.set(issuer, { value, expiresAt: nowSeconds() + JWKS_TTL_SECONDS });
  return value;
};

// --- the ID token -------------------------------------------------------------------

interface TokenClaims {
  readonly sub: string;
  readonly iss: string;
  readonly aud: string | readonly string[];
  readonly nonce?: string;
  readonly exp: number;
  /** OIDC ID tokens carry `iat`; RFC 7519 calls it informational, but the
   * issuer must state when the token was issued. */
  readonly iat: number;
  /** RFC 7519 §4.1.5: if present, the token is not valid before this time. */
  readonly nbf?: number;
  /** OIDC Core §3.1.3.7: required when `aud` has more than one value. */
  readonly azp?: string;
  readonly name?: string;
  readonly amr?: readonly string[];
  readonly auth_time?: number;
}

const decodeSegment = <T>(segment: string): T => {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment))) as T;
  } catch {
    throw new Error("the ID token is not well-formed");
  }
};

/** One DER INTEGER: a big-endian value with a leading zero when its high
 * bit would otherwise make it negative. */
const derInteger = (value: Uint8Array): Uint8Array => {
  const pad = ((value[0] ?? 0) & 0x80) !== 0;
  return Uint8Array.from([0x02, value.length + (pad ? 1 : 0), ...(pad ? [0] : []), ...value]);
};

/** JWS signs ES256 as raw `r || s` (64 bytes) per RFC 7518; WebCrypto
 * verifies DER per the WebCrypto spec — and workerd verifies raw, like it
 * signs. Both forms are tried, so the verifier works on either shape. The
 * DER form is a real conversion, not a fixed-width wrapper: an integer whose
 * high bit is set gets the leading zero DER requires. */
export const derSignatureOf = (raw: Uint8Array): Uint8Array => {
  if (raw.length !== 64) throw new Error("the ID token signature does not verify");
  const r = derInteger(raw.subarray(0, 32));
  const s = derInteger(raw.subarray(32, 64));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
};

interface VerifyOptions {
  readonly issuer: string;
  readonly clientId: string;
  readonly expectedNonce: string;
  readonly keys: readonly Jwk[];
}

const verifyIdToken = async (token: string, options: VerifyOptions): Promise<TokenClaims> => {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("the ID token is not a JWS compact serialization");
  const header = decodeSegment<{ alg?: unknown; kid?: unknown; crit?: unknown }>(parts[0] ?? "");
  const claims = decodeSegment<TokenClaims>(parts[1] ?? "");
  const signature = base64UrlDecode(parts[2] ?? "");

  if (typeof header.alg !== "string" || (header.alg !== "ES256" && header.alg !== "RS256")) {
    throw new Error(`the ID token algorithm ${String(header.alg ?? "(none)")} is not accepted`);
  }
  // RFC 7515 §4.1.11: a `crit` extension the verifier does not understand
  // must be rejected; this verifier understands none.
  if (header.crit !== undefined) throw new Error("the ID token carries an unsupported critical header");
  if (header.kid !== undefined && typeof header.kid !== "string") {
    throw new Error("the ID token header has an invalid kid");
  }
  const kid = header.kid;
  const isEs256 = header.alg === "ES256";
  const wantedKty = isEs256 ? "EC" : "RSA";
  const candidates = options.keys.filter(
    (key) => key.kty === wantedKty && (kid === undefined || key.kid === kid),
  );
  // RS256 is RSASSA-PKCS1-v1_5 with SHA-256 (RFC 7518 §3.3); the hash is
  // part of both the import and the verify algorithm.
  const verifyAlgorithm = isEs256
    ? { name: "ECDSA", hash: { name: "SHA-256" } }
    : { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-256" } };
  const signed = utf8(`${parts[0]}.${parts[1]}`);
  let verified = false;
  for (const key of candidates) {
    try {
      // ES256 is P-256 (RFC 7518 §3.4). A key on another curve is tried,
      // not trusted — and here it is not even tried.
      if (isEs256 && key.crv !== "P-256") continue;
      const importAlgorithm = isEs256
        ? { name: "ECDSA", namedCurve: "P-256" }
        : { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-256" } };
      const cryptoKey = await crypto.subtle.importKey("jwk", key, importAlgorithm, false, ["verify"]);
      const forms = isEs256 ? [signature, derSignatureOf(signature)] : [signature];
      for (const signatureBytes of forms) {
        if (await crypto.subtle.verify(verifyAlgorithm, cryptoKey, signatureBytes, signed)) {
          verified = true;
          break;
        }
      }
      if (verified) break;
    } catch {
      // a candidate that fails to import or verify is tried, not trusted
    }
  }
  if (!verified) throw new Error("the ID token signature does not verify");

  if (claims.iss !== options.issuer) throw new Error("the ID token issuer does not match");
  const audiences = typeof claims.aud === "string"
    ? [claims.aud]
    : Array.isArray(claims.aud) && claims.aud.every((value) => typeof value === "string")
      ? claims.aud
      : [];
  if (!audiences.includes(options.clientId)) throw new Error("the ID token audience does not match");
  if (claims.azp !== undefined && typeof claims.azp !== "string") {
    throw new Error("the ID token authorized party is not a string");
  }
  if (audiences.length > 1 && claims.azp !== options.clientId) {
    throw new Error("the ID token authorized party does not match");
  }
  if (claims.nonce !== options.expectedNonce) throw new Error("the ID token nonce does not match");
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || nowSeconds() >= claims.exp) {
    throw new Error("the ID token is expired");
  }
  if (typeof claims.iat !== "number" || !Number.isFinite(claims.iat)) {
    throw new Error("the ID token has no issued-at time");
  }
  if (
    claims.nbf !== undefined &&
    (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf) || nowSeconds() < claims.nbf)
  ) {
    throw new Error("the ID token is not yet valid");
  }
  if (typeof claims.sub !== "string" || claims.sub.length === 0) throw new Error("the ID token has no subject");
  if (
    claims.amr !== undefined &&
    (!Array.isArray(claims.amr) || !claims.amr.every((value) => typeof value === "string" && value.length > 0))
  ) {
    throw new Error("the ID token amr is not a list of method references");
  }
  if (
    claims.auth_time !== undefined &&
    (typeof claims.auth_time !== "number" || !Number.isFinite(claims.auth_time))
  ) {
    throw new Error("the ID token auth_time is not a timestamp");
  }
  if (claims.name !== undefined && typeof claims.name !== "string") {
    throw new Error("the ID token name is not a string");
  }
  return claims;
};

const evidenceOf = (claims: TokenClaims, issuer: string): PrincipalEvidence => ({
  provider: issuer,
  subject: claims.sub,
  ...(claims.name === undefined ? {} : { displayName: claims.name }),
  ...(claims.amr === undefined ? {} : { amr: [...claims.amr] }),
  ...(claims.auth_time === undefined ? {} : { authTime: claims.auth_time }),
});

// --- the sealed provider configuration -----------------------------------------------

/** The provider configuration an operator installs in organization
 * authority: sealed at rest, parsed only here, never returned to a caller. */
export interface SealedProviderConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret?: string;
}

export const parseSealedProviderConfig = (sealed: string): SealedProviderConfig => {
  const parsed = JSON.parse(sealed) as Partial<SealedProviderConfig>;
  if (typeof parsed.issuer !== "string" || typeof parsed.clientId !== "string") {
    throw new Error("the sealed provider configuration lacks its issuer or clientId");
  }
  return parsed as SealedProviderConfig;
};

// --- the exchange ---------------------------------------------------------------------

/** Exchange an authorization code for verified principal evidence. The
 * caller supplies exactly what its callback holds; the runtime holds the
 * secret, does the round trips, and answers with evidence or a closed
 * failure — `unauthenticated` for anything the provider or token got wrong,
 * `unavailable` for a provider that could not be reached, `invalid-command`
 * for a malformed input. */
export const exchangeCodeForEvidence = async (
  input: EvidenceFromProviderCodeInput,
  config: SealedProviderConfig,
): Promise<EvidenceFromProviderCodeResult> => {
  if (input.interfaceVersion !== AUTHORITY_INTERFACE_VERSION) {
    return failed({ kind: "wrong-interface-version" });
  }
  const fields = [
    ["operationId", input.operationId],
    ["issuer", input.issuer],
    ["clientId", input.clientId],
    ["redirectUri", input.redirectUri],
    ["code", input.code],
    ["codeVerifier", input.codeVerifier],
    ["expectedNonce", input.expectedNonce],
  ] as const;
  for (const [field, value] of fields) {
    if (value.length === 0) {
      return failed({ kind: "invalid-command", detail: `${field} must be a non-empty string` });
    }
  }
  // RFC 7636 §4.1: 43-128 unreserved characters. The host creates the
  // verifier; the runtime refuses a malformed one before a round trip.
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(input.codeVerifier)) {
    return failed({ kind: "invalid-command", detail: "codeVerifier must be 43-128 unreserved characters" });
  }
  if (input.issuer !== config.issuer || input.clientId !== config.clientId) {
    return failed({ kind: "unauthenticated", detail: "the sealed provider configuration does not match the request" });
  }

  let discovery: Discovery;
  try {
    discovery = await discoveryOf(input.issuer);
  } catch (error) {
    // A reachable provider with a wrong discovery document is a trust
    // failure (`unauthenticated`); a provider that could not be reached is
    // `unavailable`.
    return failed({
      kind: error instanceof MetadataError ? "unauthenticated" : "unavailable",
      detail: error instanceof Error ? error.message : "the provider could not be reached",
    });
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    ...(config.clientSecret === undefined ? {} : { client_secret: config.clientSecret }),
  });
  let idToken: string;
  try {
    const response = await fetch(discovery.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      return failed({ kind: "unauthenticated", detail: `the provider refused the code (${response.status})` });
    }
    const token = (await response.json()) as { id_token?: unknown };
    if (typeof token.id_token !== "string") {
      return failed({ kind: "unauthenticated", detail: "the provider returned no ID token" });
    }
    idToken = token.id_token;
  } catch {
    return failed({ kind: "unavailable", detail: "the token endpoint could not be reached" });
  }

  try {
    const keys = await jwksOf(input.issuer, discovery.jwksUri);
    const claims = await verifyIdToken(idToken, {
      issuer: input.issuer,
      clientId: input.clientId,
      expectedNonce: input.expectedNonce,
      keys,
    });
    return { ok: true, evidence: evidenceOf(claims, input.issuer) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "the ID token did not verify";
    if (message !== "the ID token signature does not verify") {
      return failed({ kind: "unauthenticated", detail: message });
    }
    // the signature failing against cached keys is the rotation window:
    // one refetch, one retry, then the failure stands. A malformed token is
    // not a rotation signal, so only a signature failure gets the retry.
    try {
      jwksCache.delete(input.issuer);
      const fresh = await jwksOf(input.issuer, discovery.jwksUri);
      const claims = await verifyIdToken(idToken, {
        issuer: input.issuer,
        clientId: input.clientId,
        expectedNonce: input.expectedNonce,
        keys: fresh,
      });
      return { ok: true, evidence: evidenceOf(claims, input.issuer) };
    } catch (retryError) {
      return failed({
        kind: "unauthenticated",
        detail: retryError instanceof Error ? retryError.message : message,
      });
    }
  }
};

/** Test seam: clear the per-isolate caches. */
export const resetExchangeCaches = (): void => {
  discoveryCache.clear();
  jwksCache.clear();
};
