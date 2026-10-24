// The portable authority engine — a deep module, not a repository.
//
// Charter (docs/authority_redesign.md § Authority): it owns the complete
// organizational use cases — participation workflows, admission and grants,
// hat selection, evidence resolution, refresh and envelope issuance — behind
// one runtime interface with a closed failure taxonomy. Persistence is an
// internal seam; the in-memory adapter ships beside it in this package and
// no adapter SPI is published.
//
// This file is the M0 fence placeholder: the module compiles inside the
// portable fence (no Node-only types, no Cloudflare imports) before any of
// that exists. The normative types land in M1 (plans/v1.md) and are reviewed
// with the consumer before the engine hardens behind them.
export {};
