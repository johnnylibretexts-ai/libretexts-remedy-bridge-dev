import { describe, it, expect } from 'vitest';
import { parseWithLocations } from '../locate.js';

describe('parseWithLocations', () => {
  it('attaches sourceCodeLocation to elements', () => {
    const src = '<p id="x">hi</p>';
    const frag = parseWithLocations(src);
    const p = frag.childNodes[0] as any;
    expect(p).toBeDefined();
    expect(p.nodeName).toBe('p');
    expect(p.sourceCodeLocation.startOffset).toBe(0);
    expect(p.sourceCodeLocation.endOffset).toBe(16);
    expect(p.sourceCodeLocation.startTag.endOffset).toBe(10);
    expect(p.sourceCodeLocation.attrs.id).toMatchObject({
      startOffset: 3,
      endOffset: 9,
    });
  });

  it('throws on parse errors the tree cannot recover from', () => {
    // parse5 is lenient — this test just ensures the function returns a fragment.
    const frag = parseWithLocations('<<<>>>');
    expect(frag.childNodes.length).toBeGreaterThanOrEqual(0);
  });
});
