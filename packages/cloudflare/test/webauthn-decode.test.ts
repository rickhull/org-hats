// The WebAuthn decoding layer: a minimal CBOR decoder, authenticator-data
// and attestation parsing, and COSE-key mapping, built as an untrusted-
// input boundary with the envelope gate's discipline — size- and
// depth-bounded, unknown constructs refused rather than skipped, every
// refusal a value (docs/authority_redesign.md § Local credentials).
//
// Nothing here is crypto: signature verification stays in crypto.subtle,
// fed by the key material this layer extracts.

import { describe, expect, it } from "vitest";
import {
  decodeCbor,
  type CborValue,
} from "../src/webauthn/cbor";
import {
  parseAttestationObject,
  parseAuthenticatorData,
  type CoseKey,
} from "../src/webauthn/authenticator";

// --- an independent encoder, so vectors are not self-fulfilling ----------
//
// Written from RFC 8949 rather than as the inverse of the decoder, and
// deliberately narrower: exactly the constructs WebAuthn emits.

const enc = (value: unknown): Uint8Array => {
  const head = (major: number, length: number): number[] => {
    const m = major << 5;
    if (length < 24) return [m | length];
    if (length < 0x100) return [m | 24, length];
    if (length < 0x10000) return [m | 25, length >> 8, length & 0xff];
    if (length < 0x1_0000_0000) {
      return [m | 26, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff];
    }
    throw new Error("vector too large");
  };
  if (typeof value === "number") {
    if (value >= 0) return new Uint8Array(head(0, value));
    return new Uint8Array(head(1, -value - 1));
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return new Uint8Array([...head(3, bytes.length), ...bytes]);
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array([...head(2, value.length), ...value]);
  }
  if (Array.isArray(value)) {
    const parts = value.flatMap((entry) => [...enc(entry)]);
    return new Uint8Array([...head(4, value.length), ...parts]);
  }
  if (value instanceof Map) {
    const parts = [...value.entries()].flatMap(([k, v]) => [...enc(k), ...enc(v)]);
    return new Uint8Array([...head(5, value.size), ...parts]);
  }
  throw new Error(`vector encoder cannot encode ${String(typeof value)}`);
};

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (text: string): Uint8Array =>
  new Uint8Array((text.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16)));

describe("the CBOR decoder", () => {
  it("decodes the RFC 8949 literals", () => {
    expect(hex(enc(0))).toBe("00");
    expect(decodeCbor(enc(0))).toMatchObject({ ok: true, item: { value: 0 } });
    expect(decodeCbor(enc(0)).ok && decodeCbor(enc(0)).ok).toBe(true);
    expect(decodeCbor(enc(23))).toMatchObject({ ok: true, item: { value: 23 } });
    expect(decodeCbor(enc(24))).toMatchObject({ ok: true, item: { value: 24 } });
    expect(decodeCbor(enc(500))).toMatchObject({ ok: true, item: { value: 500 } });
    expect(decodeCbor(enc(-1_000))).toMatchObject({ ok: true, item: { value: -1_000 } });
    expect(decodeCbor(enc(-1_000_000))).toMatchObject({ ok: true, item: { value: -1_000_000 } });
  });

  it("decodes strings, bytes, arrays, and maps, and reports the rest", () => {
    const bytes = enc(new Uint8Array([1, 2, 3]));
    expect(decodeCbor(bytes)).toMatchObject({ ok: true, item: { value: new Uint8Array([1, 2, 3]) } });
    const text = decodeCbor(enc("packed"));
    expect(text.ok && text.item.value).toBe("packed");
    const array = decodeCbor(enc([1, [2, 3], "four"]));
    expect(array.ok && JSON.stringify(array.item.value)).toBe('[1,[2,3],"four"]');
    const map = new Map<CborValue, CborValue>([["fmt", "none"], ["n", 1]]);
    const decoded = decodeCbor(enc(map));
    expect(decoded.ok && decoded.item.value).toEqual(map);
    const trailing = decodeCbor(new Uint8Array([...enc(7), ...enc(8)]));
    expect(trailing.ok && hex(trailing.item.rest)).toBe(hex(enc(8)));
  });

  it("refuses truncated input as a value", () => {
    const whole = enc([1, 2, 3]);
    for (let cut = 0; cut < whole.length; cut += 1) {
      const result = decodeCbor(whole.slice(0, cut));
      expect(result.ok, `cut at ${cut}`).toBe(false);
    }
  });

  it("refuses the constructs it does not implement, never skips them [W7]", () => {
    // major 6: tag
    expect(decodeCbor(new Uint8Array([0xc0, 0x01])).ok).toBe(false);
    // major 7: simple/float — starting with false (0xf4)
    expect(decodeCbor(new Uint8Array([0xf4])).ok).toBe(false);
    // indefinite length (additional info 31)
    expect(decodeCbor(new Uint8Array([0x9f, 0x01, 0xff])).ok).toBe(false);
    // reserved additional info 28–30
    expect(decodeCbor(new Uint8Array([0x1c])).ok).toBe(false);
    expect(decodeCbor(new Uint8Array([0x1d])).ok).toBe(false);
    expect(decodeCbor(new Uint8Array([0x1e])).ok).toBe(false);
  });

  it("refuses nesting beyond the bound [W7]", () => {
    let deep: CborValue = 1;
    for (let i = 0; i < 12; i += 1) deep = [deep];
    expect(decodeCbor(enc(deep)).ok).toBe(false);
  });
});

