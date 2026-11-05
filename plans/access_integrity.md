# Access integrity — close the review findings

## Goal and scope

Close the key-set compatibility witness gap from the access and envelope
review. The parser behavior already holds; the remaining work is evidence.

## Lower priority — witness key-set forward compatibility

**Work:** Add a public-boundary case in `tests/keyset.test.ts` with unknown
top-level and per-key fields, as promised by
[E5](../specs/envelope.md#e5--the-key-set-is-the-rotation-unit).

**Done when:** loading that key set still verifies the committed signed
vector. This is a coverage improvement; the current parser already complies.

**Closing evidence:** temporarily make the parser reject the added fields,
show the test fails, restore the parser, and confirm the only remaining
change is the intended test.

## Verification and retirement

Run `node --test tests/keyset.test.ts` with and without the temporary strict
field checks, restore the parser byte-for-byte, then run `pnpm check`.
Run `pnpm verify` at integration. Do not overlap its build with `pnpm check`.

Remove this file and its index entry when the witness lands; E5 is the durable
contract.
