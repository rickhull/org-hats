// The command policy table: one row per authority command kind, stating the
// owning coordinator, whether the command binds to an operation, the accepted
// authorization mode, and the standing the handler requires. The engine and
// the Cloudflare runtime consume this table instead of maintaining their own
// kind lists; the command-inventory test checks the coordinators against it.
//
// `mode: "ignored"` is request-access: the evidence in the request is the
// request, and the shell authorization is not read.
export const COMMAND_POLICY = {
    "request-access": { coordinator: "operation", operationBound: true, standing: "none", mode: "ignored" },
    "participation-invite": { coordinator: "operation", operationBound: true, standing: "operation-admin", mode: "either" },
    "participation-accept": { coordinator: "organization", operationBound: true, standing: "organization-admin", mode: "either" },
    "participation-revoke": { coordinator: "by-participation", operationBound: true, standing: "by-participation", mode: "either" },
    admit: { coordinator: "operation", operationBound: true, standing: "operation-admin", mode: "either" },
    "grant-hat": { coordinator: "operation", operationBound: true, standing: "operation-admin", mode: "either" },
    "revoke-grant": { coordinator: "operation", operationBound: true, standing: "operation-admin", mode: "either" },
    "select-hat": { coordinator: "operation", operationBound: true, standing: "operation-admin-or-owner", mode: "either" },
    "request-team": {
        coordinator: "operation",
        operationBound: true,
        standing: "organization-admin",
        mode: "fresh",
        sameOrganization: true,
        freshDetail: "team changes require fresh evidence",
    },
    "admit-team": { coordinator: "operation", operationBound: true, standing: "operation-admin", mode: "either" },
    "update-team": {
        coordinator: "operation",
        operationBound: true,
        standing: "organization-admin",
        mode: "fresh",
        sameOrganization: true,
        freshDetail: "team changes require fresh evidence",
    },
    "retire-team": {
        coordinator: "operation",
        operationBound: true,
        standing: "operation-admin-or-org-owner",
        mode: "either",
    },
    "disable-actor": { coordinator: "organization", operationBound: false, standing: "organization-admin", mode: "either" },
    "unlink-principal": {
        coordinator: "organization",
        operationBound: false,
        standing: "organization-admin",
        mode: "fresh",
        sameOrganization: true,
        freshDetail: "principal recovery requires fresh evidence",
    },
    "revoke-activation": {
        coordinator: "organization",
        operationBound: false,
        standing: "organization-admin",
        mode: "fresh",
        sameOrganization: true,
        freshDetail: "principal recovery requires fresh evidence",
    },
    "create-actor": {
        coordinator: "organization",
        operationBound: false,
        standing: "organization-admin",
        mode: "fresh",
        sameOrganization: true,
        freshDetail: "roster changes require fresh evidence",
    },
    "update-actor": {
        coordinator: "organization",
        operationBound: false,
        standing: "organization-admin",
        mode: "fresh",
        sameOrganization: true,
        freshDetail: "roster changes require fresh evidence",
    },
    "appoint-administrator": {
        coordinator: "organization",
        operationBound: false,
        standing: "organization-admin",
        mode: "fresh",
        sameOrganization: true,
        freshDetail: "roster changes require fresh evidence",
    },
    "retire-administrator": {
        coordinator: "organization",
        operationBound: false,
        standing: "organization-admin",
        mode: "fresh",
        sameOrganization: true,
        freshDetail: "roster changes require fresh evidence",
        also: ["organization-admin"],
    },
};
/** A lookup that accepts a string because a service binding can deliver a
 * structurally unknown command; an absent table row fails closed. */
export const commandPolicy = (kind) => COMMAND_POLICY[kind];