// --- authenticator data and attestation objects ------------------------------

const RPID_HASH = new Uint8Array(32).fill(0xab); // sha256("example.test") stand-in
const aaguid = new Uint8Array(16);
const credentialId = new Uint8Array(32).fill(0xcd);

const coseKeyMap = new Map<CborValue, CborValue>([
  [1, 2],
  [3, -7],
  [-1, 1],
  [-2, new Uint8Array(32).fill(0x11)],
  [-3, new Uint8Array(32).fill(0x22)],
]);

const authenticatorData = (flags: number, signCount: number, withCredential: boolean): Uint8Array => {
  const head = [
    ...RPID_HASH,
    flags,
    (signCount >>> 24) & 0xff, (signCount >>> 16) & 0xff, (signCount >>> 8) & 0xff, signCount & 0xff,
  ];
  if (!withCredential) return new Uint8Array(head);
  return new Uint8Array([
    ...head,
    ...aaguid,
    (credentialId.length >> 8) & 0xff, credentialId.length & 0xff,
    ...credentialId,
    ...enc(coseKeyMap),
  ]);
};

describe("authenticator data", () => {
  it("parses flags, sign count, and the attested credential", () => {
    const parsed = parseAuthenticatorData(authenticatorData(0x45, 7, true));
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        credentialId,
      },
    });
    if (parsed.ok) {
      expect(parsed.value.userPresent).toBe(true);
      expect(parsed.value.userVerified).toBe(true);
      expect(parsed.value.signCount).toBe(7);
      expect(parsed.value.rpIdHash).toEqual(RPID_HASH);
      const key = parsed.value.credentialKey;
      expect(key?.alg).toBe("ES256");
      expect(key && "x" in key ? hex(key.x) : "").toBe("11".repeat(32));
    }
  });

  it("parses a bare assertion authenticator data block", () => {
    const parsed = parseAuthenticatorData(authenticatorData(0x01, 42, false));
    expect(parsed.ok && parsed.value.signCount).toBe(42);
    expect(parsed.ok && parsed.value.userPresent).toBe(true);
    expect(parsed.ok && parsed.value.credentialId).toBeUndefined();
  });

  it("refuses trailing bytes, extension blocks, and truncation [W7]", () => {
    const withCredential = authenticatorData(0x45, 1, true);
    expect(parseAuthenticatorData(new Uint8Array([...withCredential, 0x00])).ok).toBe(false);
    // extensions flag set (0x80): refused, not skipped
    expect(parseAuthenticatorData(authenticatorData(0x81, 1, false)).ok).toBe(false);
    expect(parseAuthenticatorData(withCredential.slice(0, -3)).ok).toBe(false);
  });

  it("refuses a credential block that is not a COSE EC2 ES256 key [W7]", () => {
    const rsaOnly = new Map<CborValue, CborValue>([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(31)]]);
    const head = [...RPID_HASH, 0x45, 0, 0, 0, 1, ...aaguid, 0, 4, 1, 2, 3, 4];
    const bad = new Uint8Array([...head, ...enc(rsaOnly)]);
    expect(parseAuthenticatorData(bad).ok).toBe(false);
  });
});

