// The fixture boundary for any world, twin or not.
//
// A fixture is the complete input the in-memory engine boots from: the
// operation's snapshot and the policy bundle in force. The synthetic twins
// are fixtures written as data; a host's own world is the same shape with
// its own ids and names. `defineWorld` is the one conversion from
// hand-written data (plain-string ids, see `Unbranded<Snapshot>`) into
// domain data, and it validates before the engine sees the result: the
// bundle passes `validatePolicyBundle`, the snapshot passes
// `invariantProblems`, and the fixture carries exactly one operation,
// because that is what a runtime bootstraps.
import { invariantProblems } from "../model.js";
import { validatePolicyBundle } from "../policy.js";
/** Convert a hand-written world once, and refuse it if it is incoherent.
 * The cast supplies the brands; the two validators decide validity. A
 * malformed world fails here, before any runtime loads it. */
export const defineWorld = (input) => {
    const snapshot = input.snapshot;
    const problems = [];
    if (input.name.length === 0)
        problems.push("the world needs a name");
    for (const problem of validatePolicyBundle(input.policy)) {
        problems.push(`policy: ${problem}`);
    }
    if (snapshot.operations.length !== 1) {
        problems.push(`a fixture carries exactly one operation, not ${snapshot.operations.length}`);
    }
    problems.push(...invariantProblems(snapshot, input.policy));
    if (problems.length > 0) {
        throw new Error(`invalid world "${input.name}": ${problems.join("; ")}`);
    }
    return { name: input.name, snapshot, policy: input.policy };
};
