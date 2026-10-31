// The one exported inventory: families concatenated in the published order.
import { ACCESS_CASES } from "./access.js";
import { ACTIVATION_CASES } from "./activation.js";
import { AUTH_CASES } from "./auth.js";
import { COMMAND_CASES } from "./commands.js";
import { MODEL_CASES } from "./model.js";
import { PARTICIPATION_CASES } from "./participation.js";
import { ROSTER_CASES } from "./roster.js";
import { TEAM_CASES } from "./team.js";
export const CONFORMANCE_CASES = [
    ...MODEL_CASES,
    ...AUTH_CASES,
    ...ACTIVATION_CASES,
    ...ROSTER_CASES,
    ...TEAM_CASES,
    ...PARTICIPATION_CASES,
    ...COMMAND_CASES,
    ...ACCESS_CASES,
];
