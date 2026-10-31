// The one exported inventory: families concatenated in the published order.

import { ACCESS_CASES } from "./access.ts";
import { ACTIVATION_CASES } from "./activation.ts";
import { AUTH_CASES } from "./auth.ts";
import { COMMAND_CASES } from "./commands.ts";
import { MODEL_CASES } from "./model.ts";
import { PARTICIPATION_CASES } from "./participation.ts";
import { ROSTER_CASES } from "./roster.ts";
import { TEAM_CASES } from "./team.ts";
import type { ConformanceCase } from "./case.ts";

export const CONFORMANCE_CASES: readonly ConformanceCase[] = [
  ...MODEL_CASES,
  ...AUTH_CASES,
  ...ACTIVATION_CASES,
  ...ROSTER_CASES,
  ...TEAM_CASES,
  ...PARTICIPATION_CASES,
  ...COMMAND_CASES,
  ...ACCESS_CASES,
];
