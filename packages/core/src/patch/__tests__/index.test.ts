import { describe, it, expect } from 'vitest';
import { bytePreservePatch } from '../index.js';

describe('bytePreservePatch', () => {
  it('returns byte-preserved result on in-scope mutation', () => {
    const orig = '<p>Before</p>  <img src="a.jpg">\n<p>After</p>';
    const mut  = '<p>Before</p>  <img src="a.jpg" alt="cat">\n<p>After</p>';
    const r = bytePreservePatch(orig, mut);
    expect(r.ok).toBe(true);
    expect(r.bytes).toBe(orig.replace('<img src="a.jpg">', '<img src="a.jpg" alt="cat">'));
    expect(r.splices).toHaveLength(1);
  });

  it('falls back to full rewrite on unsupported mutation', () => {
    const orig = '<div><p>a</p></div>';
    const mut  = '<div><p>a</p><p>b</p></div>';
    const r = bytePreservePatch(orig, mut);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unsupported-mutation');
    expect(r.bytes).toBeUndefined();
  });

  it('passes through the identity case cleanly (no splices, bytes unchanged)', () => {
    const orig = '<p>a</p>';
    const mut  = '<p>a</p>';
    const r = bytePreservePatch(orig, mut);
    expect(r.ok).toBe(true);
    expect(r.splices).toHaveLength(0);
    expect(r.bytes).toBe(orig);
  });
});
