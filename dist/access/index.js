// The verification-only consumer module.
//
// Charter (docs/authority_redesign.md § Access): it accepts a signed,
// versioned authority projection and exposes neutral authority facts —
// operation and site binding, the selected hat's actions over a neutral
// target, readable organization and team ids, configuration reach. It never
// names a product entity; product verbs are host code. Unsupported versions
// fail closed.
//
// M0 fence placeholder; the verifier and its fixed vectors land in M4
// (plans/v1.md).
export {};
