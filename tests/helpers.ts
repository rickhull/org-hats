// Shared helpers for the generative suites: the deterministic mulberry32
// PRNG and a pick over its stream. Same seed, same world, in every suite.

export const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const pick = <T>(rng: () => number, values: readonly T[]): T =>
  values[Math.floor(rng() * values.length)] as T;
