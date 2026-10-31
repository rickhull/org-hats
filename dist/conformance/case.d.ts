import type { ConformanceWorld } from "./world.js";
export interface ConformanceCase {
    readonly id: string;
    readonly title: string;
    readonly run: (world: ConformanceWorld) => Promise<void>;
}
export declare const modelCase: (id: string, title: string, run: () => void) => ConformanceCase;
export declare const runtimeCase: (id: string, title: string, run: (world: ConformanceWorld) => Promise<void>) => ConformanceCase;
