// Local teaching prototype: serves only the playground and built JS modules.
// The engine and all mutable state live in each browser tab, never here.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../../", import.meta.url);
const assets = new Map([
  ["/", [new URL("./index.html", import.meta.url), "text/html; charset=utf-8"]],
  ["/activation", [new URL("./activation.html", import.meta.url), "text/html; charset=utf-8"]],
  ["/activation-app.mjs", [new URL("./activation-app.mjs", import.meta.url), "text/javascript; charset=utf-8"]],
  ["/activation.css", [new URL("./activation.css", import.meta.url), "text/css; charset=utf-8"]],
  ["/app.mjs", [new URL("./app.mjs", import.meta.url), "text/javascript; charset=utf-8"]],
  ["/style.css", [new URL("./style.css", import.meta.url), "text/css; charset=utf-8"]],
]);
const port = Number(process.env.PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535");
const controllers = new Map([
  ["/model.js", new URL("./model.ts", import.meta.url)],
  ["/activation-model.js", new URL("./activation-model.ts", import.meta.url)],
]);

const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  try {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    let content;
    let type;
    const controller = controllers.get(path);
    if (controller !== undefined) {
      const source = await readFile(controller, "utf8");
      const compiled = ts.transpileModule(source, {
        fileName: controller.pathname,
        reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext },
      });
      if (compiled.diagnostics?.some((item) => item.category === ts.DiagnosticCategory.Error)) {
        throw new Error("The playground controller does not compile; run pnpm check");
      }
      content = compiled.outputText;
      type = "text/javascript; charset=utf-8";
    } else {
      const asset = assets.get(path);
      // Exact path grammar excludes traversal, declarations, and arbitrary
      // repository files. Dist is tracked public output, not a secret store.
      const module = /^\/dist\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.js$/.test(path);
      if (asset === undefined && !module) {
        response.writeHead(404).end("Not found");
        return;
      }
      content = await readFile(asset?.[0] ?? new URL(path.slice(1), root));
      type = asset?.[1] ?? "text/javascript; charset=utf-8";
    }
    response.writeHead(200, { "Content-Type": type });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    const missing = error?.code === "ENOENT";
    if (!missing) console.error("Playground asset could not be served:", error.message);
    response.writeHead(missing ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(missing ? "Not found; run pnpm build if dist is missing." : "Playground could not load; see the server output.");
  }
});
server.listen(port, "127.0.0.1", () => console.log(`Authority playground: http://127.0.0.1:${port}`));
