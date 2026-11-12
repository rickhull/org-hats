// A minimal CBOR decoder for the WebAuthn wire format (RFC 8949), built as
// an untrusted-input boundary: depth- and item-bounded, every construct this
// decoder does not implement is refused rather than skipped, and every
// refusal is a value. The parser that consumes this never sees an exception.
//
// Implemented majors: 0 (unsigned), 1 (negative), 2 (byte string),
// 3 (text string), 4 (array), 5 (map). Refused: 6 (tags), 7 (simple and
// float values), indefinite lengths, and reserved additional-info values.
// WebAuthn emits exactly the implemented subset; anything else on the wire
// is not a construct we promised to read.
//
// No crypto lives here. Signature verification stays in crypto.subtle.

export type CborValue =
  | number
  | Uint8Array
  | string
  | readonly CborValue[]
  | ReadonlyMap<CborValue, CborValue>;

export interface CborItem {
  readonly value: CborValue;
  /** Bytes after the decoded item — a caller expecting one object refuses
   * a non-empty rest rather than ignoring it. */
  readonly rest: Uint8Array;
}

export type CborResult =
  | { readonly ok: true; readonly item: CborItem }
  | { readonly ok: false; readonly reason: string };

const MAX_DEPTH = 8;
const MAX_ITEMS = 1_024;

interface Cursor {
  readonly bytes: Uint8Array;
  pos: number;
}

const fail = (reason: string): CborResult => ({ ok: false, reason });

/** Read one length argument per RFC 8949 §3: additional info below 24 is
 * the value itself; 24–27 are one, two, four, and eight byte arguments.
 * 28–30 are reserved and 31 is indefinite — both refused. */
const readLength = (cursor: Cursor, info: number): { value: number } | { reason: string } => {
  if (info < 24) return { value: info };
  const width = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
  if (width === 0) return { reason: info === 31 ? "indefinite lengths are not supported" : "reserved additional-info value" };
  if (cursor.pos + width > cursor.bytes.length) return { reason: "truncated length argument" };
  let value = 0;
  for (let index = 0; index < width; index += 1) {
    value = value * 0x100 + (cursor.bytes[cursor.pos + index] ?? 0);
  }
  cursor.pos += width;
  if (!Number.isSafeInteger(value)) return { reason: "length argument exceeds the integer range" };
  return { value };
};

const decodeItem = (cursor: Cursor, depth: number): CborResult => {
  if (depth > MAX_DEPTH) return fail("nesting deeper than the bound");
  if (cursor.pos >= cursor.bytes.length) return fail("truncated input");
  const initial = cursor.bytes[cursor.pos] ?? 0;
  cursor.pos += 1;
  const major = initial >>> 5;
  const info = initial & 0x1f;

  if (major === 0 || major === 1) {
    const length = readLength(cursor, info);
    if ("reason" in length) return fail(length.reason);
    const value = major === 0 ? length.value : -length.value - 1;
    return { ok: true, item: { value, rest: cursor.bytes.subarray(cursor.pos) } };
  }
  if (major === 2 || major === 3) {
    const length = readLength(cursor, info);
    if ("reason" in length) return fail(length.reason);
    if (cursor.pos + length.value > cursor.bytes.length) return fail("truncated string");
    const slice = cursor.bytes.subarray(cursor.pos, cursor.pos + length.value);
    cursor.pos += length.value;
    const value: CborValue = major === 2 ? slice : new TextDecoder().decode(slice);
    return { ok: true, item: { value, rest: cursor.bytes.subarray(cursor.pos) } };
  }
  if (major === 4 || major === 5) {
    const count = readLength(cursor, info);
    if ("reason" in count) return fail(count.reason);
    if (count.value > MAX_ITEMS) return fail("more items than the bound allows");
    const items: CborValue[] = [];
    const entries: [CborValue, CborValue][] = [];
    for (let index = 0; index < count.value; index += 1) {
      const headItem = decodeItem(cursor, depth + 1);
      if (!headItem.ok) return headItem;
      if (major === 4) {
        items.push(headItem.item.value);
        cursor.pos = cursor.bytes.length - headItem.item.rest.length;
      } else {
        const keyValue = headItem.item.value;
        const value = decodeItem({ bytes: cursor.bytes, pos: cursor.bytes.length - headItem.item.rest.length }, depth + 1);
        if (!value.ok) return value;
        entries.push([keyValue, value.item.value]);
        cursor.pos = cursor.bytes.length - value.item.rest.length;
      }
    }
    const value: CborValue = major === 4 ? items : new Map(entries);
    return { ok: true, item: { value, rest: cursor.bytes.subarray(cursor.pos) } };
  }
  return fail(major === 6 ? "tags are not supported" : "simple and float values are not supported");
};

/** Decode the first CBOR item. The rest is the caller's to refuse. */
export const decodeCbor = (bytes: Uint8Array): CborResult =>
  decodeItem({ bytes, pos: 0 }, 0);
