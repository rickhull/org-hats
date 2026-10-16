// Shared assertion helpers for the walkthroughs — one copy, not four.
//
// The examples are the test suite (C36), so the helpers they share live here
// rather than being pasted into each. Not a skill or a fixture; just the three
// predicates every walkthrough reuses.

export function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

export function refuses(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

export function same(a: readonly string[], b: readonly string[]): boolean {
  return [...a].sort().join() === [...b].sort().join();
}
