// Assertion login (docs/cloudflare.md § Local credentials (passkeys)): the host mints a
// single-use ceremony challenge bound to its origin and relying-party id,
// the browser signs it with the stored passkey, and the runtime verifies the
// assertion, enforces the sign-counter rule, and issues through the same
// session path a federated login reaches. Refusals are uniform.
//
// Enrollment is exercised end to end against the conformance world: an
// operator unlink (the documented identity reset), a claim-minted
// registration, then an assertion that produces a verifiable envelope.

import { env } from "cloudflare:test";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AUTHORITY_INTERFACE_VERSION, isFailed } from "org-hats/authority";
import { verify } from "org-hats/access";
import { CONFORMANCE_PRINCIPALS } from "org-hats/conformance";
import { createCloudflareConformanceWorld } from "../src/conformance";
import { signerFor, verificationKeys } from "../src/runtime";
import { call, organizationBootstrap } from "./helpers";
import type { Env } from "../src/env";
import {
  credentialFromAssertion,
  credentialFromRegistration,
  webauthnAssertionOptions,
  webauthnRegistrationOptions,
} from "../src/webauthn";

const LEAD = "actor-lead";
const CREW = "actor-crew";
const ORIGIN = "https://app.example.test";
const RP_ID = "example.test";
const OPERATION = "op-9f2e6ad4";
const DANA_ORG = "org-4c1f9a2e";
const DANA = CONFORMANCE_PRINCIPALS.dana.actorId;

const org = (id: string) => env.ORGANIZATION.get(env.ORGANIZATION.idFromName(id));
const testEnv = env as unknown as Env;

const secretHashOf = (secret: string): string =>
  createHash("sha256").update(secret, "utf8").digest("hex");

