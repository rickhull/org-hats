export type CommandCoordinator = "organization" | "operation" | "by-participation";
export type CommandStanding = "none" | "operation-admin" | "organization-admin" | "operation-admin-or-owner" | "operation-admin-or-org-owner" | "by-participation";
export type CommandMode = "either" | "fresh" | "ignored";
export interface CommandPolicy {
    readonly coordinator: CommandCoordinator;
    readonly operationBound: boolean;
    readonly standing: CommandStanding;
    readonly mode: CommandMode;
    /** A fresh-only command may require the resolved organization to equal the
     * command's organization; the runtime checks this before the handler. */
    readonly sameOrganization?: boolean;
    /** The exact denial for an envelope presented to a fresh-only command. */
    readonly freshDetail?: string;
    /** Additional standing the handler legitimately re-checks beyond this row
     * (retire-administrator's successor rule). */
    readonly also?: readonly string[];
}
export declare const COMMAND_POLICY: {
    "request-access": {
        coordinator: "operation";
        operationBound: true;
        standing: "none";
        mode: "ignored";
    };
    "participation-invite": {
        coordinator: "operation";
        operationBound: true;
        standing: "operation-admin";
        mode: "either";
    };
    "participation-accept": {
        coordinator: "organization";
        operationBound: true;
        standing: "organization-admin";
        mode: "either";
    };
    "participation-revoke": {
        coordinator: "by-participation";
        operationBound: true;
        standing: "by-participation";
        mode: "either";
    };
    admit: {
        coordinator: "operation";
        operationBound: true;
        standing: "operation-admin";
        mode: "either";
    };
    "grant-hat": {
        coordinator: "operation";
        operationBound: true;
        standing: "operation-admin";
        mode: "either";
    };
    "revoke-grant": {
        coordinator: "operation";
        operationBound: true;
        standing: "operation-admin";
        mode: "either";
    };
    "select-hat": {
        coordinator: "operation";
        operationBound: true;
        standing: "operation-admin-or-owner";
        mode: "either";
    };
    "request-team": {
        coordinator: "operation";
        operationBound: true;
        standing: "organization-admin";
        mode: "fresh";
        sameOrganization: true;
        freshDetail: string;
    };
    "admit-team": {
        coordinator: "operation";
        operationBound: true;
        standing: "operation-admin";
        mode: "either";
    };
    "update-team": {
        coordinator: "operation";
        operationBound: true;
        standing: "organization-admin";
        mode: "fresh";
        sameOrganization: true;
        freshDetail: string;
    };
    "retire-team": {
        coordinator: "operation";
        operationBound: true;
        standing: "operation-admin-or-org-owner";
        mode: "either";
    };
    "disable-actor": {
        coordinator: "organization";
        operationBound: false;
        standing: "organization-admin";
        mode: "either";
    };
    "unlink-principal": {
        coordinator: "organization";
        operationBound: false;
        standing: "organization-admin";
        mode: "fresh";
        sameOrganization: true;
        freshDetail: string;
    };
    "revoke-activation": {
        coordinator: "organization";
        operationBound: false;
        standing: "organization-admin";
        mode: "fresh";
        sameOrganization: true;
        freshDetail: string;
    };
    "create-actor": {
        coordinator: "organization";
        operationBound: false;
        standing: "organization-admin";
        mode: "fresh";
        sameOrganization: true;
        freshDetail: string;
    };
    "update-actor": {
        coordinator: "organization";
        operationBound: false;
        standing: "organization-admin";
        mode: "fresh";
        sameOrganization: true;
        freshDetail: string;
    };
    "appoint-administrator": {
        coordinator: "organization";
        operationBound: false;
        standing: "organization-admin";
        mode: "fresh";
        sameOrganization: true;
        freshDetail: string;
    };
    "retire-administrator": {
        coordinator: "organization";
        operationBound: false;
        standing: "organization-admin";
        mode: "fresh";
        sameOrganization: true;
        freshDetail: string;
        also: string[];
    };
};
/** A lookup that accepts a string because a service binding can deliver a
 * structurally unknown command; an absent table row fails closed. */
export declare const commandPolicy: (kind: string) => CommandPolicy | undefined;
