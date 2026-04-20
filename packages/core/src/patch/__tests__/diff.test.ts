import { describe, it, expect } from 'vitest';
import { parseWithLocations } from '../locate.js';
import { parseFragment } from 'parse5';
import { diffTrees } from '../diff.js';

describe('diffTrees', () => {
  it('emits no splices when trees are identical', () => {
    const src = '<p id="x">hi</p>';
    const orig = parseWithLocations(src);
    const mut = parseFragment(src);
    expect(diffTrees(orig, mut, src)).toEqual([]);
  });

  it('emits one splice for a changed attribute value', () => {
    const src = '<img src="a.jpg" alt="">';
    const orig = parseWithLocations(src);
    const mut = parseFragment('<img src="a.jpg" alt="A cat">');
    const sp = diffTrees(orig, mut, src);
    expect(sp).toHaveLength(1);
    expect(sp[0]).toMatchObject({ kind: 'attr-change' });
    const patched = src.slice(0, sp[0]!.start) + sp[0]!.replacement + src.slice(sp[0]!.end);
    expect(patched).toBe('<img src="a.jpg" alt="A cat">');
  });

  it('emits one splice inserting a new attribute', () => {
    const src = '<img src="a.jpg">';
    const orig = parseWithLocations(src);
    const mut = parseFragment('<img src="a.jpg" alt="A cat">');
    const sp = diffTrees(orig, mut, src);
    expect(sp).toHaveLength(1);
    expect(sp[0]).toMatchObject({ kind: 'attr-insert' });
    const patched = src.slice(0, sp[0]!.start) + sp[0]!.replacement + src.slice(sp[0]!.end);
    expect(patched).toBe('<img src="a.jpg" alt="A cat">');
  });

  it('emits one splice removing an attribute', () => {
    const src = '<h2 id="foo">Title</h2>';
    const orig = parseWithLocations(src);
    const mut = parseFragment('<h2>Title</h2>');
    const sp = diffTrees(orig, mut, src);
    expect(sp).toHaveLength(1);
    expect(sp[0]).toMatchObject({ kind: 'attr-unset' });
    const patched = src.slice(0, sp[0]!.start) + sp[0]!.replacement + src.slice(sp[0]!.end);
    expect(patched).toBe('<h2>Title</h2>');
  });

  it('emits one splice replacing text content', () => {
    const src = '<h2>Section 1</h2>';
    const orig = parseWithLocations(src);
    const mut = parseFragment('<h2>Introduction</h2>');
    const sp = diffTrees(orig, mut, src);
    expect(sp).toHaveLength(1);
    expect(sp[0]).toMatchObject({ kind: 'text-replace' });
    const patched = src.slice(0, sp[0]!.start) + sp[0]!.replacement + src.slice(sp[0]!.end);
    expect(patched).toBe('<h2>Introduction</h2>');
  });

  it('emits two splices replacing an element tag with preserved attrs + children', () => {
    const src = '<h1 id="a">T</h1>';
    const orig = parseWithLocations(src);
    const mut = parseFragment('<h2 id="a">T</h2>');
    const sp = diffTrees(orig, mut, src);
    expect(sp).toHaveLength(2);
    expect(sp.map((s) => s.kind).sort()).toEqual(['end-tag-replace', 'start-tag-replace']);
    const sorted = [...sp].sort((a, b) => b.start - a.start);
    let patched = src;
    for (const s of sorted) {
      patched = patched.slice(0, s.start) + s.replacement + patched.slice(s.end);
    }
    expect(patched).toBe('<h2 id="a">T</h2>');
  });

  it('throws UnsupportedMutationError when a child is added', () => {
    const src = '<div><p>a</p></div>';
    const orig = parseWithLocations(src);
    const mut = parseFragment('<div><p>a</p><p>b</p></div>');
    expect(() => diffTrees(orig, mut, src)).toThrow(/Child count differs/);
  });

  it('throws UnsupportedMutationError when a tag replacement changes attrs', () => {
    const src = '<h1 id="a">T</h1>';
    const orig = parseWithLocations(src);
    const mut = parseFragment('<h2 id="b">T</h2>');
    expect(() => diffTrees(orig, mut, src)).toThrow(/attr mismatch/);
  });
});
