// The WebAuthn ceremonies — Cloudflare runtime surface, not portable seam,
// beside the provider exchange (docs/authority_redesign.md § Local
// credentials). The host owns the browser; this module owns the proof.
//
// Registration mints the ceremony challenge against an activation request,
// verifies the registration response (client data, origin, relying-party
// id, attestation), and commits link + credential + consume atomically in
// the organization coordinator. Assertion mints a single-use challenge
// bound to the host's origin and relying-party id, verifies the signed
// assertion against the stored key, and issues through the same session
// path a federated login reaches. Both refusals are uniform.
//
// Everything cryptographic stays in crypto.subtle; parsing stays in
// ./webauthn/cbor, ./webauthn/authenticator, and ./webauthn/verify with the
// envelope gate's discipline. The activation secret is hashed at this
// boundary with the same SHA-256 rule the binding's activation methods use.
// The host passes the secret it delivered; no caller computes a digest.

import {
  AUTHORITY_INTERFACE_VERSION,
  isFailed,
  type AccessIssue,
  type Failure,
} from "org-hats/authority";
import { base64UrlDecode, utf8 } from "org-hats/access";
import type { Env } from "./env";
import { activationSecretHash, runtimeFor } from "./runtime";
import {
  parseAttestationObject,
  parseAuthenticatorData,
  type CoseKey,
} from "./webauthn/authenticator";
import { WEBAUTHN_CEREMONY_LIFETIME_SECONDS } from "./webauthn/constants";
import { verifySignature } from "./webauthn/verify";

export interface WebauthnRegistrationOptionsInput {
  readonly interfaceVersion: typeof AUTHORITY_INTERFACE_VERSION;
  readonly organizationId: string;
  /** The activation secret as delivered; hashed at this boundary, never a
   * caller-computed digest. */
  readonly secret: string;
  /** The relying-party id the host serves — the zone apex by contract.
   * Minted into the options so the browser's default (the origin host)
   * cannot create a credential the runtime will not accept. */
  readonly rpId: string;
}

export type WebauthnRegistrationOptionsResult =
  | {
    readonly ok: true;
    readonly challenge: string;
    /** The zone-apex relying party, stated to the browser. */
    readonly rp: { readonly id: string; readonly name: string };
    readonly user: { readonly id: string; readonly name: string; readonly displayName?: string };
    readonly pubKeyCredParams: readonly { readonly alg: "ES256" }[];
    /** Discoverable credentials are required: login is usernameless, so the
     * authenticator must hold the user handle itself. */
    readonly authenticatorSelection: {
      readonly residentKey: "required";
      readonly requireResidentKey: true;
      readonly userVerification: "preferred";
    };
    readonly attestation: "none";
    readonly timeout: number;
  }
  | { readonly ok: false; readonly failure: Failure };

export interface CredentialFromRegistrationInput {
  readonly interfaceVersion: typeof AUTHORITY_INTERFACE_VERSION;
  readonly organizationId: string;
  /** The same activation secret the options call took. */
  readonly secret: string;
  /** The relying-party id the host serves — the zone apex by contract. */
  readonly rpId: string;
  /** The origin the browser spoke to; the runtime verifies the ceremony
   * against exactly this, the expectedNonce pattern from the exchange. */
  readonly expectedOrigin: string;
  readonly credential: {
    readonly response: {
      /** base64url, as the browser's response carries them. */
      readonly attestationObject: string;
      readonly clientDataJSON: string;
    };
  };
}

export type CredentialFromRegistrationResult =
  | { readonly ok: true; readonly actorId: string }
  | { readonly ok: false; readonly failure: Failure };

const failed = (failure: Failure): { ok: false; failure: Failure } => ({ ok: false, failure });

/** The client data is untrusted JSON from the browser: parsed as a named
 * boundary, never trusted from a declared type. */
interface ClientData {
  readonly type: string;
  readonly challenge: string;
  readonly origin: string;
}

