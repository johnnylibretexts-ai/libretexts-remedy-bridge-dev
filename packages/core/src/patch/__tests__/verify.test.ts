import { describe, it, expect } from 'vitest';
import { parseFragment } from 'parse5';
import { structurallyEquivalent } from '../verify.js';

describe('structurallyEquivalent', () => {
  it('returns ok for identical trees', () => {
    const a = parseFragment('<p id="x">hi</p>');
    const b = parseFragment('<p id="x">hi</p>');
    const r = structurallyEquivalent(a, b);
    expect(r.ok).toBe(true);
  });

  it('treats attribute order as insignificant', () => {
    const a = parseFragment('<img src="x" alt="y">');
    const b = parseFragment('<img alt="y" src="x">');
    expect(structurallyEquivalent(a, b).ok).toBe(true);
  });

  it('returns not-ok when text differs', () => {
    const a = parseFragment('<p>one</p>');
    const b = parseFragment('<p>two</p>');
    const r = structurallyEquivalent(a, b);
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/text/i);
  });

  it('returns not-ok when tag differs', () => {
    const a = parseFragment('<h2>t</h2>');
    const b = parseFragment('<h3>t</h3>');
    expect(structurallyEquivalent(a, b).ok).toBe(false);
  });
});
