// WebAuthn authenticator data, attestation objects, and COSE keys — the
// parsing layer above the CBOR decoder. The same boundary discipline: every
// refusal is a value, unknown constructs are refused rather than skipped,
// and nothing here verifies a signature — it extracts exactly the bytes
// crypto.subtle will be asked to verify (docs/authority_redesign.md § Local
// credentials).

import { decodeCbor, type CborValue } from "./cbor";

/** A COSE key reduced to what WebCrypto needs. RS256 appears only if a real
 * authenticator demands it; ES256 is the passkey default. */
export type CoseKey =
  | { readonly alg: "ES256"; readonly x: Uint8Array; readonly y: Uint8Array }
  | { readonly alg: "RS256"; readonly n: Uint8Array; readonly e: Uint8Array };

export interface AuthenticatorData {
  readonly rpIdHash: Uint8Array;
  readonly userPresent: boolean;
  readonly userVerified: boolean;
  /** Backup-eligibility and backup-state flags, read opaquely: authority
   * never interprets them, but the bytes must be accounted for. */
  readonly backupEligible: boolean;
  readonly backedUp: boolean;
  readonly signCount: number;
  readonly credentialId?: Uint8Array;
  readonly credentialKey?: CoseKey;
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

export interface Attestation {
  /** The attestation statement's signature, when the format carries one a
   * verifier can check without a trust path (packed self-attestation). */
  readonly signature?: Uint8Array;
  readonly algorithm?: number;
}

export interface Registration {
  readonly format: "none" | "packed";
  /** The raw authenticator-data bytes, exactly as signed: a self-attestation
   * signature covers `authenticatorData || clientDataHash`, so the verifier
   * needs the member's bytes, not a re-encoding. */
  readonly authenticatorDataBytes: Uint8Array;
  readonly authenticator: AuthenticatorData;
  readonly credentialId: Uint8Array;
  readonly credentialKey: CoseKey;
  readonly attestation?: Attestation;
}

const fail = <T>(reason: string): ParseResult<T> => ({ ok: false, reason });

const FLAGS = { userPresent: 0x01, userVerified: 0x04, backupEligible: 0x08, backedUp: 0x10, attested: 0x40, extensions: 0x80 } as const;

/** Map a decoded CBOR map to a COSE key, or refuse it. Only EC2/ES256 (and
 * RSA/RS256) are read; every other pair of key type and algorithm is a
 * construct this runtime does not promise to verify. */
const coseKeyOf = (value: CborValue): ParseResult<CoseKey> => {
  if (!(value instanceof Map)) return fail("the credential key is not a CBOR map");
  const field = (key: number): CborValue | undefined => value.get(key);
  const kty = field(1);
  const alg = field(3);
  if (kty === 2 && alg === -7) {
    const curve = field(-1);
    const x = field(-2);
    const y = field(-3);
    if (curve !== 1 || !(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
      return fail("the EC2 key is not a P-256 point");
    }
    if (x.length !== 32 || y.length !== 32) return fail("the P-256 point coordinates are not 32 bytes");
    return { ok: true, value: { alg: "ES256", x, y } };
  }
  if (kty === 3 && alg === -257) {
    const n = field(-1);
    const e = field(-2);
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) return fail("the RSA key is incomplete");
    return { ok: true, value: { alg: "RS256", n, e } };
  }
  return fail("the credential key is neither EC2/ES256 nor RSA/RS256");
};

/** Authenticator data (WebAuthn §6.1): 32-byte RP id hash, one flags byte,
 * a big-endian sign counter, then — only when the attested-credential flag
 * is set — the AAGUID, credential id, and COSE key. Extension blocks are
 * refused: this runtime reads none, and skipping bytes it does not
 * understand is how a parser starts lying. */
export const parseAuthenticatorData = (bytes: Uint8Array): ParseResult<AuthenticatorData> => {
  if (bytes.length < 37) return fail("authenticator data is shorter than its fixed head");
  const flags = bytes[32] ?? 0;
  if ((flags & FLAGS.extensions) !== 0) return fail("extension data is not supported");
  const signCount = ((bytes[33] ?? 0) << 24) | ((bytes[34] ?? 0) << 16) | ((bytes[35] ?? 0) << 8) | (bytes[36] ?? 0);
  const data: AuthenticatorData = {
    rpIdHash: bytes.subarray(0, 32),
    userPresent: (flags & FLAGS.userPresent) !== 0,
    userVerified: (flags & FLAGS.userVerified) !== 0,
    backupEligible: (flags & FLAGS.backupEligible) !== 0,
    backedUp: (flags & FLAGS.backedUp) !== 0,
    signCount,
  };
  if ((flags & FLAGS.attested) === 0) {
    if (bytes.length !== 37) return fail("authenticator data carries trailing bytes");
    return { ok: true, value: data };
  }
  let pos = 37;
  if (pos + 16 + 2 > bytes.length) return fail("the attested credential block is truncated");
  pos += 16; // the AAGUID, read opaquely — attestation identity is not interpreted
  const idLength = ((bytes[pos] ?? 0) << 8) | (bytes[pos + 1] ?? 0);
  pos += 2;
  if (idLength === 0) return fail("the credential id is empty");
  if (pos + idLength > bytes.length) return fail("the credential id is truncated");
  const credentialId = bytes.subarray(pos, pos + idLength);
  pos += idLength;
  const key = decodeCbor(bytes.subarray(pos));
  if (!key.ok) return fail(`the credential key is not decodable: ${key.reason}`);
  if (key.item.rest.length !== 0) return fail("authenticator data carries trailing bytes");
  const coseKey = coseKeyOf(key.item.value);
  if (!coseKey.ok) return fail(coseKey.reason);
  return { ok: true, value: { ...data, credentialId, credentialKey: coseKey.value } };
};

/** An attestation object: fmt, attStmt, authData. `none` and packed
 * self-attestation parse; a packed statement carrying a certificate chain
 * is refused — verifying it needs a trust path, and the recorded decision
 * is that attestation is handled, never required
 * (docs/authority_redesign.md § Local credentials). */
export const parseAttestationObject = (bytes: Uint8Array): ParseResult<Registration> => {
  const decoded = decodeCbor(bytes);
  if (!decoded.ok) return fail(decoded.reason);
  if (decoded.item.rest.length !== 0) return fail("the attestation object carries trailing bytes");
  const value = decoded.item.value;
  if (!(value instanceof Map)) return fail("the attestation object is not a CBOR map");
  const fmt = value.get("fmt");
  if (fmt !== "none" && fmt !== "packed") {
    return fail(`attestation format ${String(fmt)} is not supported`);
  }
  const authDataBytes = value.get("authData");
  if (!(authDataBytes instanceof Uint8Array)) return fail("the attestation object carries no authenticator data");
  const authenticator = parseAuthenticatorData(authDataBytes);
  if (!authenticator.ok) return fail(authenticator.reason);
  const { credentialId, credentialKey } = authenticator.value;
  if (credentialId === undefined || credentialKey === undefined) {
    return fail("the registration carries no attested credential");
  }
  const attStmt = value.get("attStmt");
  if (!(attStmt instanceof Map)) return fail("the attestation statement is not a CBOR map");
  if (fmt === "none") {
    if (attStmt.size !== 0) return fail("a none-format statement carries fields");
    return { ok: true, value: { format: "none", authenticatorDataBytes: authDataBytes, authenticator: authenticator.value, credentialId, credentialKey } };
  }
  const alg = attStmt.get("alg");
  const signature = attStmt.get("sig");
  if (typeof alg !== "number" || !(signature instanceof Uint8Array)) {
    return fail("the packed statement is incomplete");
  }
  if (attStmt.has("x5c")) return fail("attestation trust paths are not supported");
  return {
    ok: true,
    value: {
      format: "packed",
      authenticatorDataBytes: authDataBytes,
      authenticator: authenticator.value,
      credentialId,
      credentialKey,
      attestation: { signature, algorithm: alg },
    },
  };
};
