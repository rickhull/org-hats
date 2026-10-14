import { DatabaseSync } from "node:sqlite";
export type SqlValue = string | number | bigint | null;
export declare class Db {
    readonly db: DatabaseSync;
    constructor(path: string);
    exec(sql: string): void;
    all<T>(sql: string, ...params: SqlValue[]): T[];
    get<T>(sql: string, ...params: SqlValue[]): T | undefined;
    run(sql: string, ...params: SqlValue[]): void;
    close(): void;
    plan(sql: string): string;
}