const parseClientData = (bytes: Uint8Array, ceremony: "webauthn.create" | "webauthn.get"): ClientData | Failure => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { kind: "invalid-command", detail: "client data is not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "invalid-command", detail: "client data is not an object" };
  }
  const record = parsed as Record<string, unknown>;
  if (record["type"] !== ceremony) {
    return {
      kind: "invalid-command",
      detail: ceremony === "webauthn.create"
        ? "client data is not a registration ceremony"
        : "client data is not an assertion ceremony",
    };
  }
  if (typeof record["challenge"] !== "string" || typeof record["origin"] !== "string") {
    return { kind: "invalid-command", detail: "client data is missing its challenge or origin" };
  }
  return { type: ceremony, challenge: record["challenge"], origin: record["origin"] };
};

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer));

const decoded = (text: string, field: string): Uint8Array | Failure => {
  try {
    return base64UrlDecode(text);
  } catch {
    return { kind: "invalid-command", detail: `${field} is not base64url` };
  }
};

/** Mint the ceremony options. The challenge rotates on every call, so a
 * stale options page cannot satisfy a later registration. */
export const webauthnRegistrationOptions = async (
  env: Env,
  input: WebauthnRegistrationOptionsInput,
): Promise<WebauthnRegistrationOptionsResult> => {
  if (input.interfaceVersion !== AUTHORITY_INTERFACE_VERSION) {
    return failed({ kind: "wrong-interface-version" });
  }
  if (input.rpId.length === 0 || input.secret.length === 0) {
    return failed({ kind: "invalid-command", detail: "rpId and secret must be non-empty strings" });
  }
  const secretHash = await activationSecretHash(input.secret);
  const response = await env.ORGANIZATION.get(env.ORGANIZATION.idFromName(input.organizationId))
    .fetch("https://authority.internal/webauthn-challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secretHash }),
    });
  const body = (await response.json()) as {
    ok: boolean;
    value?: { challenge: string; actorId: string; displayName?: string };
    failure?: Failure;
  };
  if (!body.ok || body.value === undefined) {
    return failed(body.failure ?? { kind: "unavailable", detail: "organization is unreachable" });
  }
  return {
    ok: true,
    challenge: body.value.challenge,
    rp: { id: input.rpId, name: input.rpId },
    user: {
      id: body.value.actorId,
      name: body.value.actorId,
      ...(body.value.displayName !== undefined ? { displayName: body.value.displayName } : {}),
    },
    pubKeyCredParams: [{ alg: "ES256" }],
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "preferred",
    },
    attestation: "none",
    timeout: WEBAUTHN_CEREMONY_LIFETIME_SECONDS * 1000,
  };
};

/** Verify the registration ceremony and enroll. Verification order:
 * stored challenge readable → client data parsed and matching (type,
 * challenge, origin) → relying-party id hash → attestation decoded →
 * self-attestation signature (when present) → atomic enrollment. */