describe("attestation objects", () => {
  const noneAttestation = () => {
    const authData = authenticatorData(0x45, 1, true);
    const map = new Map<CborValue, CborValue>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]);
    return enc(map);
  };

  it("decodes a none-format registration", () => {
    const parsed = parseAttestationObject(noneAttestation());
    expect(parsed.ok && parsed.value.format).toBe("none");
    expect(parsed.ok && parsed.value.authenticator.signCount).toBe(1);
    expect(parsed.ok && hex(parsed.value.credentialId)).toBe(hex(credentialId));
  });

  it("refuses an unknown format, a missing member, and trailing bytes", () => {
    const unknown = new Map<CborValue, CborValue>([
      ["fmt", "fido-u2f"], ["attStmt", new Map()], ["authData", authenticatorData(0x45, 1, true)],
    ]);
    expect(parseAttestationObject(enc(unknown)).ok).toBe(false);
    const missing = new Map<CborValue, CborValue>([["fmt", "none"], ["authData", authenticatorData(0x45, 1, true)]]);
    expect(parseAttestationObject(enc(missing)).ok).toBe(false);
    expect(parseAttestationObject(new Uint8Array([...noneAttestation(), 0x00])).ok).toBe(false);
  });

  it("decodes packed self-attestation and refuses a trust path", () => {
    const authData = authenticatorData(0x45, 1, true);
    const attStmt = new Map<CborValue, CborValue>([["alg", -7], ["sig", new Uint8Array([9, 9])]]);
    const selfAttested = enc(new Map<CborValue, CborValue>([
      ["fmt", "packed"], ["attStmt", attStmt], ["authData", authData],
    ]));
    const parsed = parseAttestationObject(selfAttested);
    expect(parsed.ok && parsed.value.format).toBe("packed");
    if (parsed.ok) {
      expect(hex(parsed.value.attestation?.signature ?? new Uint8Array())).toBe("0909");
    }
    const withChain = new Map<CborValue, CborValue>([
      ["alg", -7], ["sig", new Uint8Array([9])], ["x5c", [new Uint8Array([0x30])]],
    ]);
    const trusted = enc(new Map<CborValue, CborValue>([
      ["fmt", "packed"], ["attStmt", withChain], ["authData", authData],
    ]));
    expect(parseAttestationObject(trusted).ok).toBe(false);
  });
});

// --- the cryptographic round-trip ------------------------------------------
//
// The decoder's output must feed crypto.subtle without adaptation: a real
// ES256 keypair, a packed self-attestation signed with the credential key
// over authData || clientDataHash, and verification through the COSE key
// the parser extracted from the attestation object. This is the narrowest
// proof that "everything cryptographic stays in WebCrypto" holds.

describe("the WebCrypto round-trip", () => {
  it("verifies a packed self-attestation through the parsed COSE key", async () => {
    const generated = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pair = generated as CryptoKeyPair;
    const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
    // uncompressed point: 0x04 || x || y
    const x = raw.slice(1, 33);
    const y = raw.slice(33, 65);
    const signedKey = new Map<CborValue, CborValue>([[1, 2], [3, -7], [-1, 1], [-2, x], [-3, y]]);
    const authData = new Uint8Array([
      ...RPID_HASH, 0x45, 0, 0, 0, 1,
      ...aaguid,
      (credentialId.length >> 8) & 0xff, credentialId.length & 0xff, ...credentialId,
      ...enc(signedKey),
    ]);
    const clientDataHash = new Uint8Array(32).fill(0x5a);
    const signature = new Uint8Array((await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      pair.privateKey,
      new Uint8Array([...authData, ...clientDataHash]),
    )) as ArrayBuffer);
    const attestationObject = enc(new Map<CborValue, CborValue>([
      ["fmt", "packed"],
      ["attStmt", new Map<CborValue, CborValue>([["alg", -7], ["sig", signature]])],
      ["authData", authData],
    ]));

    const parsed = parseAttestationObject(attestationObject);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.credentialKey.alg !== "ES256") return;
    const verifyKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array([0x04, ...parsed.value.credentialKey.x, ...parsed.value.credentialKey.y]),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifyKey,
      parsed.value.attestation?.signature ?? new Uint8Array(),
      new Uint8Array([...authData, ...clientDataHash]),
    );
    expect(verified).toBe(true);
  });
});
