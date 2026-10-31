// Adapter-boundary validators. The portable authority module has equivalent
// checks for its own commands, but it does not publish them: the Cloudflare
// coordinators keep the address rules local to the storage commands they
// guard. The limits are deliberately the same (128-character ids, 200-
// character display names, trimmed emptiness); the roster and team suites pin
// the behavior on both sides.
//
// See docs/cloudflare.md § Adapter-local validators for the decision.

import type { Failure } from "org-hats/authority";

/** An opaque actor or team id: non-empty after trimming, at most 128
 * characters. */
export const identifierFailure = (value: string, label: string): Failure | undefined => {
  if (value.trim().length === 0) return { kind: "invalid-command", detail: `${label} is empty` };
  if (value.length > 128) return { kind: "invalid-command", detail: `${label} is too long` };
  return undefined;
};

/** A display name: `null` clears it; a string must be non-empty after
 * trimming and at most 200 characters. */
export const displayNameFailure = (
  value: string | null | undefined,
  label = "display name",
): Failure | undefined => {
  if (value === undefined || value === null) return undefined;
  if (value.trim().length === 0) return { kind: "invalid-command", detail: `${label} is empty` };
  if (value.length > 200) return { kind: "invalid-command", detail: `${label} is too long` };
  return undefined;
};