export const credentialFromRegistration = async (
  env: Env,
  input: CredentialFromRegistrationInput,
): Promise<CredentialFromRegistrationResult> => {
  if (input.secret.length === 0) {
    return failed({ kind: "invalid-command", detail: "secret must be a non-empty string" });
  }
  const stub = env.ORGANIZATION.get(env.ORGANIZATION.idFromName(input.organizationId));
  const secretHash = await activationSecretHash(input.secret);

  const challengeResponse = await stub.fetch(
    `https://authority.internal/webauthn-challenge?secretHash=${encodeURIComponent(secretHash)}`,
  );
  const challengeBody = (await challengeResponse.json()) as {
    ok: boolean;
    value?: { challenge: string; actorId: string };
    failure?: Failure;
  };
  if (!challengeBody.ok || challengeBody.value === undefined) {
    return failed(challengeBody.failure ?? { kind: "unavailable", detail: "organization is unreachable" });
  }
  const { challenge } = challengeBody.value;

  const clientDataBytes = decoded(input.credential.response.clientDataJSON, "clientDataJSON");
  if (clientDataBytes instanceof Object && "kind" in clientDataBytes) return failed(clientDataBytes);
  const clientData = parseClientData(clientDataBytes as Uint8Array, "webauthn.create");
  if ("kind" in clientData) return failed(clientData);
  if (clientData.challenge !== challenge) {
    return failed({ kind: "unauthenticated", detail: "the ceremony's challenge does not match" });
  }
  if (clientData.origin !== input.expectedOrigin) {
    return failed({ kind: "unauthenticated", detail: "the ceremony's origin does not match" });
  }

  const attestationBytes = decoded(input.credential.response.attestationObject, "attestationObject");
  if (attestationBytes instanceof Object && "kind" in attestationBytes) return failed(attestationBytes);
  const registration = parseAttestationObject(attestationBytes as Uint8Array);
  if (!registration.ok) {
    return failed({ kind: "invalid-command", detail: registration.reason });
  }
  const { authenticator, authenticatorDataBytes, credentialId, credentialKey, attestation } = registration.value;
  if (!authenticator.userPresent) {
    return failed({ kind: "unauthenticated", detail: "the ceremony was not user-present" });
  }
  const rpIdHash = await sha256(utf8(input.rpId));
  const matches = authenticator.rpIdHash.length === rpIdHash.length &&
    authenticator.rpIdHash.every((byte, index) => byte === rpIdHash[index]);
  if (!matches) {
    return failed({ kind: "unauthenticated", detail: "the ceremony names another relying party" });
  }

  if (attestation !== undefined) {
    const algMatches =
      (credentialKey.alg === "ES256" && attestation.algorithm === -7) ||
      (credentialKey.alg === "RS256" && attestation.algorithm === -257);
    if (!algMatches || attestation.signature === undefined) {
      return failed({ kind: "invalid-command", detail: "the attestation algorithm does not match the key" });
    }
    const clientDataHash = await sha256(clientDataBytes as Uint8Array);
    const signed = new Uint8Array([...authenticatorDataBytes, ...clientDataHash]);
    if (!(await verifySignature(credentialKey, signed, attestation.signature))) {
      return failed({ kind: "invalid-signature" });
    }
  }

  const credentialIdText = base64UrlOf(credentialId);
  const registerResponse = await stub.fetch("https://authority.internal/webauthn-register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      secretHash,
      credentialId: credentialIdText,
      key:
        credentialKey.alg === "ES256"
          ? { alg: credentialKey.alg, x: base64UrlOf(credentialKey.x), y: base64UrlOf(credentialKey.y) }
          : { alg: credentialKey.alg, n: base64UrlOf(credentialKey.n), e: base64UrlOf(credentialKey.e) },
      signCount: authenticator.signCount,
      backupEligible: authenticator.backupEligible,
      backedUp: authenticator.backedUp,
    }),
  });
  const registerBody = (await registerResponse.json()) as {
    ok: boolean;
    value?: { actorId: string };
    failure?: Failure;
  };
  if (!registerBody.ok || registerBody.value === undefined) {
    return failed(registerBody.failure ?? { kind: "unavailable", detail: "organization is unreachable" });
  }
  return { ok: true, actorId: registerBody.value.actorId };
};

// --- assertion login -----------------------------------------------------------------

export interface WebauthnAssertionOptionsInput {
  readonly interfaceVersion: typeof AUTHORITY_INTERFACE_VERSION;
  readonly organizationId: string;
  /** The relying-party id the host serves — the zone apex by contract. */
  readonly rpId: string;
  /** The origin the assertion will be signed for; bound to the challenge. */
  readonly expectedOrigin: string;
}

export type WebauthnAssertionOptionsResult =
  | {
    readonly ok: true;
    readonly challenge: string;
    readonly rpId: string;
    readonly timeout: number;
  }
  | { readonly ok: false; readonly failure: Failure };

