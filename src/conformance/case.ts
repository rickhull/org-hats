// The case shape shared by every inventory family.

import type { ConformanceWorld } from "./world.ts";

export interface ConformanceCase {
  readonly id: string;
  readonly title: string;
  readonly run: (world: ConformanceWorld) => Promise<void>;
}

export const modelCase = (id: string, title: string, run: () => void): ConformanceCase => ({
  id,
  title,
  run: async () => {
    run();
  },
});

export const runtimeCase = (
  id: string,
  title: string,
  run: (world: ConformanceWorld) => Promise<void>,
): ConformanceCase => ({ id, title, run });
