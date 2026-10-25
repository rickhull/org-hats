// The provider-callback exchange against a synthetic IdP: discovery, the
// authorization-code POST, and JWKS are served by a fetch stub (the exchange
// runs in this isolate, so its global fetch is ours to serve); the ID token
// is signed with a real ES256 key. Exercises the helper and the runtime
// orchestration that resolves the sealed configuration from the
// organization directory.

import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTHORITY_INTERFACE_VERSION } from "org-hats/authority";
import { base64UrlEncode, utf8 } from "org-hats/access";
import type { Env } from "../src/env";
import {
  derSignatureOf,
  exchangeCodeForEvidence,
  resetExchangeCaches,
  type EvidenceFromProviderCodeInput,
} from "../src/exchange";
import { evidenceFromProviderCode } from "../src/runtime";

const ISSUER = "https://idp.example";
const CLIENT_ID = "qm-tenant";
const REDIRECT_URI = "https://tenant.example/auth/callback";
const CONFIG = { issuer: ISSUER, clientId: CLIENT_ID, clientSecret: "sealed-secret" };
/** RFC 7636: 43-128 unreserved characters. */
const CODE_VERIFIER = `verifier-${"a".repeat(34)}`;

const b64url = (bytes: Uint8Array): string => base64UrlEncode(bytes);
const jsonSegment = (value: unknown): string => b64url(utf8(JSON.stringify(value)));

/** ECDSA P-256 keys and a JWS compact ID token with a raw r||s signature. */
const providerKeys = async (kid = "key-1", curve: "P-256" | "P-384" = "P-256") => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: curve }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const withKid = { ...jwk, kid, alg: "ES256", use: "sig" };

  const sign = async (
    claims: Record<string, unknown>,
    headerExtra: Record<string, unknown> = {},
  ): Promise<string> => {
    const header = jsonSegment({ alg: "ES256", kid, ...headerExtra });
    const payload = jsonSegment(claims);
    // workerd's ECDSA sign already emits the raw r||s JWS form
    const raw = new Uint8Array(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, utf8(`${header}.${payload}`)),
    );
    return `${header}.${payload}.${b64url(raw)}`;
  };

  return { jwk: withKid, sign };
};

/** An RS256 signer, the other algorithm the exchange accepts. */
const providerRsaKeys = async (kid = "rsa-1") => {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const withKid = { ...jwk, kid, alg: "RS256", use: "sig" };
  const sign = async (claims: Record<string, unknown>): Promise<string> => {
    const header = jsonSegment({ alg: "RS256", kid });
    const payload = jsonSegment(claims);
    const signature = new Uint8Array(
      await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, utf8(`${header}.${payload}`)),
    );
    return `${header}.${payload}.${b64url(signature)}`;
  };
  return { jwk: withKid, sign };
};

interface Served {
  restore: () => void;
  requests: { method: string; url: string; body?: string }[];
}

/** Serve fixed routes from the isolate's global fetch; a queue of bodies per
 * route pops one per call, so the rotation test can change the JWKS answer. */
const serve = (
  routes: { method: string; url: string; bodies: unknown[] }[],
): Served => {
  const original = globalThis.fetch;
  const requests: { method: string; url: string; body?: string }[] = [];
  const queues = routes.map((route) => ({ ...route, pending: [...route.bodies] }));
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const recordedBody =
      init?.body instanceof URLSearchParams
        ? init.body.toString()
        : typeof init?.body === "string"
          ? init.body
          : undefined;
    requests.push({
      method,
      url,
      ...(recordedBody !== undefined ? { body: recordedBody } : {}),
    });
    for (const route of queues) {
      if (route.method !== method || route.url !== url) continue;
      const body = route.pending.length > 1 ? route.pending.shift() : route.pending[0];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("no route", { status: 404 });
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; }, requests };
};

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const input = (overrides: Partial<EvidenceFromProviderCodeInput> = {}): EvidenceFromProviderCodeInput => ({
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  operationId: "op-9f2e6ad4",
  issuer: ISSUER,
  clientId: CLIENT_ID,
  redirectUri: REDIRECT_URI,
  code: "auth-code-1",
  codeVerifier: CODE_VERIFIER,
  expectedNonce: "nonce-1",
  ...overrides,
});

const claims = (amr: string[], authTime: number, nonce = "nonce-1") => ({
  iss: ISSUER,
  aud: CLIENT_ID,
  nonce,
  iat: nowSeconds() - 60,
  exp: nowSeconds() + 600,
  sub: "subject-7",
  name: "Dana Okafor",
  amr,
  auth_time: authTime,
});

