// The provider-callback exchange against a real relying-party round trip.
//
// devidp is the third party here: discovery, the authorization redirect, the
// code exchange, JWKS, and ID-token verification all run through it.  The
// only injection is the fetch seam, so the production runtime path is the
// one under test.

import { AUTHORITY_INTERFACE_VERSION } from "org-hats/authority";
import { beforeEach, describe, expect, it } from "vitest";
import { exchangeCodeForEvidence, resetExchangeCaches } from "../src/exchange";
import devidp from "./fixtures/devidp";
import type { Env as DevIdpEnv } from "./fixtures/devidp/env";

const ISSUER = "https://devidp.test";
const CLIENT = "org-hats-dev";
const REDIRECT = "https://example.test/auth/callback";
const NONCE = "nonce-1";
const VERIFIER = "test-verifier-0123456789-abcdefghijklmnopqrstuvwxyz";

const devIdpEnv: DevIdpEnv = {
  DEVIDP_ENABLED: "true",
  DEVIDP_SIGNING_KEY:
    "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgmWw66KOJJsFPlDYUFwqQYLZ5L8+jVJCa4M4XwmeFmuKhRANCAAShDhmcOyVrajVzqZFJvrj/g8XDl3QyeMWeZ98ih2O/398x5BOSXDcURC8zieppQnxXXXpZ1z8rDi6sgOtD8sWf",
  DEVIDP_CODE_KEY:
    "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  DEVIDP_CLIENT_ID: CLIENT,
  DEVIDP_REDIRECT_URIS: REDIRECT,
};

const b64url = (bytes: Uint8Array): string => {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const challengeOf = async (verifier: string): Promise<string> =>
  b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));

const providerFetch: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  return devidp.fetch(request, devIdpEnv);
};

/** Drive the authorization endpoint and return the code it mints. */
const authorize = async (nonce: string, verifier: string): Promise<string> => {
  const url = new URL(`${ISSUER}/authorize`);
  url.searchParams.set("client_id", CLIENT);
  url.searchParams.set("redirect_uri", REDIRECT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid");
  url.searchParams.set("state", "state-1");
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", await challengeOf(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("login_hint", "dana");

  const response = await providerFetch(url, { redirect: "manual" });
  expect(response.status).toBe(302);
  const location = response.headers.get("location");
  if (location === null) throw new Error("devidp did not redirect");
  const code = new URL(location).searchParams.get("code");
  if (code === null) throw new Error("devidp did not mint a code");
  return code;
};

const exchange = (code: string, expectedNonce = NONCE, verifier = VERIFIER) =>
  exchangeCodeForEvidence(
    {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      operationId: "op-devidp-test",
      issuer: ISSUER,
      clientId: CLIENT,
      redirectUri: REDIRECT,
      code,
      codeVerifier: verifier,
      expectedNonce,
    },
    { issuer: ISSUER, clientId: CLIENT },
    providerFetch,
  );

describe("the provider-callback exchange against devidp", () => {
  beforeEach(() => resetExchangeCaches());

  it("returns verified evidence for a real code and ID token", async () => {
    const result = await exchange(await authorize(NONCE, VERIFIER));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence).toMatchObject({
      provider: ISSUER,
      subject: "dana",
      amr: ["federated"],
    });
  });

  it("refuses a token whose nonce does not match", async () => {
    const result = await exchange(await authorize(NONCE, VERIFIER), "another-nonce");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unauthenticated");
  });

  it("refuses a code the PKCE verifier did not mint", async () => {
    const result = await exchange(await authorize(NONCE, VERIFIER), NONCE, `${VERIFIER}-wrong`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unauthenticated");
  });
});
