/**
 * The dev provider's deployment capabilities.
 *
 * It holds no customer state and no bindings: an identity provider is a
 * third party to both the tenant and authority, and this one exists only so
 * a real relying-party round trip can be exercised without a real provider.
 */
export interface Env {
  /**
   * `"true"` enables the provider.  Anything else refuses every route.
   *
   * There is no deployment in which this is true.  It is a var rather than a
   * secret so that a configuration review can see its value.
   */
  DEVIDP_ENABLED: string;

  /**
   * Base64 PKCS#8 of a P-256 private key, used to sign ID tokens as ES256.
   *
   * **Fixed, not generated.**  An earlier in-process version generated a
   * keypair per isolate and its comment said that was sufficient because
   * "signing and the JWKS that verifies it both happen within one callback
   * request."  That was true when the relying party called the token
   * exchange in-process.  As its own Worker — which is what makes it
   * reachable from whichever side performs the exchange — the JWKS fetch is
   * a separate request that may land on a different isolate, and a
   * per-isolate key would fail to verify a token it just signed.
   *
   * ES256 rather than EdDSA on purpose: the point of a dev provider is to
   * exercise the path a real provider takes, and real providers sign with
   * RS256 or ES256.  A dev-only algorithm would leave the production path
   * untested.
   */
  DEVIDP_SIGNING_KEY: string;

  /**
   * Hex HMAC secret for authorization codes.
   *
   * Codes are signed rather than stored: a code carries its own subject,
   * nonce, redirect, client, and PKCE challenge, so the provider needs no
   * storage and no object.  Its own expiry bounds replay; the relying party
   * is what enforces single use, by spending the state it issued.
   */
  DEVIDP_CODE_KEY: string;

  /** The one client this provider knows. */
  DEVIDP_CLIENT_ID: string;

  /**
   * Comma-separated exact redirect URIs this provider will send a code to.
   *
   * An allowlist even here.  A provider that redirects anywhere is the one
   * mistake worth not teaching: it would make this safe to point at only by
   * accident, and the habit would survive into something real.
   */
  DEVIDP_REDIRECT_URIS: string;
}
