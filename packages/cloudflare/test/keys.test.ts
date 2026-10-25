import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { base64Decode, base64UrlDecode, base64Encode, parseVerifyKeySet, serializeVerifyKeySet } from "org-hats/access";
import type { Env } from "../src/env";
import { serializedVerificationKeys, signerFor, signerFromEnv, verificationKeys } from "../src/runtime";

const pair = async () => {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
  return {
    privateKey: base64Encode(new Uint8Array((await crypto.subtle.exportKey("pkcs8", keys.privateKey)) as ArrayBuffer)),
    publicKey: base64Encode(new Uint8Array((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer)),
  };
};

describe("configured signing keys", () => {
  it("imports the signing key and exposes both rotation keys", async () => {
    const a = await pair();
    const b = await pair();
    const configured = {
      ...env,
      AUTHORITY_SIGNING_KEY: a.privateKey,
      AUTHORITY_SIGNING_PUBLIC_KEY: a.publicKey,
      AUTHORITY_SIGNING_KEY_ID: "key-a",
      AUTHORITY_VERIFICATION_KEYS: serializeVerifyKeySet([
        { keyId: "key-a", algorithm: "Ed25519", publicKey: a.publicKey },
        { keyId: "key-b", algorithm: "Ed25519", publicKey: b.publicKey },
      ]),
    } as Env;

    const signer = await signerFromEnv(configured);
    expect(signer.keyId).toBe("key-a");
    const keys = await verificationKeys(configured, signer);
    expect([...keys.keys()].sort()).toEqual(["key-a", "key-b"]);

    const payload = "configured-signer";
    const signature = await signer.sign(payload);
    expect(await keys.get("key-a")?.verify(payload, signature)).toBe(true);

    const next = await signerFromEnv({
      ...configured,
      AUTHORITY_SIGNING_KEY: b.privateKey,
      AUTHORITY_SIGNING_PUBLIC_KEY: b.publicKey,
      AUTHORITY_SIGNING_KEY_ID: "key-b",
    } as Env);
    const nextSignature = await next.sign(payload);
    expect(await keys.get("key-b")?.verify(payload, nextSignature)).toBe(true);
  });

  it("the serialized set carries the configured keys and the signer, exactly", async () => {
    const a = await pair();
    const b = await pair();
    const materials = [
      { keyId: "key-a", algorithm: "Ed25519", publicKey: a.publicKey },
      { keyId: "key-b", algorithm: "Ed25519", publicKey: b.publicKey },
    ];
    const configured = {
      ...env,
      AUTHORITY_SIGNING_KEY: b.privateKey,
      AUTHORITY_SIGNING_PUBLIC_KEY: b.publicKey,
      AUTHORITY_SIGNING_KEY_ID: "key-b",
      AUTHORITY_VERIFICATION_KEYS: serializeVerifyKeySet(materials),
    } as Env;
    const signer = await signerFromEnv(configured);
    const parsed = parseVerifyKeySet(await serializedVerificationKeys(configured, signer));
    expect(parsed.keys).toEqual(materials);
  });

  it("rejects a partial signing configuration instead of falling back", async () => {
    const a = await pair();
    for (const partial of [
      { AUTHORITY_SIGNING_KEY: a.privateKey },
      { AUTHORITY_SIGNING_PUBLIC_KEY: a.publicKey },
      { AUTHORITY_SIGNING_KEY_ID: "key-a" },
      { AUTHORITY_SIGNING_KEY: a.privateKey, AUTHORITY_SIGNING_KEY_ID: "key-a" },
    ]) {
      await expect(signerFromEnv({ ...env, ...partial } as Env)).rejects.toThrow(/partial signing-key configuration/);
      await expect(signerFor({ ...env, ...partial } as Env)).rejects.toThrow(/partial signing-key configuration/);
    }
  });

  it("rejects a configured key pair that is not a pair", async () => {
    const a = await pair();
    const b = await pair();
    await expect(signerFromEnv({
      ...env,
      AUTHORITY_SIGNING_KEY: a.privateKey,
      AUTHORITY_SIGNING_PUBLIC_KEY: b.publicKey,
      AUTHORITY_SIGNING_KEY_ID: "key-a",
    } as Env)).rejects.toThrow(/are not a key pair/);
  });

  it("falls back to the dev signer only when nothing is configured", async () => {
    const signer = await signerFor({ ...env } as Env);
    const payload = "dev-fallback";
    const signature = await signer.sign(payload);
    const publicKey = await crypto.subtle.importKey(
      "raw",
      base64Decode(await signer.publicKey()),
      { name: "Ed25519" },
      false,
      ["verify"],
    ) as CryptoKey;
    expect(await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      base64UrlDecode(signature),
      new TextEncoder().encode(payload),
    )).toBe(true);
  });
});
