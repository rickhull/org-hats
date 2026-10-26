// The shared v1 vocabulary — identifiers, interface versions, the failure
// taxonomy, and the access-envelope contract.
//
// Both portable modules import from here and neither imports the other:
// authority fills an envelope, access verifies one, and this file is the
// shape they agree on (docs/authority_redesign.md § Access). It is pure data
// and pure functions, compiled with `types: []` alongside the core fence.
//
// Nothing here is re-exported from the v0.4 root (src/index.ts); it becomes
// public through the `org-hats/authority` and `org-hats/access` subpaths,
// whose names this specification pass settles.
/** The only way to make a branded id: a named, deliberate conversion at the
 * boundary where an opaque caller-supplied string becomes a domain id. */
export const organizationId = (raw) => raw;
export const actorId = (raw) => raw;
export const operationId = (raw) => raw;
export const siteId = (raw) => raw;
export const teamId = (raw) => raw;
/** The boundary conversion for the numeric brand, same rule as the ids:
 * one named, deliberate conversion — wherever a wall-clock or
 * caller-supplied number becomes an instant. Hosts never call this;
 * public inputs take plain numbers and the runtime converts. */
export const epochSeconds = (raw) => raw;
// --- versions -----------------------------------------------------------------
/** The authority interface version. Every runtime call carries it, and a
 * mismatch is the `wrong-interface-version` failure, never a silent
 * reinterpretation. An envelope records it as provenance — which interface
 * issued the claims — but `verify` never gates reading on it: the envelope
 * outlives the call signatures that produced it, so a command-surface break
 * must not strand live sessions. The envelope's own version pair is what
 * gates. */
export const AUTHORITY_INTERFACE_VERSION = 2;
/** The envelope and claims format version. This, with the format marker and
 * the envelope's own `v`, is what `verify` gates reading on. It moves only
 * when the meaning of the claims changes, never for a command-surface
 * change. */
export const ACCESS_ENVELOPE_VERSION = 1;
export const ACCESS_ENVELOPE_FORMAT = "org-hats.access";
/** Narrow a session result — `AccessIssue | Failed`, `Verified | Failed`,
 * `AuthorityContext | Failed` — to its failure arm. The session surface has
 * no `ok` discriminant; property presence is the discriminator, and this
 * names it once instead of every caller spelling the `in` check. Command
 * results keep their `ok` discriminant and do not use this. Narrowing a
 * typed union is all this does — it parses nothing. */
export const isFailed = (result) => "failure" in result;
/** The envelope version gate shared by the verifier and the runtime's command
 * and context authorization. The format marker, the envelope's own version,
 * and the claims' version must agree before a signature is trusted or claims
 * are read. The claims' `interfaceVersion` is provenance and is deliberately
 * not checked here. */
export const envelopeVersionFailure = (envelope) => {
    if (envelope.format !== ACCESS_ENVELOPE_FORMAT) {
        return { kind: "wrong-interface-version", detail: "not a recognized access envelope" };
    }
    if (envelope.v !== ACCESS_ENVELOPE_VERSION) {
        return { kind: "wrong-interface-version", detail: "unrecognized envelope version" };
    }
    if (envelope.claims.v !== ACCESS_ENVELOPE_VERSION) {
        return { kind: "wrong-interface-version", detail: "envelope and claims disagree on the version" };
    }
    return undefined;
};
/** The one named conversion at the signing seam: structured claims become
 * the JSON model canonical serialization addresses. TypeScript cannot see
 * an interface as an index-signature record, so the cast is deliberate and
 * lives here rather than inline at every sign and verify. */
export const asJson = (value) => value;
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
export const canonicalJson = (value) => {
    if (isRecord(value)) {
        const keys = Object.keys(value).sort();
        const body = keys
            .map((key) => {
            // the key comes from the object itself, so the lookup cannot miss
            const inner = value[key] ?? null;
            return `${JSON.stringify(key)}:${canonicalJson(inner)}`;
        })
            .join(",");
        return `{${body}}`;
    }
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    return JSON.stringify(value);
};
// --- byte codecs ------------------------------------------------------------------
//
// The signed bytes must be exact, so UTF-8 and base64 are owned, not
// borrowed from a platform: both issuer and verifier encode through these,
// and a host never reimplements them.
export const utf8 = (text) => {
    const bytes = [];
    for (const char of text) {
        const cp = char.codePointAt(0) ?? 0;
        if (cp < 0x80)
            bytes.push(cp);
        else if (cp < 0x800)
            bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
        else if (cp < 0x10000)
            bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        else
            bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return Uint8Array.from(bytes);
};
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export const base64Encode = (bytes) => {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i] ?? 0;
        const b1 = i + 1 < bytes.length ? (bytes[i + 1] ?? 0) : 0;
        const b2 = i + 2 < bytes.length ? (bytes[i + 2] ?? 0) : 0;
        out += BASE64[b0 >> 2];
        out += BASE64[((b0 & 3) << 4) | (b1 >> 4)];
        out += i + 1 < bytes.length ? BASE64[((b1 & 15) << 2) | (b2 >> 6)] : "=";
        out += i + 2 < bytes.length ? BASE64[b2 & 63] : "=";
    }
    return out;
};
export const base64Decode = (text) => {
    const clean = text.replace(/=+$/, "");
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (const char of clean) {
        const value = BASE64.indexOf(char);
        if (value < 0)
            throw new Error("invalid base64");
        buffer = (buffer << 6) | value;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 255);
        }
    }
    return Uint8Array.from(bytes);
};
/** Unpadded base64url (RFC 4648 §5), the signature and handle encoding —
 * safe in cookies and URLs without escaping. Public keys stay standard
 * base64 because they are configuration, not transport. */
export const base64UrlEncode = (bytes) => base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const base64UrlDecode = (text) => base64Decode(text.replace(/-/g, "+").replace(/_/g, "/"));
