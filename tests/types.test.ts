// Compile-only assertions over the public surface. The type aliases below
// are checked by `tsconfig.tests.json` (run in `bin/check`); the single
// runtime test exists only so `node --test tests/*.test.ts` has something
// to run in this file. A failure here is a compiler error, not a red test.
//
// What this guards — from the outside, the way a host sees it: the ids stay
// plain strings, the closed unions stay closed and un-widened, the version
// literals stay literal, and the claims' interface field stays provenance
// while every call still speaks the current interface. The `AssertPlainId`
// blocks inside `src/` assert the same ids from the inside;
// tests/consumer-surface.ts asserts them against the built `dist/`.

import test from "node:test";

import type {
  AccessEnvelopeClaimsV1,
  AuthorityInterfaceVersion,
  EpochSeconds,
  Failure,
  FailureKind,
  GrantTarget,
  IssuerInterfaceVersion,
  SignedAccessEnvelope,
  TargetRef,
  Unbranded,
} from "../src/contract.ts";
import type { NeutralAccess } from "../src/access/types.ts";
import type { VerifyContext } from "../src/access/verify.ts";
import { wearableGrants, type ActiveGrant, type Grant } from "../src/model.ts";
import type {
  AccessFromEvidenceInput,
  AuthorityCommand,
  CommandResult,
  HatSummary,
} from "../src/authority/types.ts";

// The exactness check: assignability would let `number` pass where the
// literal is required, and a literal pass where `number` is required.
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false;
type Expect<T extends true> = T;

// --- ids stay plain strings ---------------------------------------------------

type _ClaimsOperationIdIsPlain = Expect<Equal<AccessEnvelopeClaimsV1["operationId"], string>>;
type _TargetRefTeamIdIsPlain = Expect<Equal<Extract<TargetRef, { kind: "team" }>["teamId"], string>>;
type _TargetRefSiteIdIsPlain = Expect<Equal<Extract<TargetRef, { kind: "site" }>["siteId"], string>>;
type _HatSummaryTeamTargetIsPlain = Expect<
  Equal<Extract<HatSummary["target"], { kind: "team" }>["teamId"], string>
>;
type _HatSummarySiteTargetIsPlain = Expect<
  Equal<Extract<HatSummary["target"], { kind: "site" }>["siteId"], string>
>;
type _NeutralAccessOperationIdIsPlain = Expect<Equal<NeutralAccess["operationId"], string>>;

// --- the closed unions stay closed ----------------------------------------------

type _GrantTargetIsTwoArm = Expect<Equal<GrantTarget["kind"], "team" | "site">>;
type _TargetRefIsThreeArm = Expect<
  Equal<TargetRef["kind"], "operation" | "site" | "team">
>;

type FailureKinds =
  | "unavailable"
  | "unauthenticated"
  | "not-admitted"
  | "expired"
  | "wrong-interface-version"
  | "wrong-binding"
  | "invalid-signature"
  | "invalid-command"
  | "denied";
// The list above is written out on purpose: adding a kind is an
// interface-version change, and this file, the taxonomy comment in
// src/contract.ts, and the consumer's product-response map must all be
// touched with it.
type _FailureKindIsClosed = Expect<Equal<FailureKind, FailureKinds>>;
type _FailureCarriesTheKind = Expect<Equal<Failure["kind"], FailureKind>>;

// --- the version literals stay literal ------------------------------------------

type _EnvelopeFormatIsLiteral = Expect<Equal<SignedAccessEnvelope["format"], "org-hats.access">>;
type _EnvelopeVersionIsLiteral = Expect<Equal<SignedAccessEnvelope["v"], 1>>;
type _ClaimsVersionIsLiteral = Expect<Equal<AccessEnvelopeClaimsV1["v"], 1>>;

// --- provenance stays provenance -------------------------------------------------

// The claims record which interface issued them; historical values are
// representable, so the field is `IssuerInterfaceVersion`, not the literal.
type _ClaimsInterfaceIsProvenance = Expect<
  Equal<AccessEnvelopeClaimsV1["interfaceVersion"], IssuerInterfaceVersion>
>;
// Every call still speaks the current interface literal — widening the
// claims field must not widen the call surface with it.
type _AccessCallsSpeakCurrent = Expect<
  Equal<AccessFromEvidenceInput["interfaceVersion"], AuthorityInterfaceVersion>
>;
type _CommandsSpeakCurrent = Expect<
  Equal<AuthorityCommand["interfaceVersion"], AuthorityInterfaceVersion>
>;

// --- the command result keeps its `ok` discriminant --------------------------------
//
// Session and command results stay asymmetric by design
// (docs/types.md): sessions narrow by property presence
// (`isFailed`), commands by `ok`.

type _CommandFailureIsOkDiscriminated = Expect<
  Equal<Extract<CommandResult, { ok: false }>["failure"], Failure>
>;

// --- the revocation filter lives in the type ---------------------------------------
//
// `wearableGrants` has run `isActiveGrant`; a grant carrying `revoked:
// true` cannot enter the decision path, and the refinement never widens
// back to `Grant` on the way out.

type _ActiveGrantRevokedIsNeverTrue = Expect<Equal<ActiveGrant["revoked"], false | undefined>>;
type _ActiveGrantIsAGrant = Expect<Equal<ActiveGrant extends Grant ? true : false, true>>;
type _RevokedGrantIsNotActive = Expect<
  Equal<(Grant & { revoked: true }) extends ActiveGrant ? true : false, false>
>;
type _WearableGrantsYieldActive = Expect<
  Equal<ReturnType<typeof wearableGrants>[number], ActiveGrant>
>;

// --- the numeric time brand stays internal ------------------------------------------
//
// `EpochSeconds` brands instants on the clock seam; `Unbranded` maps it
// back to `number`, so public inputs like `VerifyContext.now` stay plain
// and a host never imports an epoch constructor.

type _UnbrandedEpochIsPlain = Expect<Equal<Unbranded<EpochSeconds>, number>>;
type _VerifyNowStaysPlain = Expect<Equal<NonNullable<VerifyContext["now"]>, number>>;
type _ClaimsIatStaysPlain = Expect<Equal<AccessEnvelopeClaimsV1["iat"], number>>;

test("public-surface type assertions are compile-time only", () => {
  // The assertions are the type aliases above; they fail `tsc -p
  // tsconfig.tests.json` in bin/check. This test exists so the runtime
  // suite has something green to run in this file.
});
