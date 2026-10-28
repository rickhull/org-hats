import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

interface GuardInput {
  readonly kind: "bind" | "activation-accept";
  readonly organizationId: string;
  readonly organizationIds: readonly string[];
  readonly provider: string;
  readonly subject: string;
  readonly actorId?: string;
  readonly secretHash?: string;
}

interface Envelope {
  readonly ok: boolean;
  readonly failure?: { readonly kind: string; readonly detail?: string };
}

const relay = async (stub: DurableObjectStub, path: string, body?: unknown): Promise<Response> =>
  stub.fetch(`https://authority.internal${path}`, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });

/** One object per provider subject. Its explicit promise queue keeps the
 * directory scan and target commit exclusive across awaited object calls. */
export class PrincipalSubjectGuard extends DurableObject<Env> {
  private tail: Promise<void> = Promise.resolve();

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release: (() => void) | undefined;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await work();
    } finally {
      release?.();
    }
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return Response.json({ ok: false }, { status: 405 });
    const input = await request.json() as GuardInput;
    return this.exclusive(async () => {
      for (const organizationId of [...new Set(input.organizationIds)]) {
        if (organizationId === input.organizationId) continue;
        let response: Response;
        try {
          response = await relay(
            this.env.ORGANIZATION.get(this.env.ORGANIZATION.idFromName(organizationId)),
            `/resolve?provider=${encodeURIComponent(input.provider)}&subject=${encodeURIComponent(input.subject)}`,
          );
        } catch {
          return Response.json({ ok: false, failure: { kind: "unavailable" } }, { status: 503 });
        }
        const resolved = await response.json() as Envelope;
        if (resolved.ok) {
          return Response.json({
            ok: false,
            failure: {
              kind: input.kind === "bind" ? "invalid-command" : "denied",
              detail: "the principal is already linked to another actor",
            },
          }, { status: 400 });
        }
        if (resolved.failure?.kind !== "unauthenticated") {
          return Response.json({ ok: false, failure: resolved.failure ?? { kind: "unavailable" } }, { status: 503 });
        }
      }

      const target = this.env.ORGANIZATION.get(this.env.ORGANIZATION.idFromName(input.organizationId));
      const response = input.kind === "bind"
        ? await relay(target, "/principal-link", {
            provider: input.provider,
            subject: input.subject,
            actorId: input.actorId,
          })
        : await relay(target, "/activation-accept", {
            provider: input.provider,
            subject: input.subject,
            secretHash: input.secretHash,
          });
      return new Response(response.body, {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    });
  }
}

export const subjectGuardName = async (provider: string, subject: string): Promise<string> => {
  const encoded = new TextEncoder().encode(JSON.stringify([provider, subject]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
