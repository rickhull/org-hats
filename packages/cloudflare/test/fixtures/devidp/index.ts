/**
 * A development-only OpenID Provider.
 *
 * Its purpose is to exercise the whole relying-party path — discovery,
 * authorization, PKCE, the token exchange, ID-token verification against a
 * published key set — with no real provider and no network beyond this
 * Worker.  The login flow is then never blocked on getting a real identity
 * provider configured.
 *
 * It is its own Worker because an identity provider is a third party to
 * both the tenant and authority.  A Worker cannot fetch its own route, so a
 * provider living inside the relying party can only be called in-process —
 * which stops working the moment the token exchange moves to whichever side
 * holds the sealed client secret.  Separately addressable keeps both
 * answers reachable.
 *
 * It issues nothing anyone should trust: no authority, no hats, no session.
 * A signed assertion about a subject is all it produces, which is all a
 * provider ever produces.
 */
import { b64urlDecode, hmacKey, hmacSign, hmacVerify, pkceMatches, publicJwk, signJwt, signingKey } from "./crypto";
import type { Env } from "./env";

const KID = "devidp-1";
const CODE_TTL_SECONDS = 120;
const TOKEN_TTL_SECONDS = 10 * 60;

/** The default subject, when a caller does not choose one with
 *  `login_hint`.  An invented person: nothing here names a real one. */
const DEFAULT_SUBJECT = "rowan-hayes";

const enabled = (env: Env) => env.DEVIDP_ENABLED === "true";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/** A provider error, in the shape the protocol specifies, so a relying
 *  party exercises its real error path rather than a bespoke one. */
const oauthError = (error: string, description: string, status = 400) =>
  json({ error, error_description: description }, status);

interface CodeClaims {
  readonly sub: string;
  readonly nonce: string;
  readonly client_id: string;
  readonly redirect_uri: string;
  readonly challenge: string;
  readonly exp: number;
}

