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
export const AUTHORITY_INTERFACE_VERSION = 3;
/** The envelope and claims format version. This, with the format marker and
 * the envelope's own `v`, is what `verify` gates reading on. It moves only
 * when the meaning of the claims changes, never for a command-surface
 * change. */
export const ACCESS_ENVELOPE_VERSION = 1;
export const ACCESS_ENVELOPE_FORMAT = "org-hats.access";
/** How deep a v1 claims payload may nest, leaf scalar included.
 *
 * Canonical bytes are an input to the signature check, so a verifier
 * canonicalizes claims it has not verified yet, and `canonicalJson` recurses.
 * Without a bound, a deeply nested payload is a stack overflow reachable with
 * nothing but a public key id and no valid signature.
 *
 * The number comes from the format, not from a runtime's stack: every
 * synthetic envelope nests to exactly 5 — the smallest and the largest, a 20x
 * spread in bytes — because depth is fixed by the closed claims shape while
 * breadth scales with an actor's reach. 8 keeps headroom so an additive
 * optional claim (E3) can nest without moving `ACCESS_ENVELOPE_VERSION`.
 * `tests/envelope-size.test.ts` pins the issued depth so a shape that grows
 * past the headroom fails there rather than at a verifier.
 *
 * Breadth is deliberately not bounded here: the authority legitimately issues
 * claims too large for a cookie, and the host refuses those at issuance
 * against its own budget. */
export const ACCESS_CLAIMS_MAX_DEPTH = 8;
/** The nesting depth of a value, leaf scalar included: `{ v: 1 }` is 2.
 *
 * The walk is iterative on an explicit stack. A recursive depth check would
 * overflow on exactly the input it exists to refuse, which is the defect
 * rather than the guard. */
export const accessClaimsDepth = (value) => {
    let deepest = 0;
    const pending = [{ node: value, depth: 1 }];
    while (pending.length > 0) {
        const next = pending.pop();
        if (next === undefined)
            break;
        const { node, depth } = next;
        if (depth > deepest)
            deepest = depth;
        if (typeof node !== "object" || node === null)
            continue;
        for (const child of Array.isArray(node) ? node : Object.values(node)) {
            pending.push({ node: child, depth: depth + 1 });
        }
    }
    return deepest;
};
/** Narrow a session result — `AccessIssue | Failed`, `Verified | Failed`,
 * `AuthorityContext | Failed` — to its failure arm. The session surface has
 * no `ok` discriminant; property presence is the discriminator, and this
 * names it once instead of every caller spelling the `in` check. Command
 * results keep their `ok` discriminant and do not use this. Narrowing a
 * typed union is all this does — it parses nothing. */
export const isFailed = (result) => "failure" in result;
/** The envelope gate shared by the verifier and the runtime's command and
 * context authorization. The format marker, the envelope's own version, and
 * the claims' version must agree before a signature is trusted or claims are
 * read. The claims' `interfaceVersion` is provenance and is deliberately not
 * checked here.
 *
 * It returns the parsed envelope rather than a verdict about one, so the
 * obligation to gate before reading is discharged by the only expression that
 * yields a claim. A caller that reads `envelope.claims` directly is working
 * around the gate; it read claims one statement before the gate once, and
 * returning the value is what makes the mistake unnatural rather than merely
 * forbidden. E4 is the statement a reimplementation inherits; this is the
 * shape that holds for this one. */
export const parseAccessEnvelope = (envelope) => {
    // The parameter is `unknown` because the envelope is untrusted input: a host
    // decodes it from a cookie or a request body, and the declared type is erased
    // before it arrives. This gate is the only thing between that input and a
    // field read, so it owns the structural checks too — a non-object envelope or
    // an absent claims payload is a closed failure here, never an exception out
    // of a caller that promised a failure as a value.
    // Structure first, and it is `unauthenticated`, not a version disagreement:
    // a non-object envelope declares no version, so the caller presented no
    // usable authority. Only something recognizable as an envelope can disagree
    // with us about a version. The distinction is what a host shows a person
    // whose bearer cookie was truncated — clear it and sign in again, not a 500.
    if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
        return { kind: "unauthenticated", detail: "not a readable access envelope" };
    }
    const candidate = envelope;
    if (candidate.format !== ACCESS_ENVELOPE_FORMAT) {
        return { kind: "wrong-interface-version", detail: "not a recognized access envelope" };
    }
    if (candidate.v !== ACCESS_ENVELOPE_VERSION) {
        return { kind: "wrong-interface-version", detail: "unrecognized envelope version" };
    }
    const claims = candidate.claims;
    if (typeof claims !== "object" || claims === null || Array.isArray(claims)) {
        return { kind: "unauthenticated", detail: "the envelope carries no claims" };
    }
    if (claims.v !== ACCESS_ENVELOPE_VERSION) {
        return { kind: "wrong-interface-version", detail: "envelope and claims disagree on the version" };
    }
    // Depth last, and before any caller canonicalizes: the version pair is two
    // comparisons, while this walks the payload. Over the bound the claims are
    // unreadable rather than a version we disagree about, so the answer is the
    // same `unauthenticated` as an envelope that was never an object.
    if (accessClaimsDepth(claims) > ACCESS_CLAIMS_MAX_DEPTH) {
        return { kind: "unauthenticated", detail: "the claims nest deeper than the format allows" };
    }
    // The carriage fields last, and for the same reason as the claims: an absent
    // `keyId` or `signature` used to fail closed only by accident downstream —
    // an unknown key id, or a decode that threw inside the Ed25519 key and was
    // caught there. Parsing them here makes the refusal the gate's own and names
    // it honestly: an envelope missing its signature is unreadable, not
    // mis-signed.
    const carriage = envelope;
    if (typeof carriage.keyId !== "string" || carriage.keyId.length === 0) {
        return { kind: "unauthenticated", detail: "the envelope names no key id" };
    }
    if (typeof carriage.signature !== "string" || carriage.signature.length === 0) {
        return { kind: "unauthenticated", detail: "the envelope carries no signature" };
    }
    return {
        keyId: carriage.keyId,
        signature: carriage.signature,
        claims: claims,
    };
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
