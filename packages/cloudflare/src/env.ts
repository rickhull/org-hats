export interface Env {
  readonly COUNTER: DurableObjectNamespace;
  readonly ORGANIZATION: DurableObjectNamespace;
  readonly OPERATION: DurableObjectNamespace;
  /** Comma-separated organization directory for evidence resolution across
   * coordinators. Ops supplies this; there is no global registry. */
  readonly AUTHORITY_ORGANIZATION_IDS?: string;
}
