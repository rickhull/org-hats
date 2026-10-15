// Run every example, in order. The counterpart of bin/check for the module's
// walkthroughs.
//
//   node examples/check.ts

import { runModel } from "./model.ts";
import { runOperations } from "./operations.ts";
import { runConformance } from "./conformance.ts";
import { runDecide } from "./decide.ts";

console.log("== examples/model.ts ==");
await runModel(false);

console.log("\n== examples/operations.ts ==");
await runOperations(false);

console.log("\n== examples/conformance.ts ==");
await runConformance();

console.log("\n== examples/decide.ts ==");
await runDecide();

console.log("\nall examples passed");
