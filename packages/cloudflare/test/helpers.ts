// Shared helpers for the coordinator suites: the response-envelope shape,
// the stub call, and the Cedar Works organization bootstrap payload — the
// same actors, principal links, org admins, and sealed config everywhere;
// only the organization id (and, at the ops surface, the display name and
// sealed marker) varies per test.

export interface Failure {
  readonly kind: string;
  readonly detail?: string;
}

export interface Envelope<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly failure?: Failure;
}

/** The coordinator handlers route on the pathname alone, so one fetch
 * authority serves both coordinators' stubs. */
export const call = async <T>(
  stub: DurableObjectStub,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Envelope<T> }> => {
  const response = await stub.fetch(`https://authority.internal${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
};

export const organizationBootstrap = (
  organizationId: string,
  overrides: { readonly displayName?: string; readonly sealedIdpConfig?: string } = {},
) => ({
  organizationId,
  displayName: overrides.displayName ?? "Cedar Works",
  actors: [
    { actorId: "actor-admin", displayName: "Nia Fields" },
    { actorId: "actor-member", displayName: "Sam Whitfield" },
  ],
  principalLinks: [
    { provider: "idp", subject: "admin", actorId: "actor-admin" },
    { provider: "idp", subject: "member", actorId: "actor-member" },
  ],
  orgAdmins: ["actor-admin"],
  sealedIdpConfig: overrides.sealedIdpConfig ?? "sealed:test-only",
});
