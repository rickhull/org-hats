// The public conformance inventory — the executable specification of the
// portable authority and access behaviour (docs/authority_redesign.md
// § Verification strategy).
//
// Every case runs through the public surface only: the model, the
// AuthorityRuntime, the synthetic twins, and the access verifier. A case
// that cannot be expressed here is a design bug, not a test gap. The same
// inventory runs against another runtime by supplying a different
// ConformanceWorld factory, as the Cloudflare adapter does.
//
// The inventory world is the two consumer-design twins plus the invitee
// fixture; the Berlin Airlift twin is deliberately excluded — it is
// public-history data for the coalition shape, exercised by the portable
// suites, not part of the runtime inventory's world.
//
// The ids are a fresh scheme (`OH-*`), not the frozen v0.4 `OH-QM-*` ids.
// The cases live in `src/conformance/`, split by family, with one exported
// list in `src/conformance/cases.ts`.

import type { ConformanceCase } from "./conformance/case.ts";
import { CONFORMANCE_CASES } from "./conformance/cases.ts";
import {
  createInMemoryConformanceWorld,
  type ConformanceWorldFactory,
} from "./conformance/world.ts";

export type { ConformanceCase } from "./conformance/case.ts";
export {
  CONFORMANCE_FIXTURES,
  CONFORMANCE_INVITEE,
  CONFORMANCE_PRINCIPALS,
  CONFORMANCE_WORLD,
  createInMemoryConformanceWorld,
} from "./conformance/world.ts";
export type {
  ConformancePrincipal,
  ConformanceWorld,
  ConformanceWorldDescription,
  ConformanceWorldFactory,
} from "./conformance/world.ts";
export { CONFORMANCE_CASES } from "./conformance/cases.ts";

export interface ConformanceResult {
  readonly id: string;
  readonly title: string;
  readonly ok: boolean;
  readonly error?: string;
}

/** Run every case in a fresh world, so one case's mutations cannot mask
 * another's. The default world is the in-memory authority. */
export const runConformance = async (
  makeWorld: ConformanceWorldFactory = createInMemoryConformanceWorld,
): Promise<readonly ConformanceResult[]> => {
  const results: ConformanceResult[] = [];
  for (const conformanceCase of CONFORMANCE_CASES) {
    try {
      await conformanceCase.run(await makeWorld());
      results.push({ id: conformanceCase.id, title: conformanceCase.title, ok: true });
    } catch (error) {
      results.push({
        id: conformanceCase.id,
        title: conformanceCase.title,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
};