const mintCode = async (claims: CodeClaims, env: Env): Promise<string> => {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${body}.${await hmacSign(body, await hmacKey(env.DEVIDP_CODE_KEY))}`;
};

const readCode = async (code: string, env: Env): Promise<CodeClaims | null> => {
  // Every step is inside the guard, because every byte here is supplied by
  // the caller.  Base64 decoding a tampered signature throws rather than
  // returning garbage, so a decode outside this try turns a refusal into a
  // 500 — which is both a worse answer and a louder oracle than the
  // refusal it replaces.
  try {
    const [body, signature] = code.split(".");
    if (!body || !signature) return null;
    if (!(await hmacVerify(body, signature, await hmacKey(env.DEVIDP_CODE_KEY)))) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as CodeClaims;
    // Expiry bounds replay here; single use is the relying party's job,
    // enforced by spending the state it issued.
    return claims.exp > Math.floor(Date.now() / 1000) ? claims : null;
  } catch {
    return null;
  }
};

const redirectAllowed = (uri: string, env: Env): boolean =>
  env.DEVIDP_REDIRECT_URIS.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .includes(uri);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Disabled is indistinguishable from absent: a provider that announces
    // itself when switched off is a provider someone will try to use.
    if (!enabled(env)) return new Response("Not found\n", { status: 404 });

    const url = new URL(request.url);
    const issuer = url.origin;

    switch (url.pathname) {
      case "/.well-known/openid-configuration":
        return json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["ES256"],
          code_challenge_methods_supported: ["S256"],
          // No `scopes_supported` beyond this: there is no email scope, by
          // product posture, and a dev provider that offered one would
          // invite code that depends on it.
          scopes_supported: ["openid"],
        });

      case "/jwks":
        return json({ keys: [await publicJwk(env.DEVIDP_SIGNING_KEY, KID)] });

      case "/authorize": {
        if (request.method !== "GET") return oauthError("invalid_request", "GET only", 405);

        const q = url.searchParams;
        const clientId = q.get("client_id");
        const redirectUri = q.get("redirect_uri");

        // The redirect is validated before anything is echoed anywhere: an
        // unlisted one is refused here rather than redirected to with an
        // error, because redirecting to it is the thing being prevented.
        if (clientId !== env.DEVIDP_CLIENT_ID) {
          return oauthError("unauthorized_client", "unknown client_id");
        }
        if (!redirectUri || !redirectAllowed(redirectUri, env)) {
          return oauthError("invalid_request", "redirect_uri is not registered");
        }

        const state = q.get("state");
        const challenge = q.get("code_challenge");
        const failures: string[] = [];
        if (q.get("response_type") !== "code") failures.push("response_type must be code");
        if (!state) failures.push("state is required");
        if (!challenge) failures.push("code_challenge is required");
        if (q.get("code_challenge_method") !== "S256") failures.push("code_challenge_method must be S256");
        if (!(q.get("scope") ?? "").split(" ").includes("openid")) failures.push("scope must include openid");

        // Protocol failures that are not about the redirect go back through
        // it, which is what a real provider does and therefore what the
        // relying party must handle.
        if (failures.length > 0) {
          const back = new URL(redirectUri);
          back.searchParams.set("error", "invalid_request");
          back.searchParams.set("error_description", failures.join("; "));
          if (state) back.searchParams.set("state", state);
          return Response.redirect(back.toString(), 302);
        }

        const code = await mintCode(
          {
            sub: q.get("login_hint") ?? DEFAULT_SUBJECT,
            nonce: q.get("nonce") ?? "",
            client_id: clientId,
            redirect_uri: redirectUri,
            challenge: challenge!,
            exp: Math.floor(Date.now() / 1000) + CODE_TTL_SECONDS,
          },
          env,
        );

        const back = new URL(redirectUri);
        back.searchParams.set("code", code);
        back.searchParams.set("state", state!);
        return Response.redirect(back.toString(), 302);
      }

      case "/token": {
        if (request.method !== "POST") return oauthError("invalid_request", "POST only", 405);

        const form = await request.formData().catch(() => null);
        if (!form) return oauthError("invalid_request", "expected a form body");

        const field = (name: string) => {
          const value = form.get(name);
          return typeof value === "string" ? value : null;
        };

        if (field("grant_type") !== "authorization_code") {
          return oauthError("unsupported_grant_type", "authorization_code only");
        }
        const code = field("code");
        const verifier = field("code_verifier");
        if (!code || !verifier) return oauthError("invalid_request", "code and code_verifier are required");

        const claims = await readCode(code, env);
        // One answer for a forged code, a tampered code, and an expired
        // one: a caller learns that this code does not work and nothing
        // about why.
        if (!claims) return oauthError("invalid_grant", "code is not valid");

        if (field("client_id") !== claims.client_id) {
          return oauthError("invalid_grant", "code was issued to another client");
        }
        // The redirect must match the one the code was bound to, which is
        // what stops a code being replayed against a different endpoint.
        if (field("redirect_uri") !== claims.redirect_uri) {
          return oauthError("invalid_grant", "redirect_uri does not match the code");
        }
        if (!(await pkceMatches(verifier, claims.challenge))) {
          return oauthError("invalid_grant", "code_verifier does not match the challenge");
        }

        const now = Math.floor(Date.now() / 1000);
        const idToken = await signJwt(
          {
            iss: issuer,
            sub: claims.sub,
            aud: claims.client_id,
            iat: now,
            exp: now + TOKEN_TTL_SECONDS,
            amr: ["federated"],
            auth_time: now,
            ...(claims.nonce ? { nonce: claims.nonce } : {}),
          },
          await signingKey(env.DEVIDP_SIGNING_KEY),
          KID,
        );

        // No access token and no refresh token: nothing here has an API to
        // call, and issuing credentials nobody needs invites their use.
        return json({ token_type: "Bearer", expires_in: TOKEN_TTL_SECONDS, id_token: idToken });
      }

      default:
        return new Response("Not found\n", { status: 404 });
    }
  },
} satisfies ExportedHandler<Env>;
