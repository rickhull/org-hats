import type { WorldFixture } from "./world.js";
/** A fixture with a reserved twin name. The shape is `WorldFixture`; the
 * name union is what makes a twin recognisable as public conformance data
 * rather than a host's own world. */
export interface TwinFixture extends WorldFixture {
    readonly name: "professional" | "festival" | "airlift" | "invitee";
}
/** The professional operation's id — the twin's own constant, so consumers
 * (the conformance inventory) import it rather than re-declaring the
 * literal. The festival's op id stays local to its consumers; `FESTIVAL`
 * already names the twin itself. */
export declare const MERIDIAN: import("../contract.js").OperationId;
/** The organization that also joins the festival, and the actor who works
 * both — the cross-operation pair the conformance scenarios exercise. */
export declare const HARBOR_LOGISTICS: import("../contract.js").OrganizationId;
export declare const DANA_OKAFOR: import("../contract.js").ActorId;
export declare const PROFESSIONAL_OPERATION: TwinFixture;
export declare const FESTIVAL_BOOTH_COUNT = 150;
export declare const FESTIVAL: TwinFixture;
export declare const AIRLIFT: TwinFixture;
export declare const TWINS: readonly TwinFixture[];
