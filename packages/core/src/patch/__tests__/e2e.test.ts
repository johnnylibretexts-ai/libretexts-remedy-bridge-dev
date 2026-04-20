import { describe, it, expect } from 'vitest';
import { bytePreservePatch } from '../index.js';

describe('bytePreservePatch — Chap_01 shape', () => {
  it('preserves bytes when only the flowchart alt-text changes', () => {
    const original = [
      '<h2>THE SCIENTIFIC METHOD</h2>',
      '<ul>',
      '<li>The scientific method is a process of creative thinking and testing',
      'aimed at objective and verifiable discoveries. It is generally composed of',
      'the following steps:<br>',
      '<figure style="text-align: center"><img src="https://cdn.mathpix.com/cropped/21e25a6e-bba9-47c2-9471-a8cb05498468-2.jpg?height=1629&amp;width=1483&amp;top_left_y=541&amp;top_left_x=511" alt="" data-align="center"></figure></li>',
      '</ul>',
    ].join('\n');

    const mutated = original.replace(
      'alt=""',
      'alt="Flowchart showing scientific method: Observation → Hypothesis → Experiment → Conclusion"',
    );

    const r = bytePreservePatch(original, mutated);
    expect(r.ok).toBe(true);
    expect(r.splices).toHaveLength(1);
    expect(r.splices[0]!.kind).toBe('attr-change');
    expect(r.bytes).toBe(mutated);
    const cutAt = r.splices[0]!.start;
    expect(r.bytes!.slice(0, cutAt)).toBe(original.slice(0, cutAt));
  });

  it('falls back cleanly when the mutation wraps an element (image-planner-style)', () => {
    const original = '<p>hi</p><img src="a.jpg"><p>bye</p>';
    const mutated = '<p>hi</p><figure><img src="a.jpg"></figure><p>bye</p>';
    const r = bytePreservePatch(original, mutated);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unsupported-mutation');
  });
});
