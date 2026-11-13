// The WebAuthn registration ceremony — Cloudflare runtime surface, not
// portable seam, beside the provider exchange (docs/authority_redesign.md §
// Local credentials). The host owns the browser; this module owns the
// proof: it mints the ceremony challenge against an activation request,
// verifies the registration response (client data, origin, relying-party
// id, attestation), and commits link + credential + consume atomically in
// the organization coordinator.
//
// Everything cryptographic stays in crypto.subtle; parsing stays in
// ./webauthn/cbor and ./webauthn/authenticator with the envelope gate's
// discipline. The activation secret arrives as its SHA-256 hex digest —
// the same shape every other activation route takes, so one hashing rule
// covers every door.

import { AUTHORITY_INTERFACE_VERSION, type Failure } from "org-hats/authority";
import { base64UrlDecode, utf8 } from "org-hats/access";
import type { Env } from "./env";
import { parseAttestationObject } from "./webauthn/authenticator";

export interface WebauthnRegistrationOptionsInput {
  readonly interfaceVersion: typeof AUTHORITY_INTERFACE_VERSION;
  readonly organizationId: string;
  /** The activation request's digest, exactly as `/activation-accept` takes it. */
  readonly secretHash: string;
}

export type WebauthnRegistrationOptionsResult =
  | {
    readonly ok: true;
    readonly challenge: string;
    readonly user: { readonly id: string; readonly name: string; readonly displayName?: string };
    readonly pubKeyCredParams: readonly { readonly alg: "ES256" }[];
  }
  | { readonly ok: false; readonly failure: Failure };

export interface CredentialFromRegistrationInput {
  readonly interfaceVersion: typeof AUTHORITY_INTERFACE_VERSION;
  readonly organizationId: string;
  readonly secretHash: string;
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

const parseClientData = (bytes: Uint8Array): ClientData | Failure => {
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
  if (record["type"] !== "webauthn.create") {
    return { kind: "invalid-command", detail: "client data is not a registration ceremony" };
  }
  if (typeof record["challenge"] !== "string" || typeof record["origin"] !== "string") {
    return { kind: "invalid-command", detail: "client data is missing its challenge or origin" };
  }
  return { type: record["type"], challenge: record["challenge"], origin: record["origin"] };
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
  const response = await env.ORGANIZATION.get(env.ORGANIZATION.idFromName(input.organizationId))
    .fetch("https://authority.internal/webauthn-challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secretHash: input.secretHash }),
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
    user: {
      id: body.value.actorId,
      name: body.value.actorId,
      ...(body.value.displayName !== undefined ? { displayName: body.value.displayName } : {}),
    },
    pubKeyCredParams: [{ alg: "ES256" }],
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
  const stub = env.ORGANIZATION.get(env.ORGANIZATION.idFromName(input.organizationId));

  const challengeResponse = await stub.fetch(
    `https://authority.internal/webauthn-challenge?secretHash=${encodeURIComponent(input.secretHash)}`,
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
  const clientData = parseClientData(clientDataBytes as Uint8Array);
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
    if (credentialKey.alg !== "ES256" || attestation.algorithm !== -7) {
      return failed({ kind: "invalid-command", detail: "the attestation algorithm is not ES256" });
    }
    const verifyKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array([0x04, ...credentialKey.x, ...credentialKey.y]) as unknown as ArrayBuffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const clientDataHash = await sha256(clientDataBytes as Uint8Array);
    const signed = new Uint8Array([...authenticatorDataBytes, ...clientDataHash]);
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifyKey,
      attestation.signature as unknown as ArrayBuffer,
      signed as unknown as ArrayBuffer,
    );
    if (!verified) return failed({ kind: "invalid-signature" });
  }

  const credentialIdText = base64UrlOf(credentialId);
  const registerResponse = await stub.fetch("https://authority.internal/webauthn-register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      secretHash: input.secretHash,
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

const base64UrlOf = (bytes: Uint8Array): string => {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