const b64url = (bytes: Uint8Array): string => {
  const raw = btoa(String.fromCharCode(...bytes));
  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const b64urlOfText = (text: string): string => b64url(new TextEncoder().encode(text));

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

const enc = (value: unknown): Uint8Array => {
  const head = (major: number, length: number): number[] => {
    const m = major << 5;
    if (length < 24) return [m | length];
    if (length < 0x100) return [m | 24, length];
    throw new Error("vector too large");
  };
  if (typeof value === "number") return new Uint8Array(value >= 0 ? head(0, value) : head(1, -value - 1));
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

interface Passkey {
  readonly credentialId: Uint8Array;
  readonly pair: CryptoKeyPair;
  readonly cose: Map<unknown, unknown>;
}

const passkey = async (seed: number): Promise<Passkey> => {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const credentialId = new Uint8Array(32).fill(seed);
  const cose = new Map<unknown, unknown>([
    [1, 2], [3, -7], [-1, 1], [-2, raw.slice(1, 33)], [-3, raw.slice(33, 65)],
  ]);
  return { credentialId, pair, cose };
};

/** Build a genuine registration ceremony for the given options. */
const registration = async (
  options: { readonly challenge: string; readonly rpId?: string; readonly origin?: string },
  key: Passkey,
  signCount = 0,
): Promise<{ attestationObject: string; clientDataJSON: string }> => {
  const clientData = new TextEncoder().encode(JSON.stringify({
    type: "webauthn.create",
    challenge: options.challenge,
    origin: options.origin ?? ORIGIN,
    crossOrigin: false,
  }));
  const authData = new Uint8Array([
    ...(await sha256(new TextEncoder().encode(options.rpId ?? RP_ID))),
    0x45, 0, 0, 0, signCount,
    ...new Uint8Array(16),
    (key.credentialId.length >> 8) & 0xff, key.credentialId.length & 0xff, ...key.credentialId,
    ...enc(key.cose),
  ]);
  const attestationObject = enc(new Map<unknown, unknown>([
    ["fmt", "none"],
    ["attStmt", new Map<unknown, unknown>()],
    ["authData", authData],
  ]));
  return { attestationObject: b64url(attestationObject), clientDataJSON: b64url(clientData) };
};

/** A signed assertion; every field the browser sends that the runtime reads. */
const assertion = async (
  options: {
    readonly challenge: string;
    readonly origin?: string;
    readonly rpId?: string;
    readonly signCount?: number;
    readonly key: Passkey;
    readonly tamper?: boolean;
  },
): Promise<{ authenticatorData: string; clientDataJSON: string; signature: string }> => {
  const clientData = new TextEncoder().encode(JSON.stringify({
    type: "webauthn.get",
    challenge: options.challenge,
    origin: options.origin ?? ORIGIN,
    crossOrigin: false,
  }));
  const authData = new Uint8Array([
    ...(await sha256(new TextEncoder().encode(options.rpId ?? RP_ID))),
    0x01, 0, 0, 0, options.signCount ?? 0,
  ]);
  const signed = new Uint8Array([...authData, ...(await sha256(clientData))]);
  const raw = new Uint8Array((await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    options.key.pair.privateKey,
    signed,
  )) as ArrayBuffer);
  const signature = derFromRaw(raw);
  if (options.tamper === true) signature[signature.length - 1] = (signature[signature.length - 1]! ^ 0xff);
  return {
    authenticatorData: b64url(authData),
    clientDataJSON: b64url(clientData),
    signature: b64url(signature),
  };
};

/** A fresh organization with an unlinked crew actor and a live claim. */
const claimOrg = async (suffix: string): Promise<{ organizationId: string; secret: string }> => {
  const organizationId = `org-assert-${suffix}`;
  await call(org(organizationId), "POST", "/bootstrap", {
    ...organizationBootstrap(organizationId),
    principalLinks: [{ provider: "idp", subject: "lead", actorId: LEAD }],
  });
  const secret = `secret-${suffix}`;
  const secretHash = secretHashOf(secret);
  const minted = await call(org(organizationId), "POST", "/activation-request", {
    actorId: CREW, byActorId: LEAD, secretHash,
  });
  expect(minted.body.ok).toBe(true);
  return { organizationId, secret };
};

/** Enroll `key` for `actorId` through the claim, returning the stored key. */
const enrolled = async (
  input: { readonly organizationId: string; readonly secret: string },
  key: Passkey,
  signCount = 0,
): Promise<void> => {
  const options = await webauthnRegistrationOptions(testEnv, {
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    organizationId: input.organizationId,
    secret: input.secret,
    rpId: RP_ID,
  });
  if (!options.ok) throw new Error(`registration options failed: ${options.failure.kind}`);
  const ceremony = await registration(options, key, signCount);
  const registered = await credentialFromRegistration(testEnv, {
    interfaceVersion: AUTHORITY_INTERFACE_VERSION,
    organizationId: input.organizationId,
    secret: input.secret,
    rpId: RP_ID,
    expectedOrigin: ORIGIN,
    credential: { response: ceremony },
  });
  if (!registered.ok) throw new Error(`registration failed: ${registered.failure.kind}`);
};

/** The runtime's evidence directory must name the organization, as a
 * deployment does; without it issuance cannot resolve the principal link. */
const directoryFor = (organizationId: string): Env =>
  ({ ...env, AUTHORITY_ORGANIZATION_IDS: organizationId }) as Env;

const assertLogin = async (input: {
  readonly organizationId: string;
  readonly operationId?: string;
  readonly credentialId: string;
  readonly response: { authenticatorData: string; clientDataJSON: string; signature: string };
}) => credentialFromAssertion(directoryFor(input.organizationId), {
  interfaceVersion: AUTHORITY_INTERFACE_VERSION,
  organizationId: input.organizationId,
  operationId: input.operationId ?? "op-not-used-on-refusal",
  credentialId: input.credentialId,
  response: input.response,
});

describe("assertion login", () => {
  it("mints a challenge bound to the origin and RP id, and rotates it", async () => {
    const { organizationId } = await claimOrg("options");
    const first = await webauthnAssertionOptions(testEnv, {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      organizationId,
      rpId: RP_ID,
      expectedOrigin: ORIGIN,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.rpId).toBe(RP_ID);
    expect(first.challenge.length).toBeGreaterThan(20);

    const second = await webauthnAssertionOptions(testEnv, {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      organizationId,
      rpId: RP_ID,
      expectedOrigin: ORIGIN,
    });
    expect(second.ok && second.ok && second.challenge).not.toBe(first.challenge);
  });

  it("enrolls through the claim, then asserts and issues a verified envelope", async () => {
    await createCloudflareConformanceWorld(env);
    const directory = directoryFor(DANA_ORG);
    const signer = await signerFor(env);
    const keys = await verificationKeys(env, signer);
    const danaOrg = env.ORGANIZATION.get(env.ORGANIZATION.idFromName(DANA_ORG));

    // the recovery order: unlink (identity reset), then re-mint, then accept
    const unlinked = await call(danaOrg, "POST", "/unlink-principal", {
      actorId: DANA, byActorId: DANA, idempotencyKey: "assert-unlink-dana",
    });
    expect(unlinked.body.ok).toBe(true);
    const secret = "assert-dana-passkey";
    const secretHash = secretHashOf(secret);
    const minted = await call(danaOrg, "POST", "/activation-request", {
      actorId: DANA, byActorId: DANA, secretHash,
    });
    expect(minted.body.ok).toBe(true);

    const key = await passkey(0xab);
    await enrolled({ organizationId: DANA_ORG, secret }, key);

    const options = await webauthnAssertionOptions(directory, {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      organizationId: DANA_ORG,
      rpId: RP_ID,
      expectedOrigin: ORIGIN,
    });
    expect(options.ok).toBe(true);
    if (!options.ok) return;
    const signed = await assertion({ challenge: options.challenge, key, signCount: 1 });
    const issued = await credentialFromAssertion(directory, {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION,
      organizationId: DANA_ORG,
      operationId: OPERATION,
      credentialId: b64url(key.credentialId),
      response: signed,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const verified = await verify(issued.envelope as never, keys, {
      now: Math.floor(Date.now() / 1000),
      expectedOperationId: OPERATION,
    });
    if (isFailed(verified)) throw new Error(`envelope did not verify: ${verified.failure.kind}`);
    expect(verified.claims.actor.actorId).toBe(DANA);
    expect(verified.claims.amr).toEqual(["webauthn"]);
    expect(verified.claims.auth_time).toBeGreaterThan(0);
  }, 60_000);

  it("refuses a replayed challenge", async () => {
    const { organizationId, secret } = await claimOrg("replay");
    const key = await passkey(0x01);
    await enrolled({ organizationId, secret }, key);
    const options = await webauthnAssertionOptions(testEnv, {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION, organizationId, rpId: RP_ID, expectedOrigin: ORIGIN,
    });
    if (!options.ok) throw new Error("options failed");
    const signed = await assertion({ challenge: options.challenge, key, signCount: 1 });
    const first = await assertLogin({
      organizationId, credentialId: b64url(key.credentialId), response: signed,
    });
    // the first assertion reaches issuance and fails there only because this
    // organization has no such operation (`unavailable`); the challenge is
    // consumed regardless
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.failure.kind, JSON.stringify(first.failure)).toBe("unavailable");
    const second = await assertLogin({
      organizationId, credentialId: b64url(key.credentialId), response: signed,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.failure.kind).toBe("unauthenticated");
  });

  it("refuses a wrong origin, a wrong RP id, and a tampered signature", async () => {
    const { organizationId, secret } = await claimOrg("wrong");
    const key = await passkey(0x02);
    await enrolled({ organizationId, secret }, key);

    const mint = async () => {
      const options = await webauthnAssertionOptions(testEnv, {
        interfaceVersion: AUTHORITY_INTERFACE_VERSION, organizationId, rpId: RP_ID, expectedOrigin: ORIGIN,
      });
      if (!options.ok) throw new Error("options failed");
      return options.challenge;
    };

    const wrongOrigin = await assertion({ challenge: await mint(), key, origin: "https://evil.example" });
    const originResult = await assertLogin({
      organizationId, credentialId: b64url(key.credentialId), response: wrongOrigin,
    });
    expect(originResult.ok).toBe(false);
    if (!originResult.ok) expect(originResult.failure.kind).toBe("unauthenticated");

    const wrongRp = await assertion({ challenge: await mint(), key, rpId: "other.test" });
    const rpResult = await assertLogin({
      organizationId, credentialId: b64url(key.credentialId), response: wrongRp,
    });
    expect(rpResult.ok).toBe(false);
    if (!rpResult.ok) expect(rpResult.failure.kind).toBe("unauthenticated");

    const tampered = await assertion({ challenge: await mint(), key, tamper: true });
    const tamperedResult = await assertLogin({
      organizationId, credentialId: b64url(key.credentialId), response: tampered,
    });
    expect(tamperedResult.ok).toBe(false);
    if (!tamperedResult.ok) expect(tamperedResult.failure.kind).toBe("unauthenticated");

    const unknown = await assertion({ challenge: await mint(), key: await passkey(0x03) });
    const unknownResult = await assertLogin({
      organizationId, credentialId: b64url((await passkey(0x04)).credentialId), response: unknown,
    });
    expect(unknownResult.ok).toBe(false);
    if (!unknownResult.ok) expect(unknownResult.failure.kind).toBe("unauthenticated");
  });

  it("refuses a counter that does not advance, and accepts zero counters", async () => {
    const { organizationId, secret } = await claimOrg("counter");
    const key = await passkey(0x05);
    await enrolled({ organizationId, secret }, key);

    const attempt = async (signCount: number) => {
      const options = await webauthnAssertionOptions(testEnv, {
        interfaceVersion: AUTHORITY_INTERFACE_VERSION, organizationId, rpId: RP_ID, expectedOrigin: ORIGIN,
      });
      if (!options.ok) throw new Error("options failed");
      const signed = await assertion({ challenge: options.challenge, key, signCount });
      return assertLogin({ organizationId, credentialId: b64url(key.credentialId), response: signed });
    };

    // zero counters are the synced-passkey signal: no regression is claimed
    const zero = await attempt(0);
    expect(zero.ok).toBe(false); // fails at issuance, not verification
    if (!zero.ok) expect(zero.failure.kind).toBe("unavailable");
    const zeroAgain = await attempt(0);
    expect(zeroAgain.ok).toBe(false);
    if (!zeroAgain.ok) expect(zeroAgain.failure.kind).toBe("unavailable");

    // a stored nonzero counter must advance
    await call(org(organizationId), "POST", "/credential-counter", {
      credentialId: b64url(key.credentialId), signCount: 7,
    });
    const regressed = await attempt(7);
    expect(regressed.ok).toBe(false);
    if (!regressed.ok) expect(regressed.failure.kind).toBe("unauthenticated");
    const advanced = await attempt(8);
    expect(advanced.ok).toBe(false); // issuance, not verification
    if (!advanced.ok) expect(advanced.failure.kind, JSON.stringify(advanced.failure)).toBe("unavailable");
  });

  it("refuses a credential with no principal link", async () => {
    const { organizationId } = await claimOrg("unlinked");
    const key = await passkey(0x06);
    const raw = new Uint8Array((await crypto.subtle.exportKey("raw", key.pair.publicKey)) as ArrayBuffer);
    await call(org(organizationId), "POST", "/credential", {
      credentialId: b64url(key.credentialId),
      actorId: CREW,
      key: { alg: "ES256", x: b64url(raw.slice(1, 33)), y: b64url(raw.slice(33, 65)) },
      signCount: 0,
      backupEligible: false,
      backedUp: false,
    });

    const options = await webauthnAssertionOptions(testEnv, {
      interfaceVersion: AUTHORITY_INTERFACE_VERSION, organizationId, rpId: RP_ID, expectedOrigin: ORIGIN,
    });
    if (!options.ok) throw new Error("options failed");
    const signed = await assertion({ challenge: options.challenge, key, signCount: 1 });
    const result = await assertLogin({
      organizationId, credentialId: b64url(key.credentialId), response: signed,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("unauthenticated");
  });
});
