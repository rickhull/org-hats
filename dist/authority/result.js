// The result vocabulary the command coordinators share.
//
// Two surfaces, two discriminants, deliberately (docs/types.md):
// - `failed` wraps a `Failure` for the session surface, where a failure is
//   identified by presence (`isFailed`);
// - `fail` builds a command failure, where `{ ok: false }` is the
//   discriminant;
// - `ok` builds a successful command receipt.
//
// Naming each one for what it returns is the whole pass: `failed` is a
// session result, not a misspelled command failure.
export const failed = (failure) => ({ failure });
export const fail = (kind, detail) => ({
    ok: false,
    failure: { kind, ...(detail !== undefined ? { detail } : {}) },
});
export const ok = (idempotencyKey, applied) => ({
    ok: true,
    receipt: { idempotencyKey, applied },
});
