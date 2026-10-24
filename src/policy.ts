// The policy bundle — the smallest vocabulary a host needs to state what its
// roles may do (docs/authority_redesign.md § Core: bundle validation is the
// core's). A host supplies actions, role titles, role-to-action mapping, and
// the read policy; everything else in the model treats actions as opaque
// strings named here. This is deliberately not a general policy language:
// the vocabulary grows only when a real design case exercises a new need.

/** How the issuer computes `readableOrganizationIds`:
 * - `granted-teams` — the organizations of the teams the actor's grants
 *   reach (read reach follows the grants);
 * - `all-participating` — every organization actively participating.
 */
export type OrganizationReadPolicy = "granted-teams" | "all-participating";

/** The read policy is a set of independent axes, one per dimension of reach.
 * v1 defines only the organization axis. A future team-audience axis is an
 * additive optional property on this interface, not a change to the shape of
 * `readPolicy` or to what the organization axis means; no code may assume
 * organization-level reach is the only axis. */
export interface ReadPolicy {
  readonly organizations: OrganizationReadPolicy;
}

export interface PolicyRole {
  /** Role titles are data, not platform enums; the bundle owns them. */
  readonly title: string;
  readonly actions: readonly string[];
}

export interface PolicyBundle {
  readonly format: 1;
  readonly id: string;
  readonly version: string;
  /** The operation's action vocabulary. Actions are opaque to org-hats; the
   * host names them and the bundle maps roles onto them. */
  readonly actions: readonly string[];
  readonly roles: readonly PolicyRole[];
  readonly readPolicy: ReadPolicy;
}

/** One sentence per problem, in plain words. An empty list is the only valid
 * bundle. */
export type PolicyProblem = string;

const isOrganizationReadPolicy = (value: unknown): value is OrganizationReadPolicy =>
  value === "granted-teams" || value === "all-participating";

const READ_POLICY_AXES = new Set<string>(["organizations"]);

export const validatePolicyBundle = (bundle: PolicyBundle): readonly PolicyProblem[] => {
  const problems: PolicyProblem[] = [];
  if (bundle.format !== 1) problems.push("the bundle format must be 1");
  if (bundle.id.length === 0) problems.push("the bundle needs an id");
  if (bundle.version.length === 0) problems.push("the bundle needs a version");
  if (bundle.actions.length === 0) problems.push("the action vocabulary is empty");
  if (new Set(bundle.actions).size !== bundle.actions.length) {
    problems.push("an action appears twice in the vocabulary");
  }
  const known = new Set(bundle.actions);
  const titles = new Set<string>();
  for (const role of bundle.roles) {
    if (role.title.length === 0) {
      problems.push("a role has no title");
    } else if (titles.has(role.title)) {
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
  } else {
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

/** The actions a role title carries under a validated bundle; `undefined`
 * when the title is not in the bundle — callers treat that as a validation
 * problem, never as "no actions". */
export const actionsOf = (bundle: PolicyBundle, role: string): readonly string[] | undefined =>
  bundle.roles.find((r) => r.title === role)?.actions;
