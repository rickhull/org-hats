// Registration through the claim (docs/cloudflare.md § Local credentials): the
// host mints ceremony options against an activation request, then presents
// the browser's registration response; the runtime verifies the ceremony,
// stores the credential, and binds the principal link atomically with the
// activation accept. The strict any-link guard applies untouched — one
// credential per actor is claim-bound.

import { env } from "cloudflare:test";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AUTHORITY_INTERFACE_VERSION } from "org-hats/authority";
import { call, organizationBootstrap } from "./helpers";
import type { Env } from "../src/env";
import {
  credentialFromRegistration,
  webauthnRegistrationOptions,
  webauthnRegistrationOptionsJson,
} from "../src/webauthn";
import { decodeCbor, type CborValue } from "../src/webauthn/cbor";

const LEAD = "actor-lead";
const CREW = "actor-crew";
const ORIGIN = "https://app.example.test";
const RP_ID = "example.test";

const org = (id: string) => env.ORGANIZATION.get(env.ORGANIZATION.idFromName(id));
const directory = (...ids: string[]): Env =>
  ({ ...env, AUTHORITY_ORGANIZATION_IDS: ids.join(",") }) as Env;

const secretHashOf = (secret: string): string =>
  createHash("sha256").update(secret, "utf8").digest("hex");

const b64 = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes));

const fromB64 = (text: string): Uint8Array =>
  new Uint8Array([...atob(text)].map((c) => c.charCodeAt(0)));

const fromB64url = (text: string): Uint8Array =>
  fromB64(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));

const b64url = (bytes: Uint8Array): string => {
  const raw = btoa(String.fromCharCode(...bytes));
  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

// the in-test encoder, shared with the decode suite's discipline
const enc = (value: unknown): Uint8Array => {
  const head = (major: number, length: number): number[] => {
    const m = major << 5;
    if (length < 24) return [m | length];
    if (length < 0x100) return [m | 24, length];
    if (length < 0x10000) return [m | 25, length >> 8, length & 0xff];
    throw new Error("vector too large");
  };
  if (typeof value === "number") {
    return new Uint8Array(value >= 0 ? head(0, value) : head(1, -value - 1));
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return new Uint8Array([...head(3, bytes.length), ...bytes]);
  }
  if (value instanceof Uint8Array) return new Uint8Array([...head(2, value.length), ...value]);
  if (Array.isArray(value)) return new Uint8Array([...head(4, value.length), ...value.flatMap((e) => [...enc(e)])]);
  if (value instanceof Map) {
    const parts = [...value.entries()].flatMap(([k, v]) => [...enc(k), ...enc(v)]);
    return new Uint8Array([...head(5, value.size), ...parts]);
  }
  throw new Error("cannot encode");
};

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

/** The DER form a real authenticator signs, from WebCrypto's raw r||s. */
const derFromRaw = (raw: Uint8Array): Uint8Array => {
  const integer = (bytes: Uint8Array): number[] => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
    let body = [...bytes.slice(start)];
    if ((body[0]! & 0x80) !== 0) body = [0, ...body];
    return [0x02, body.length, ...body];
  };
  const sequence = [...integer(raw.slice(0, 32)), ...integer(raw.slice(32, 64))];
  return new Uint8Array([0x30, sequence.length, ...sequence]);
};

/** One organization with an unused activation request for the crew actor. */
const ready = async (suffix: string): Promise<{ organizationId: string; secret: string }> => {
  const organizationId = `org-webauthn-${suffix}`;
  await call(org(organizationId), "POST", "/bootstrap", {
    ...organizationBootstrap(organizationId),
    principalLinks: [{ provider: "idp", subject: "lead", actorId: LEAD }], // CREW stays unlinked
  });
  const secret = `secret-${suffix}`;
  const secretHash = secretHashOf(secret);
  const minted = await call(org(organizationId), "POST", "/activation-request", {
    actorId: CREW,
    byActorId: LEAD,
    secretHash,
  });
  expect(minted.body.ok).toBe(true);
  return { organizationId, secret };
};

const realKey = async (): Promise<{ cose: Map<CborValue, CborValue>; pair: CryptoKeyPair }> => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const cose = new Map<CborValue, CborValue>([
    [1, 2], [3, -7], [-1, 1], [-2, raw.slice(1, 33)], [-3, raw.slice(33, 65)],
  ]);
  return { cose, pair };
};

