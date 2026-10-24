// The plugin exposes `cloudflare:test` and the Cloudflare global types on a
// types subpath. The tsconfig pins `types`, so this reference is what makes
// them resolve; it is the same arrangement Quartermaster uses.
/// <reference types="@cloudflare/vitest-plugin/types" />

type WorkerEnv = import("../src/env").Env;

declare namespace Cloudflare {
  interface Env extends WorkerEnv {}
  interface GlobalProps {
    mainModule: typeof import("../src/index");
    durableNamespaces: "Counter" | "OrganizationAuthority" | "OperationAuthority";
  }
}
