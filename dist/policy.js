// The policy bundle — the smallest vocabulary a host needs to state what its
// roles may do (docs/authority_redesign.md § Core: bundle validation is the
// core's). A host supplies actions, role titles, role-to-action mapping, and
// the read policy; everything else in the model treats actions as opaque
// strings named here. This is deliberately not a general policy language:
// the vocabulary grows only when a real design case exercises a new need.
const isOrganizationReadPolicy = (value) => value === "granted-teams" || value === "all-participating";
const READ_POLICY_AXES = new Set(["organizations"]);
export const validatePolicyBundle = (bundle) => {
    const problems = [];
    if (bundle.format !== 1)
        problems.push("the bundle format must be 1");
    if (bundle.id.length === 0)
        problems.push("the bundle needs an id");
    if (bundle.version.length === 0)
        problems.push("the bundle needs a version");
    if (bundle.actions.length === 0)
        problems.push("the action vocabulary is empty");
    if (new Set(bundle.actions).size !== bundle.actions.length) {
        problems.push("an action appears twice in the vocabulary");
    }
    const known = new Set(bundle.actions);
    const titles = new Set();
    for (const role of bundle.roles) {
        if (role.title.length === 0) {
            problems.push("a role has no title");
        }
        else if (titles.has(role.title)) {
            problems.push(`the role title "${role.title}" appears twice`);
        }
        titles.add(role.title);
        if (role.actions.length === 0) {
            problems.push(`the role "${role.title}" carries no action`);
        }
        for (const action of role.actions) {
            if (!known.has(action)) {
                problems.push(`the role "${role.title}" names the unknown action "${action}"`);
            }
        }
    }
    if (bundle.readPolicy === undefined || bundle.readPolicy === null) {
        problems.push("the read policy is missing");
    }
    else {
        for (const axis of Object.keys(bundle.readPolicy)) {
            if (!READ_POLICY_AXES.has(axis)) {
                problems.push(`the read policy has the unknown axis "${axis}"`);
            }
        }
        if (!isOrganizationReadPolicy(bundle.readPolicy.organizations)) {
            problems.push("the organization read policy must name granted-teams or all-participating");
        }
    }
    return problems;
};
/** The actions a role title carries under a validated bundle.
 * `{ found: false }` means the title is not in the bundle — callers treat
 * that as a validation problem, never as "no actions". */
export const actionsOf = (bundle, role) => {
    const actions = bundle.roles.find((r) => r.title === role)?.actions;
    return actions === undefined ? { found: false } : { found: true, actions };
};