export interface CredentialFromAssertionInput {
  readonly interfaceVersion: typeof AUTHORITY_INTERFACE_VERSION;
  readonly organizationId: string;
  /** The operation whose session is being issued. */
  readonly operationId: string;
  /** The assertion's raw credential id, base64url — the stored key's name. */
  readonly credentialId: string;
  readonly response: {
    /** base64url, as the browser's assertion response carries them. */
    readonly authenticatorData: string;
    readonly clientDataJSON: string;
    readonly signature: string;
  };
}

export type CredentialFromAssertionResult =
  | ({ readonly ok: true } & AccessIssue)
  | { readonly ok: false; readonly failure: Failure };

/** Mint the assertion ceremony. The challenge is single-use and carries the
 * origin and relying-party id the host will verify against, so a challenge
 * minted for one context cannot be spent in another. */
export const webauthnAssertionOptions = async (
  env: Env,
  input: WebauthnAssertionOptionsInput,
): Promise<WebauthnAssertionOptionsResult> => {
  if (input.interfaceVersion !== AUTHORITY_INTERFACE_VERSION) {
    return failed({ kind: "wrong-interface-version" });
  }
  if (input.rpId.length === 0 || input.expectedOrigin.length === 0) {
    return failed({ kind: "invalid-command", detail: "rpId and expectedOrigin must be non-empty strings" });
  }
  const response = await env.ORGANIZATION.get(env.ORGANIZATION.idFromName(input.organizationId))
    .fetch("https://authority.internal/webauthn-assertion-challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rpId: input.rpId, expectedOrigin: input.expectedOrigin }),
    });
  const body = (await response.json()) as {
    ok: boolean;
    value?: { challenge: string; rpId: string };
    failure?: Failure;
  };
  if (!body.ok || body.value === undefined) {
    return failed(body.failure ?? { kind: "unavailable", detail: "organization is unreachable" });
  }
  return {
    ok: true,
    challenge: body.value.challenge,
    rpId: body.value.rpId,
    timeout: WEBAUTHN_CEREMONY_LIFETIME_SECONDS * 1000,
  };
};

/** The stored key is JSON in the coordinator, and a restored snapshot is not
 * a trust boundary: parse it into a verification key or refuse by name. */
const storedKeyOf = (value: unknown): CoseKey | Failure => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "unavailable", detail: "the stored credential key is unreadable" };
  }
  const record = value as Record<string, unknown>;
  const bytes = (field: string): Uint8Array | undefined => {
    const text = record[field];
    if (typeof text !== "string" || text.length === 0) return undefined;
    try {
      return base64UrlDecode(text);
    } catch {
      return undefined;
    }
  };
  const alg = record["alg"];
  if (alg === "ES256") {
    const x = bytes("x");
    const y = bytes("y");
    if (x === undefined || y === undefined || x.length !== 32 || y.length !== 32) {
      return { kind: "unavailable", detail: "the stored P-256 key is malformed" };
    }
    return { alg: "ES256", x, y };
  }
  if (alg === "RS256") {
    const n = bytes("n");
    const e = bytes("e");
    if (n === undefined || e === undefined) {
      return { kind: "unavailable", detail: "the stored RSA key is malformed" };
    }
    return { alg: "RS256", n, e };
  }
  return { kind: "unavailable", detail: "the stored credential key names no supported algorithm" };
};

/** Verify an assertion and issue through the existing session path. The
 * order is: parse the client data → read the bound ceremony → match origin
 * and RP id → parse the authenticator data → read the credential → verify
 * the signature → consume the challenge and advance the counter atomically
 * → issue. Every failure is the uniform `unauthenticated` once the ceremony
 * is well-formed. */
