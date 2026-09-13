import { expect, it } from 'vitest';
import { reviseAltText } from '../review-alt.js';
it('reviewer edits escape text and preserve unrelated markup', () => {
  const html = '<p class="x">  Text </p><img src="diagram.gif" alt="old" />';
  const next = reviseAltText(html, [{ src: 'diagram.gif', text: 'Beads delay small molecules; large molecules exit first.' }], ['diagram.gif']);
  expect(next).toBe(html.replace('alt="old"', 'alt="Beads delay small molecules; large molecules exit first."'));
  expect(reviseAltText(html, [{ src: 'diagram.gif', text: '\" onclick=\"bad' }], ['diagram.gif'])).toContain('alt="&quot; onclick=&quot;bad"');
});
it('reviewer edits reject unrelated images, ambiguous images and overlong descriptions', () => {
  const html = '<img src="a" alt="old">';
  expect(() => reviseAltText(html, [{ src: 'a', text: 'x' }], ['b'])).toThrow();
  expect(() => reviseAltText(html + html, [{ src: 'a', text: 'x' }], ['a'])).toThrow(/uniquely/);
  expect(() => reviseAltText(html, [{ src: 'a', text: 'x'.repeat(151) }], ['a'])).toThrow();
});
