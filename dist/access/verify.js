// The verification-only module's engine: a signed envelope in, neutral
// authority facts out (docs/authority_redesign.md § Access).
//
// The verifier checks signature, interface and format versions, expiry, and
// the caller's expected operation/site binding — in that order of trust —
// and fails closed on everything it does not recognize. It never rebuilds
// reach, fallback, or worn-hat rules: the issuer computed those; the
// verifier compares ids and evaluates the selected hat locally. Product
// verbs are host code mapping onto these neutral targets.
import { ACCESS_ENVELOPE_FORMAT, ACCESS_ENVELOPE_VERSION, AUTHORITY_INTERFACE_VERSION, base64Decode, base64UrlDecode, canonicalJson, utf8, } from "../contract.js";
const failed = (failure) => ({ failure });
/** Pure and platform-free, for tests and alternate runtimes: accepts any
 * verify predicate. */
export const verifyKeyOf = (keyId, verify) => ({
    keyId,
    verify,
});
const subtle = globalThis.crypto?.subtle;
/** An Ed25519 verification key from the base64 raw public bytes the issuer
 * distributed. Web Platform crypto through structural types — the fence
 * stays `types: []`. */
export const ed25519VerifyKey = async (keyId, rawPublicKeyBase64) => {
    if (subtle === undefined)
        throw new Error("Web Platform crypto (crypto.subtle) is unavailable");
    const key = await subtle.importKey("raw", base64Decode(rawPublicKeyBase64), { name: "Ed25519" }, false, ["verify"]);
    return {
        keyId,
        verify: async (payload, signature) => {
            try {
                return await subtle.verify({ name: "Ed25519" }, key, base64UrlDecode(signature), utf8(payload));
            }
            catch {
                return false;
            }
        },
    };
};
/** Neutral access over verified claims — the predicates hosts call. */
const neutralAccess = (claims) => ({
    operationId: claims.operationId,
    sites: claims.sites,
    mayAct: (action, target) => {
        if (target.kind === "operation")
            return false;
        if (!claims.hat.actions.includes(action))
            return false;
        if (target.kind === "site")
            return claims.hat.siteIds.includes(target.siteId);
        return claims.hat.teamIds.includes(target.teamId);
    },
    readableOrganizationIds: () => claims.readableOrganizationIds,
    readableTeamIds: () => claims.readableTeamIds,
    mayConfigure: (siteId) => claims.configurableSiteIds.includes(siteId),
    expiresAt: () => claims.exp,
});
/**
 * Verify an envelope and yield neutral access. Fail-closed order: format and
 * versions first (nothing unrecognized is interpreted), then the signature
 * (an unknown key id cannot verify), then expiry, then the caller's expected
 * bindings.
 */
export const verify = async (envelope, keys, context = {}) => {
    if (envelope.format !== ACCESS_ENVELOPE_FORMAT || envelope.v !== ACCESS_ENVELOPE_VERSION) {
        return failed({ kind: "wrong-interface-version", detail: "not a recognized access envelope" });
    }
    if (envelope.claims.interfaceVersion !== AUTHORITY_INTERFACE_VERSION) {
        return failed({ kind: "wrong-interface-version" });
    }
    const key = keys.get(envelope.keyId);
    if (key === undefined) {
        return failed({ kind: "invalid-signature", detail: `unknown key id ${envelope.keyId}` });
    }
    const payload = canonicalJson(envelope.claims);
    if (!(await key.verify(payload, envelope.signature))) {
        return failed({ kind: "invalid-signature" });
    }
    const now = context.now ?? Math.floor(Date.now() / 1000);
    if (now >= envelope.claims.exp) {
        return failed({ kind: "expired" });
    }
    if (context.expectedOperationId !== undefined && envelope.claims.operationId !== context.expectedOperationId) {
        return failed({ kind: "wrong-binding", detail: "envelope belongs to another operation" });
    }
    if (context.expectedSiteId !== undefined &&
        !envelope.claims.sites.some((site) => site.siteId === context.expectedSiteId)) {
        return failed({ kind: "wrong-binding", detail: "envelope is not admitted to this site" });
    }
    return { claims: envelope.claims, access: neutralAccess(envelope.claims) };
};
