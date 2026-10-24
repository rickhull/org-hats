export interface Env {
  readonly COUNTER: DurableObjectNamespace;
  readonly ORGANIZATION: DurableObjectNamespace;
  readonly OPERATION: DurableObjectNamespace;
  /** Comma-separated organization directory for evidence resolution across
   * coordinators. Ops supplies this; there is no global registry. */
  readonly AUTHORITY_ORGANIZATION_IDS?: string;
  /** Ops bearer token. A deployment secret; the test var is a local value. */
  readonly OPS_TOKEN?: string;
  /** Stable Ed25519 signing key: pkcs8 base64, its public raw base64, and id. */
  readonly AUTHORITY_SIGNING_KEY?: string;
  readonly AUTHORITY_SIGNING_PUBLIC_KEY?: string;
  readonly AUTHORITY_SIGNING_KEY_ID?: string;
  /** Additional verifier keys, `keyId:base64` comma-separated, for the
   * verifier-first half of a rotation. */
  readonly AUTHORITY_VERIFICATION_KEYS?: string;
}
