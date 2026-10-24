import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { base64Encode, serializeVerifyKeySet } from "org-hats/access";
import type { Env } from "../src/env";
import { signerFromEnv, verificationKeys } from "../src/runtime";

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
});
