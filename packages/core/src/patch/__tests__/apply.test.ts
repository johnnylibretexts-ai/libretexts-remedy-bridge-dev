import { describe, it, expect } from 'vitest';
import { applySplices } from '../apply.js';
import type { Splice } from '../types.js';

describe('applySplices', () => {
  it('applies a single splice', () => {
    const src = 'hello world';
    const sp: Splice[] = [{ kind: 'text-replace', start: 6, end: 11, replacement: 'there' }];
    expect(applySplices(src, sp)).toBe('hello there');
  });

  it('applies multiple splices right-to-left', () => {
    const src = 'aaa BBB ccc';
    const sp: Splice[] = [
      { kind: 'text-replace', start: 0, end: 3, replacement: 'AAA' },
      { kind: 'text-replace', start: 8, end: 11, replacement: 'CCC' },
    ];
    expect(applySplices(src, sp)).toBe('AAA BBB CCC');
  });

  it('throws when splices overlap', () => {
    const src = 'abcdef';
    const sp: Splice[] = [
      { kind: 'text-replace', start: 1, end: 4, replacement: 'X' },
      { kind: 'text-replace', start: 3, end: 5, replacement: 'Y' },
    ];
    expect(() => applySplices(src, sp)).toThrow(/overlap/i);
  });
});
