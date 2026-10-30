// Supplementary witnesses for `tests/specs.test.ts`. Most witnesses are
// tagged test titles (`[A7] …`); this file carries the ones a title cannot
// express: conformance cases, static gates, and the two architecture claims
// that are reviewed rather than executed.
//
// A static witness names a `path` the gate checks exists; `command` records
// how it runs. A review witness names the document the claim is reviewed
// against. Add an id here only when no tagged test is the cheaper witness.

export type SpecId = `A${number}` | `E${number}` | `P${number}`;
export type Tier = "P" | "S" | "I1" | "I2" | "I3" | "X" | "R";

export interface ConformanceWitness {
  readonly kind: "conformance";
  readonly id: SpecId;
  readonly caseId: string;
}

export interface StaticWitness {
  readonly kind: "static";
  readonly id: SpecId;
  readonly path: string;
  readonly command: string;
  readonly why: string;
}

export interface ReviewWitness {
  readonly kind: "review";
  readonly id: SpecId;
  readonly document: string;
  readonly why: string;
}

export type SupplementaryWitness = ConformanceWitness | StaticWitness | ReviewWitness;

export interface IntegrationOnly {
  readonly id: SpecId;
  readonly why: string;
}

export const SUPPLEMENTARY_WITNESSES: readonly SupplementaryWitness[] = [
  // Conformance cases run through the public surface in the portable ring.
  { kind: "conformance", id: "A1", caseId: "OH-CMD-02" },
  { kind: "conformance", id: "A1", caseId: "OH-PART-02" },
  { kind: "conformance", id: "A3", caseId: "OH-AUTH-01" },
  { kind: "conformance", id: "A7", caseId: "OH-AUTH-04" },
  { kind: "conformance", id: "A7", caseId: "OH-AUTH-05" },
  { kind: "conformance", id: "A8", caseId: "OH-CMD-01" },
  { kind: "conformance", id: "A15", caseId: "OH-CMD-02" },
  { kind: "conformance", id: "A17", caseId: "OH-TEAM-01" },
  { kind: "conformance", id: "A17", caseId: "OH-TEAM-02" },
  { kind: "conformance", id: "A17", caseId: "OH-TEAM-03" },
  { kind: "conformance", id: "E7", caseId: "OH-ACCESS-02" },
  { kind: "conformance", id: "E8", caseId: "OH-ACCESS-04" },

  // Static witnesses: the gate that enforces the invariant, not a test title.
  {
    kind: "static",
    id: "A11",
    path: "src/authority/types.ts",
    command: "bin/check",
    why: "PrincipalEvidence carries identity and authentication facts only; the provider exchange lives in packages/cloudflare/src/exchange.ts, and the fence rejects a provider import under src/.",
  },
  {
    kind: "static",
    id: "P1",
    path: "bin/check",
    command: "bin/check",
    why: "The compiler fence and Cloudflare-import guard run on every change.",
  },
  {
    kind: "static",
    id: "P2",
    path: "package.json",
    command: "pnpm check / pnpm check:cloudflare",
    why: "The split scripts and their CI modes keep the portable suites platform-free.",
  },
  {
    kind: "static",
    id: "P5",
    path: "tests/fixtures",
    command: "node --test tests/docs.test.ts",
    why: "Fixtures are synthetic, the envelope vector key is test-only, and the docs fence pins the twin ids.",
  },
  {
    kind: "static",
    id: "P8",
    path: "tsconfig.tests.json",
    command: "pnpm typecheck:tests",
    why: "The tests and examples compile under the same gate as the rest of the source.",
  },

  // Review witnesses: architectural claims with no executable assertion.
  {
    kind: "review",
    id: "P3",
    document: "docs/authority_redesign.md",
    why: "Portable semantics with one reference runtime; a second adapter appears only with a committed consumer.",
  },
  {
    kind: "review",
    id: "P4",
    document: "docs/cloudflare.md",
    why: "The reference runtime stays on SQLite, alarms, bindings, and Web Crypto; no proprietary binding is required.",
  },
];

// Specs whose only witness is an I tier. The list is empty today: every id
// has a portable, static, or review witness. Add an entry only when a fact
// genuinely exists only across a coordinator boundary.
export const INTEGRATION_ONLY: readonly IntegrationOnly[] = [];
