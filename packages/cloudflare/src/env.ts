export interface Env {
  readonly COUNTER: DurableObjectNamespace;
  readonly ORGANIZATION: DurableObjectNamespace;
  readonly OPERATION: DurableObjectNamespace;
  readonly SUBJECT_GUARD: DurableObjectNamespace;
  /** Comma-separated organization directory for evidence resolution across
   * coordinators. Ops supplies this; there is no global registry. */
  readonly AUTHORITY_ORGANIZATION_IDS?: string;
  /** Positive activation lifetime in seconds; defaults to 24 hours. */
  readonly AUTHORITY_ACTIVATION_LIFETIME_SECONDS?: string;
  /** Ops bearer token. A deployment secret; the test var is a local value. */
  readonly OPS_TOKEN?: string;
  /** The signing-key set, all or none: pkcs8 base64 private key, raw base64
   * public half, and id. A partial set is rejected, and the halves are
   * proven a pair at import. */
  readonly AUTHORITY_SIGNING_KEY?: string;
  readonly AUTHORITY_SIGNING_PUBLIC_KEY?: string;
  readonly AUTHORITY_SIGNING_KEY_ID?: string;
  /** The canonical serialized `VerifyKeySet` JSON — every key that should
   * verify during the verifier-first half of a rotation. */
  readonly AUTHORITY_VERIFICATION_KEYS?: string;
}
