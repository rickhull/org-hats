// The shared conformance inventory — the cases a host proves.
//
// The ids are `OH-QM-01` … `OH-QM-11`: `OH` is this package, `QM` the first
// consumer's suite, kept stable so the two cannot drift into disagreeing about
// what a case *is*. The data is the contract: each side iterates
// CONFORMANCE_CASES, runs a body keyed by id, and fails on a missing id (see
// `conformanceGaps`). The bodies are not here, because a case is proved against
// a host's own writes and only the host owns those (see ./port).
//
// This file is pure: no driver, no `node:*`, so it lives inside the fence.

export interface ConformanceCase {
  /** Stable. Never renumbered and never reused — two suites compare these. */
  readonly id: string;
  /** One sentence of behavior, not of mechanism. */
  readonly description: string;
}

export const CONFORMANCE_CASES: readonly ConformanceCase[] = [
  {
    id: "OH-QM-01",
    description: "A config-only actor is admitted and configures but reads no reports.",
  },
  {
    id: "OH-QM-02",
    description: "A supervisor at one site does not reach the same-named team at another.",
  },
  {
    id: "OH-QM-03",
    description: "A primary that is not wearable does not authorize at another site; a live wearable hat stands in.",
  },
  {
    id: "OH-QM-04",
    description: "A revoked selected hat falls back immediately to a live wearable hat.",
  },
  {
    id: "OH-QM-05",
    description: "Historical acts retain a legible acting-hat snapshot after the hat is revoked.",
  },
  {
    id: "OH-QM-06",
    description: "A member is one atomic hat row; no half-member state exists.",
  },
  {
    id: "OH-QM-07",
    description: "A supervisor who is also a member speaks for the team without switching hats; a supervisor who is not is refused.",
  },
  {
    id: "OH-QM-08",
    description: "A configuring hat neither supervises nor adds organization read reach.",
  },
  {
    id: "OH-QM-09",
    description: "Peer reach is mutual, read-only, one hop, site-local, and supervisors-only.",
  },
  {
    id: "OH-QM-10",
    description: "Every indexed cost claimed by the adapter has an EXPLAIN QUERY PLAN assertion.",
  },
  {
    id: "OH-QM-11",
    description: "A request-scoped memo never outlives its request — a hat revoked after one request is not worn by the next.",
  },
];

export const CONFORMANCE_IDS: readonly string[] = CONFORMANCE_CASES.map((c) => c.id);

export interface ConformanceGaps {
  /** Inventory ids the host did not run. Non-empty means non-conformant. */
  readonly missing: readonly string[];
  /** Ids the host ran that the inventory does not name — stale or invented. */
  readonly unknown: readonly string[];
}

/** The one rule both sides share: a host that has run its bodies passes the
 * ids it ran; a non-empty `missing` or `unknown` fails the run. It grows
 * safely — adding a case here makes every host report it missing until it is
 * implemented, instead of passing quietly. */
export function conformanceGaps(ran: Iterable<string>): ConformanceGaps {
  const seen = new Set(ran);
  const known = new Set(CONFORMANCE_IDS);
  return {
    missing: CONFORMANCE_IDS.filter((id) => !seen.has(id)),
    unknown: [...seen].filter((id) => !known.has(id)),
  };
}

// --- the runner ---------------------------------------------------------------

/** One case's proof: build a fixture, assert behavior, throw to fail. */
export type ConformanceBody = () => void | Promise<void>;

/** A suite: one body per inventory id. */
export type ConformanceBodies = Readonly<Record<string, ConformanceBody>>;

/** A body that ran and threw. A body never registered is not a failure; it
 * is a gap. */
export interface ConformanceFailure {
  readonly id: string;
  readonly error: unknown;
}

export interface ConformanceResult {
  /** The drift check: inventory ids never registered, ids nobody knows. */
  readonly gaps: ConformanceGaps;
  /** Bodies that ran and threw. */
  readonly failures: readonly ConformanceFailure[];
}

/** Run a suite against the published inventory: every body runs, a throw is
 * recorded as a failure, and the ids ran are diffed against the inventory so
 * drift fails the report. A host calls this in its own test run;
 * `examples/conformance.ts` is the reference proof. */
export async function runConformance(bodies: ConformanceBodies): Promise<ConformanceResult> {
  const failures: ConformanceFailure[] = [];
  for (const [id, body] of Object.entries(bodies)) {
    try {
      await body();
    } catch (error) {
      failures.push({ id, error });
    }
  }
  return { gaps: conformanceGaps(Object.keys(bodies)), failures };
}