export const credentialFromAssertion = async (
  env: Env,
  input: CredentialFromAssertionInput,
): Promise<CredentialFromAssertionResult> => {
  if (input.interfaceVersion !== AUTHORITY_INTERFACE_VERSION) {
    return failed({ kind: "wrong-interface-version" });
  }
  const stub = env.ORGANIZATION.get(env.ORGANIZATION.idFromName(input.organizationId));

  const clientDataBytes = decoded(input.response.clientDataJSON, "clientDataJSON");
  if (clientDataBytes instanceof Object && "kind" in clientDataBytes) return failed(clientDataBytes);
  const clientData = parseClientData(clientDataBytes as Uint8Array, "webauthn.get");
  if ("kind" in clientData) return failed(clientData);

  const challengeResponse = await stub.fetch(
    `https://authority.internal/webauthn-assertion-challenge?challenge=${encodeURIComponent(clientData.challenge)}`,
  );
  const challengeBody = (await challengeResponse.json()) as {
    ok: boolean;
    value?: { rpId: string; origin: string };
    failure?: Failure;
  };
  if (!challengeBody.ok || challengeBody.value === undefined) {
    return failed(challengeBody.failure ?? { kind: "unauthenticated", detail: "the ceremony is not usable" });
  }
  const ceremony = challengeBody.value;
  if (clientData.origin !== ceremony.origin) {
    return failed({ kind: "unauthenticated", detail: "the ceremony's origin does not match" });
  }

  const authenticatorBytes = decoded(input.response.authenticatorData, "authenticatorData");
  if (authenticatorBytes instanceof Object && "kind" in authenticatorBytes) return failed(authenticatorBytes);
  const parsed = parseAuthenticatorData(authenticatorBytes as Uint8Array);
  if (!parsed.ok) return failed({ kind: "invalid-command", detail: parsed.reason });
  const authenticator = parsed.value;
  if (authenticator.credentialId !== undefined) {
    return failed({ kind: "invalid-command", detail: "an assertion carries no attested credential" });
  }
  if (!authenticator.userPresent) {
    return failed({ kind: "unauthenticated", detail: "the ceremony was not user-present" });
  }
  const rpIdHash = await sha256(utf8(ceremony.rpId));
  const matches = authenticator.rpIdHash.length === rpIdHash.length &&
    authenticator.rpIdHash.every((byte, index) => byte === rpIdHash[index]);
  if (!matches) {
    return failed({ kind: "unauthenticated", detail: "the ceremony names another relying party" });
  }

  const credentialResponse = await stub.fetch(
    `https://authority.internal/credential?credentialId=${encodeURIComponent(input.credentialId)}`,
  );
  const credentialBody = (await credentialResponse.json()) as {
    ok: boolean;
    value?: { key: unknown };
    failure?: Failure;
  };
  if (!credentialBody.ok || credentialBody.value === undefined) {
    return failed({ kind: "unauthenticated", detail: "the credential is not usable" });
  }
  const key = storedKeyOf(credentialBody.value.key);
  if ("kind" in key) return failed(key);

  const signature = decoded(input.response.signature, "signature");
  if (signature instanceof Object && "kind" in signature) return failed(signature);
  const clientDataHash = await sha256(clientDataBytes as Uint8Array);
  const signed = new Uint8Array([...(authenticatorBytes as Uint8Array), ...clientDataHash]);
  if (!(await verifySignature(key, signed, signature as Uint8Array))) {
    return failed({ kind: "unauthenticated", detail: "the assertion's signature does not verify" });
  }

  const completeResponse = await stub.fetch("https://authority.internal/webauthn-assertion-complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challenge: clientData.challenge,
      credentialId: input.credentialId,
      signCount: authenticator.signCount,
      backupEligible: authenticator.backupEligible,
      backedUp: authenticator.backedUp,
    }),
  });
  const completeBody = (await completeResponse.json()) as {
    ok: boolean;
    failure?: Failure;
  };
  if (!completeBody.ok) {
    return failed(completeBody.failure ?? { kind: "unavailable", detail: "organization is unreachable" });
  }

  const issued = await (await runtimeFor(env)).accessFromEvidence({
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    operationId: input.operationId,
    evidence: {
      provider: "webauthn",
      subject: input.credentialId,
      amr: ["webauthn"],
      authTime: Math.floor(Date.now() / 1000),
    },
  });
  if (isFailed(issued)) return failed(issued.failure);
  return { ok: true, envelope: issued.envelope, refresh: issued.refresh };
};

const base64UrlOf = (bytes: Uint8Array): string => {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
