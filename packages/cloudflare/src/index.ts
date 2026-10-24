export { Counter } from "./counter";

interface Env {
  readonly COUNTER: DurableObjectNamespace;
}

/** A minimal fetch surface for the harness: route to the singleton counter. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/increment") {
      return new Response("not found\n", { status: 404 });
    }
    const id = env.COUNTER.idFromName("harness");
    const stub = env.COUNTER.get(id) as DurableObjectStub & {
      increment(): Promise<number>;
    };
    return Response.json({ count: await stub.increment() });
  },
};