/** Build a genuine registration ceremony for the given challenge. */
const ceremony = async (options: {
  readonly challenge: string;
  readonly origin?: string;
  readonly rpId?: string;
  readonly signed?: boolean;
}) => {
  const { cose, pair } = await realKey();
  const credentialId = new Uint8Array(32).fill(0xce);
  const clientData = new TextEncoder().encode(JSON.stringify({
    type: "webauthn.create",
    challenge: options.challenge,
    origin: options.origin ?? ORIGIN,
    crossOrigin: false,
  }));
  const authData = new Uint8Array([
    ...(await sha256(new TextEncoder().encode(options.rpId ?? RP_ID))),
    0x45, 0, 0, 0, 1,
    ...new Uint8Array(16),
    (credentialId.length >> 8) & 0xff, credentialId.length & 0xff, ...credentialId,
    ...enc(cose),
  ]);
  const attestationObject = options.signed === true
    ? await (async () => {
      const signature = derFromRaw(new Uint8Array((await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        pair.privateKey,
        new Uint8Array([...authData, ...(await sha256(clientData))]),
      )) as ArrayBuffer));
      return enc(new Map<CborValue, CborValue>([
        ["fmt", "packed"],
        ["attStmt", new Map<CborValue, CborValue>([["alg", -7], ["sig", signature]])],
        ["authData", authData],
      ]));
    })()
    : enc(new Map<CborValue, CborValue>([
      ["fmt", "none"],
      ["attStmt", new Map<CborValue, CborValue>()],
      ["authData", authData],
    ]));
  return { attestationObject: b64url(attestationObject), clientDataJSON: b64url(clientData), credentialId };
};