// Distinct authorization and token URLs: a standards-compliant provider
// serves the browser redirect at one and the code exchange at the other, so
// a fixture that points both at /token cannot catch a POST to the wrong one.
const AUTHORIZATION_URL = `${ISSUER}/authorize`;
const TOKEN_URL = `${ISSUER}/token`;
const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: AUTHORIZATION_URL,
  token_endpoint: TOKEN_URL,
  jwks_uri: `${ISSUER}/jwks`,
};

const serveIdp = (
  jwksBodies: unknown[],
  idToken: string,
  discovery: Record<string, unknown> = DISCOVERY,
): Served =>
  serve([
    { method: "GET", url: `${ISSUER}/.well-known/openid-configuration`, bodies: [discovery] },
    { method: "GET", url: `${ISSUER}/jwks`, bodies: jwksBodies },
    { method: "POST", url: TOKEN_URL, bodies: [{ id_token: idToken }] },
  ]);

describe("the provider-callback exchange", () => {
  let served: Served | undefined;

  beforeEach(() => {
    resetExchangeCaches();
  });

  afterEach(() => {
    served?.restore();
    served = undefined;
  });

  it("exchanges a code for verified evidence carrying the authentication facts", async () => {
    const { jwk, sign } = await providerKeys();
    const authTime = nowSeconds() - 60;
    served = serveIdp([{ keys: [jwk] }], await sign(claims(["hwk", "pin"], authTime)));

    const result = await exchangeCodeForEvidence(input(), CONFIG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence).toEqual({
      provider: ISSUER,
      subject: "subject-7",
      displayName: "Dana Okafor",
      amr: ["hwk", "pin"],
      authTime,
    });
    // the code exchange lands on the token endpoint, never the browser
    // redirect's authorization endpoint
    const post = served.requests.find((r) => r.method === "POST");
    expect(post).toBeDefined();
    expect(post?.url).toBe(TOKEN_URL);
    expect(served.requests.filter((r) => r.url === AUTHORIZATION_URL)).toHaveLength(0);
    // the token POST carried exactly the explicit input set plus the secret
    const body = new URLSearchParams(post?.body ?? "");
    expect(body.get("code")).toBe("auth-code-1");
    expect(body.get("code_verifier")).toBe(CODE_VERIFIER);
    expect(body.get("client_secret")).toBe("sealed-secret");
    expect(body.get("redirect_uri")).toBe(REDIRECT_URI);
  });

  it("refuses a wrong nonce as unauthenticated", async () => {
    const { jwk, sign } = await providerKeys();
    served = serveIdp([{ keys: [jwk] }], await sign(claims(["pwd"], nowSeconds(), "a-different-nonce")));

    const result = await exchangeCodeForEvidence(input(), CONFIG);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unauthenticated");
    expect(result.failure.detail).toMatch(/nonce/);
  });

  it("refuses a signature from a key the provider never published, after one refetch", async () => {
    const { sign } = await providerKeys();
    const other = await providerKeys();
    served = serveIdp([{ keys: [other.jwk] }], await sign(claims(["pwd"], nowSeconds())));

    const result = await exchangeCodeForEvidence(input(), CONFIG);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unauthenticated");
    expect(result.failure.detail).toMatch(/signature/);
    // the refetch happened: JWKS was fetched, then fetched again
    expect(served.requests.filter((r) => r.url.endsWith("/jwks"))).toHaveLength(2);
  });

  it("rotates: an unknown kid verifies after exactly one JWKS refetch", async () => {
    const { jwk, sign } = await providerKeys();
    const retired = await providerKeys("key-0");
    // the cached JWKS still names the retired kid; the token names the
    // current one — the refetch serves a JWKS that has it
    served = serveIdp(
      [{ keys: [retired.jwk] }, { keys: [jwk] }],
      await sign(claims(["pwd"], nowSeconds())),
    );

    const result = await exchangeCodeForEvidence(input(), CONFIG);
    expect(result.ok).toBe(true);
    expect(served.requests.filter((r) => r.url.endsWith("/jwks"))).toHaveLength(2);
  });

  it("answers unavailable when the provider cannot be reached", async () => {
    served = serve([]);
    const result = await exchangeCodeForEvidence(input(), CONFIG);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unavailable");
  });

  it("refuses a mismatched sealed configuration without touching the provider", async () => {
    served = serve([]);
    const result = await exchangeCodeForEvidence(input({ issuer: "https://other.example" }), CONFIG);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unauthenticated");
    expect(result.failure.detail).toMatch(/does not match/);
    expect(served.requests).toHaveLength(0);
  });

  it("refuses an issuer with no sealed configuration in the directory", async () => {
    const testEnv = { ...env, AUTHORITY_ORGANIZATION_IDS: "org-no-config" } as Env;
    const result = await evidenceFromProviderCode(testEnv, input());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unauthenticated");
    expect(result.failure.detail).toMatch(/no sealed provider configuration/);
  });

  it("resolves the sealed configuration from the organization directory end to end", async () => {
    const { jwk, sign } = await providerKeys();
    const authTime = nowSeconds() - 30;

    const orgId = "org-exchange";
    const org = env.ORGANIZATION.get(env.ORGANIZATION.idFromName(orgId));
    const bootstrapped = await org.fetch("https://authority.internal/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: orgId,
        actors: [{ actorId: "actor-exchange", displayName: "Dana Okafor" }],
        principalLinks: [],
        orgAdmins: [],
        sealedIdpConfig: JSON.stringify(CONFIG),
      }),
    });
    expect(bootstrapped.ok).toBe(true);

    served = serveIdp([{ keys: [jwk] }], await sign(claims(["pwd"], authTime)));
    const testEnv = { ...env, AUTHORITY_ORGANIZATION_IDS: orgId } as Env;
    const result = await evidenceFromProviderCode(testEnv, input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.subject).toBe("subject-7");
    expect(result.evidence.authTime).toBe(authTime);
  });

  it("requires the OIDC issued-at claim", async () => {
    const { jwk, sign } = await providerKeys();
    const { iat: _iat, ...withoutIssuedAt } = claims(["pwd"], nowSeconds());
    served = serveIdp([{ keys: [jwk] }], await sign(withoutIssuedAt));

    const result = await exchangeCodeForEvidence(input(), CONFIG);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unauthenticated");
    expect(result.failure.detail).toMatch(/issued-at/);
  });

  it("refuses a token before its not-before time", async () => {
    const { jwk, sign } = await providerKeys();
    served = serveIdp(
      [{ keys: [jwk] }],
      await sign({ ...claims(["pwd"], nowSeconds()), nbf: nowSeconds() + 600 }),
    );

    const result = await exchangeCodeForEvidence(input(), CONFIG);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unauthenticated");
    expect(result.failure.detail).toMatch(/not yet valid/);
  });

  it("refuses malformed optional claims instead of copying them", async () => {
    for (const [label, override, detail] of [
      ["amr", { amr: "pwd" }, /amr/],
      ["auth_time", { auth_time: "soon" }, /auth_time/],
      ["name", { name: 7 }, /name/],
    ] as const) {
      const { jwk, sign } = await providerKeys();
      served = serveIdp([{ keys: [jwk] }], await sign({ ...claims(["pwd"], nowSeconds()), ...override }));

      const result = await exchangeCodeForEvidence(input(), CONFIG);
      expect(result.ok, label).toBe(false);
      if (result.ok) continue;
      expect(result.failure.kind).toBe("unauthenticated");
      expect(result.failure.detail).toMatch(detail);
    }
  });

  it("requires azp when the audience has more than one value", async () => {
    const { jwk, sign } = await providerKeys();
    const multi = { ...claims(["pwd"], nowSeconds()), aud: [CLIENT_ID, "another-client"] };
    served = serveIdp([{ keys: [jwk] }], await sign(multi));
    const missing = await exchangeCodeForEvidence(input(), CONFIG);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.failure.kind).toBe("unauthenticated");
      expect(missing.failure.detail).toMatch(/authorized party/);
    }

    served?.restore();
    served = serveIdp([{ keys: [jwk] }], await sign({ ...multi, azp: CLIENT_ID }));
    const present = await exchangeCodeForEvidence(input(), CONFIG);
    expect(present.ok).toBe(true);
  });

  it("refuses a critical header it does not understand", async () => {
    const { jwk, sign } = await providerKeys();
    served = serveIdp(
      [{ keys: [jwk] }],
      await sign(claims(["pwd"], nowSeconds()), { crit: ["custom"], custom: true }),
    );

    const result = await exchangeCodeForEvidence(input(), CONFIG);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unauthenticated");
    expect(result.failure.detail).toMatch(/critical/);
  });

  it("refuses ES256 with a key on the wrong curve", async () => {
    const { jwk, sign } = await providerKeys("key-p384", "P-384");
    served = serveIdp([{ keys: [jwk] }], await sign(claims(["pwd"], nowSeconds())));

    const result = await exchangeCodeForEvidence(input(), CONFIG);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("unauthenticated");
    expect(result.failure.detail).toMatch(/signature/);
  });

  it("requires the discovery document to name the issuer and use https endpoints", async () => {
    served = serve([
      {
        method: "GET",
        url: `${ISSUER}/.well-known/openid-configuration`,
        bodies: [{ ...DISCOVERY, issuer: "https://other.example" }],
      },
    ]);
    const wrongIssuer = await exchangeCodeForEvidence(input(), CONFIG);
    expect(wrongIssuer.ok).toBe(false);
    if (!wrongIssuer.ok) {
      expect(wrongIssuer.failure.kind).toBe("unauthenticated");
      expect(wrongIssuer.failure.detail).toMatch(/issuer/);
    }

    served?.restore();
    served = serve([
      {
        method: "GET",
        url: `${ISSUER}/.well-known/openid-configuration`,
        bodies: [{ ...DISCOVERY, token_endpoint: "http://idp.example/token" }],
      },
    ]);
    const insecure = await exchangeCodeForEvidence(input(), CONFIG);
    expect(insecure.ok).toBe(false);
    if (!insecure.ok) {
      expect(insecure.failure.kind).toBe("unauthenticated");
      expect(insecure.failure.detail).toMatch(/https/);
    }
  });

  it("validates the PKCE verifier before touching the provider", async () => {
    served = serve([]);
    const result = await exchangeCodeForEvidence(input({ codeVerifier: "short" }), CONFIG);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("invalid-command");
    expect(result.failure.detail).toMatch(/codeVerifier/);
    expect(served.requests).toHaveLength(0);
  });


  it("verifies an RS256 token as well as ES256", async () => {
    const { jwk, sign } = await providerRsaKeys();
    served = serveIdp([{ keys: [jwk] }], await sign(claims(["pwd"], nowSeconds())));

    const result = await exchangeCodeForEvidence(input(), CONFIG);
    expect(result.ok).toBe(true);
  });

  it("refuses expired, wrong-issuer, wrong-audience, and none-alg tokens", async () => {
    const cases = [
      {
        label: "expired",
        claims: { ...claims(["pwd"], nowSeconds()), exp: nowSeconds() - 1 },
        header: {},
        detail: /expired/,
      },
      {
        label: "wrong issuer",
        claims: { ...claims(["pwd"], nowSeconds()), iss: "https://other.example" },
        header: {},
        detail: /issuer/,
      },
      {
        label: "wrong audience",
        claims: { ...claims(["pwd"], nowSeconds()), aud: "another-client" },
        header: {},
        detail: /audience/,
      },
      {
        label: "none algorithm",
        claims: claims(["pwd"], nowSeconds()),
        header: { alg: "none" },
        detail: /algorithm/,
      },
    ] as const;
    for (const entry of cases) {
      const { jwk, sign } = await providerKeys();
      served = serveIdp([{ keys: [jwk] }], await sign(entry.claims, entry.header));
      const result = await exchangeCodeForEvidence(input(), CONFIG);
      expect(result.ok, entry.label).toBe(false);
      if (result.ok) continue;
      expect(result.failure.kind).toBe("unauthenticated");
      expect(result.failure.detail).toMatch(entry.detail);
    }
  });

  it("encodes an ECDSA signature as valid DER integers", () => {
    const high = new Uint8Array(64).fill(0x01);
    high[0] = 0x80;
    high[32] = 0x80;
    const bothHigh = derSignatureOf(high);
    expect(bothHigh).toHaveLength(72);
    expect(Array.from(bothHigh.slice(0, 5))).toEqual([0x30, 0x46, 0x02, 0x21, 0x00]);
    expect(Array.from(bothHigh.slice(37, 40))).toEqual([0x02, 0x21, 0x00]);

    const plain = new Uint8Array(64).fill(0x01);
    const neitherHigh = derSignatureOf(plain);
    expect(neitherHigh).toHaveLength(70);
    expect(Array.from(neitherHigh.slice(0, 4))).toEqual([0x30, 0x44, 0x02, 0x20]);
    expect(Array.from(neitherHigh.slice(36, 38))).toEqual([0x02, 0x20]);

    expect(() => derSignatureOf(new Uint8Array(63))).toThrow(/signature/);
  });
});
