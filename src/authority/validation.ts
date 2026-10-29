// Shared shape checks for caller-supplied addresses and names. These are
// address and presentation rules, not identity: an id is opaque, a display
// name is never compared, and no format beyond emptiness and length is
// parsed. The Cloudflare adapter keeps its own copies at the adapter
// boundary; the portable coordinators share these.

import type { Failure } from "../contract.ts";

/** An opaque id (actor or team): non-empty, at most 128 characters. */
export const identifierFailure = (value: string, label: string): Failure | undefined => {
  if (value.trim().length === 0) return { kind: "invalid-command", detail: `${label} is empty` };
  if (value.length > 128) return { kind: "invalid-command", detail: `${label} is too long` };
  return undefined;
};

/** A display name: `null` clears it; a string must be non-empty and at most
 * 200 characters. */
export const displayNameFailure = (value: string | null, label = "display name"): Failure | undefined => {
  if (value === null) return undefined;
  if (value.trim().length === 0) return { kind: "invalid-command", detail: `${label} is empty` };
  if (value.length > 200) return { kind: "invalid-command", detail: `${label} is too long` };
  return undefined;
};