describe("registration through the claim", () => {
  it("mints single-use ceremony options and rotates them [W1]", async () => {
    const { organizationId, secret } = await ready("options");
    const first = await webauthnRegistrationOptions(directory(organizationId), { interfaceVersion: AUTHORITY_INTERFACE_VERSION, secret, rpId: RP_ID });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.user.id).toBe(CREW);
    expect(first.challenge.length).toBeGreaterThan(20);
    // browser-shaped: a JOSE name is not a PublicKeyCredentialParameters
    // entry, and the browser refuses one before the ceremony starts
    expect(first.pubKeyCredParams).toEqual([{ type: "public-key", alg: -7 }]);
    expect(first.rp.id).toBe(RP_ID);
    expect(first.authenticatorSelection).toEqual({
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "preferred",
    });

    const second = await webauthnRegistrationOptions(directory(organizationId), { interfaceVersion: AUTHORITY_INTERFACE_VERSION, secret, rpId: RP_ID });
    expect(second.ok && second.ok && second.challenge).not.toBe(first.challenge);
  });

  it("mints JSON registration options whose ids need no host conversion [W9]", async () => {
    const { organizationId, secret } = await ready("options-json");
    const options = await webauthnRegistrationOptionsJson(directory(organizationId), { interfaceVersion: AUTHORITY_INTERFACE_VERSION, secret, rpId: RP_ID });
    expect(options.ok).toBe(true);
    if (!options.ok) return;
    // the JSON serialization parseCreationOptionsFromJSON reads: both ids are
    // base64url, not the actor-id text the host wire states
    expect(new TextDecoder().decode(fromB64url(options.user.id))).toBe(CREW);
    expect(fromB64url(options.challenge).length).toBeGreaterThan(20);
    expect(options.user.name).toBe(CREW);
    expect(options.pubKeyCredParams).toEqual([{ type: "public-key", alg: -7 }]);
    expect(options.rp.id).toBe(RP_ID);
  });

  it("takes the plaintext secret and refuses its digest where the secret belongs", async () => {
    const organizationId = "org-webauthn-secret-shape";
    const secret = "secret-shape-plaintext";
    const secretHash = secretHashOf(secret);
    await call(org(organizationId), "POST", "/bootstrap", {
      ...organizationBootstrap(organizationId),
      principalLinks: [{ provider: "idp", subject: "lead", actorId: LEAD }],
    });
    const minted = await call(org(organizationId), "POST", "/activation-request", {
      actorId: CREW, byActorId: LEAD, secretHash,
    });
    expect(minted.body.ok).toBe(true);

    // the claim was minted with the digest; the options hashing the secret to
    // that same digest is the shared-rule witness
    const options = await webauthnRegistrationOptions(directory(organizationId), {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION, secret, rpId: RP_ID,
    });
    expect(options.ok).toBe(true);
    if (!options.ok) return;
    const submission = await ceremony({ challenge: options.challenge });
    const registered = await credentialFromRegistration(directory(organizationId), {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      secret, rpId: RP_ID, expectedOrigin: ORIGIN,
      credential: { response: { attestationObject: submission.attestationObject, clientDataJSON: submission.clientDataJSON } },
    });
    expect(registered.ok).toBe(true);

    // the digest is not the secret; a separate claim proves the refusal is
    // the hashing rule, not the consumed request
    const misuseOrg = "org-webauthn-secret-shape-misuse";
    await call(org(misuseOrg), "POST", "/bootstrap", {
      ...organizationBootstrap(misuseOrg),
      principalLinks: [{ provider: "idp", subject: "lead", actorId: LEAD }],
    });
    await call(org(misuseOrg), "POST", "/activation-request", {
      actorId: CREW, byActorId: LEAD, secretHash,
    });
    const digestAsSecret = await webauthnRegistrationOptions(directory(organizationId), {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION, secret: secretHash, rpId: RP_ID,
    });
    expect(digestAsSecret.ok).toBe(false);
    if (!digestAsSecret.ok) expect(digestAsSecret.failure.kind).toBe("unauthenticated");
  });

  it("refuses an activation secret present in two organizations", async () => {
    const secret = "secret-ambiguous";
    const secretHash = secretHashOf(secret);
    const ids = ["org-webauthn-ambiguous-a", "org-webauthn-ambiguous-b"];
    for (const organizationId of ids) {
      await call(org(organizationId), "POST", "/bootstrap", {
        ...organizationBootstrap(organizationId),
        principalLinks: [{ provider: "idp", subject: "lead", actorId: LEAD }],
      });
      const minted = await call(org(organizationId), "POST", "/activation-request", {
        actorId: CREW, byActorId: LEAD, secretHash,
      });
      expect(minted.body.ok).toBe(true);
    }
    const result = await webauthnRegistrationOptions(directory(...ids), {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION, secret, rpId: RP_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("unavailable");
  });

  it("refuses options for an unusable secret, uniformly", async () => {
    await ready("options-bad");
    const result = await webauthnRegistrationOptions(directory("org-webauthn-options-bad"), {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      secret: "never-minted",
      rpId: RP_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("unauthenticated");
  });

  it("enrolls through a genuine none-format ceremony and binds the link [W6]", async () => {
    const { organizationId, secret } = await ready("enroll");
    const options = await webauthnRegistrationOptions(directory(organizationId), { interfaceVersion: AUTHORITY_INTERFACE_VERSION, secret, rpId: RP_ID });
    expect(options.ok).toBe(true);
    if (!options.ok) return;
    const submission = await ceremony({ challenge: options.challenge });

    const registered = await credentialFromRegistration(directory(organizationId), {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      secret,
      rpId: RP_ID,
      expectedOrigin: ORIGIN,
      credential: {
        response: {
          attestationObject: submission.attestationObject,
          clientDataJSON: submission.clientDataJSON,
        },
      },
    });
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    expect(registered.actorId).toBe(CREW);

    const credential = await call<{ actorId: string; key: { alg: string } }>(
      org(organizationId), "GET",
      `/credential?credentialId=${encodeURIComponent(b64url(submission.credentialId))}`,
    );
    expect(credential.body.ok).toBe(true);
    expect(credential.body.value?.actorId).toBe(CREW);
    expect(credential.body.value?.key.alg).toBe("ES256");

    const links = await call<{ readonly links: readonly { provider: string; actorId: string }[] }>(
      org(organizationId), "GET", "/principal-links",
    );
    const webauthnLink = links.body.value?.links.find((l) => l.provider === "webauthn");
    expect(webauthnLink?.actorId).toBe(CREW);
  });

  it("verifies a packed self-attestation ceremony too", async () => {
    const { organizationId, secret } = await ready("packed");
    const options = await webauthnRegistrationOptions(directory(organizationId), { interfaceVersion: AUTHORITY_INTERFACE_VERSION, secret, rpId: RP_ID });
    if (!options.ok) throw new Error("options failed");
    const submission = await ceremony({ challenge: options.challenge, signed: true });
    const registered = await credentialFromRegistration(directory(organizationId), {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      secret, rpId: RP_ID, expectedOrigin: ORIGIN,
      credential: { response: { attestationObject: submission.attestationObject, clientDataJSON: submission.clientDataJSON } },
    });
    expect(registered.ok).toBe(true);
  });

  it("refuses a wrong origin, a wrong challenge, and the wrong RP id [W2] [W4]", async () => {
    const cases = [
      { label: "origin", origin: "https://evil.example" },
      { label: "rp", rpId: "other.test" },
    ] as const;
    for (const item of cases) {
      const { organizationId, secret } = await ready(`bad-${item.label}`);
      const options = await webauthnRegistrationOptions(directory(organizationId), { interfaceVersion: AUTHORITY_INTERFACE_VERSION, secret, rpId: RP_ID });
      if (!options.ok) throw new Error("options failed");
      const submission = item.label === "rp"
        ? await ceremony({ challenge: options.challenge, rpId: item.rpId })
        : await ceremony({ challenge: options.challenge, origin: item.origin });
      const result = await credentialFromRegistration(directory(organizationId), {
        interfaceVersion: AUTHORITY_INTERFACE_VERSION,
        secret, rpId: RP_ID, expectedOrigin: ORIGIN,
        credential: { response: { attestationObject: submission.attestationObject, clientDataJSON: submission.clientDataJSON } },
      });
      expect(result.ok, item.label).toBe(false);
    }
    // wrong challenge: stale options from a rotation
    const { organizationId, secret } = await ready("bad-challenge");
    const stale = await webauthnRegistrationOptions(directory(organizationId), { interfaceVersion: AUTHORITY_INTERFACE_VERSION, secret, rpId: RP_ID });
    if (!stale.ok) throw new Error("options failed");
    await webauthnRegistrationOptions(directory(organizationId), { interfaceVersion: AUTHORITY_INTERFACE_VERSION, secret, rpId: RP_ID }); // rotates
    const submission = await ceremony({ challenge: stale.challenge });
    const result = await credentialFromRegistration(directory(organizationId), {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      secret, rpId: RP_ID, expectedOrigin: ORIGIN,
      credential: { response: { attestationObject: submission.attestationObject, clientDataJSON: submission.clientDataJSON } },
    });
    expect(result.ok).toBe(false);
  });

  it("consumes the claim: a second registration on the same secret is refused [W3]", async () => {
    const { organizationId, secret } = await ready("consume");
    const options = await webauthnRegistrationOptions(directory(organizationId), { interfaceVersion: AUTHORITY_INTERFACE_VERSION, secret, rpId: RP_ID });
    if (!options.ok) throw new Error("options failed");
    const submission = await ceremony({ challenge: options.challenge });
    const first = await credentialFromRegistration(directory(organizationId), {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      secret, rpId: RP_ID, expectedOrigin: ORIGIN,
      credential: { response: { attestationObject: submission.attestationObject, clientDataJSON: submission.clientDataJSON } },
    });
    expect(first.ok).toBe(true);

    const again = await webauthnRegistrationOptions(directory(organizationId), { interfaceVersion: AUTHORITY_INTERFACE_VERSION, secret, rpId: RP_ID });
    expect(again.ok).toBe(false);
  });

  it("holds the strict guard: an actor linked after minting enrolls nothing [W6]", async () => {
    const organizationId = "org-webauthn-guard";
    await call(org(organizationId), "POST", "/bootstrap", {
      ...organizationBootstrap(organizationId),
      principalLinks: [{ provider: "idp", subject: "lead", actorId: LEAD }],
    });
    const secret = "secret-guard";
    const secretHash = secretHashOf(secret);
    // minted while CREW was unlinked; the operator then links CREW by the
    // operator route — the window the accept-side guard must still close
    await call(org(organizationId), "POST", "/activation-request", {
      actorId: CREW, byActorId: LEAD, secretHash,
    });
    const linked = await call(org(organizationId), "POST", "/principal-link", {
      provider: "idp", subject: "crew-late", actorId: CREW,
    });
    expect(linked.body.ok).toBe(true);
    const options = await webauthnRegistrationOptions(directory(organizationId), { interfaceVersion: AUTHORITY_INTERFACE_VERSION, secret, rpId: RP_ID });
    expect(options.ok).toBe(true);
    if (!options.ok) return;
    const submission = await ceremony({ challenge: options.challenge });
    const result = await credentialFromRegistration(directory(organizationId), {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      secret, rpId: RP_ID, expectedOrigin: ORIGIN,
      credential: { response: { attestationObject: submission.attestationObject, clientDataJSON: submission.clientDataJSON } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("unauthenticated");
    // and nothing was stored
    const credential = await call(org(organizationId), "GET",
      `/credential?credentialId=${encodeURIComponent(b64url(submission.credentialId))}`);
    expect(credential.body.ok).toBe(false);
  });
});
