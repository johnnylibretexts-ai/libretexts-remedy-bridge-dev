import type { Splice } from './types.js';

/**
 * Apply splices right-to-left so earlier offsets remain valid as we rewrite.
 * Throws if any two splices overlap (a differ bug; indicates ambiguity).
 */
export function applySplices(source: string, splices: Splice[]): string {
  if (splices.length === 0) return source;
  const sorted = [...splices].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.start < sorted[i - 1]!.end) {
      throw new Error(
        `Splices overlap: [${sorted[i - 1]!.start},${sorted[i - 1]!.end}) and [${sorted[i]!.start},${sorted[i]!.end})`,
      );
    }
  }
  let out = source;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const s = sorted[i]!;
    out = out.slice(0, s.start) + s.replacement + out.slice(s.end);
  }
  return out;
}
