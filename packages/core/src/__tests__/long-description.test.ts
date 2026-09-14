import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { reviseAltText } from '../review-alt.js';

describe('reviewed complex image descriptions', () => {
  it('adds escaped visible detail and preserves original bytes and existing descriptions', () => {
    const original = `<p class='unchanged'>Before <a href='/image'><img src="table.png" alt="old" aria-describedby="caption"></a> after</p>`;
    const result = reviseAltText(original, [{src:'table.png', text:'Composition table', longDescription:'Oxygen: 47%\n<script>unsafe</script> & "quoted"'}], ['table.png']);
    const doc = new JSDOM(result).window.document;
    expect(doc.querySelector('script')).toBeNull();
    const block = doc.querySelector('[data-remedy-image-description]')!;
    expect(block.textContent).toBe('Oxygen: 47%\n<script>unsafe</script> & "quoted"');
    expect(block.closest('a')).toBeNull();
    expect(doc.querySelector('img')!.getAttribute('aria-describedby')).toBe(`caption ${block.id}`);
    expect(result.startsWith(`<p class='unchanged'>Before <a href='/image'>`)).toBe(true);
    expect(result.endsWith(' after</p>')).toBe(true);
  });
  it('updates and removes only the generated block without duplicates', () => {
    const original = '<p><img src="a" alt="old" aria-describedby="caption"></p>';
    const first = reviseAltText(original,[{src:'a',text:'Short',longDescription:'First'}],['a']);
    const second = reviseAltText(first,[{src:'a',text:'Short',longDescription:'Second'}],['a']);
    expect(new JSDOM(second).window.document.querySelectorAll('[data-remedy-image-description]')).toHaveLength(1);
    expect(second).not.toContain('First');
    const removed = reviseAltText(second,[{src:'a',text:'Short',longDescription:''}],['a']);
    expect(removed).toBe(original.replace('alt="old"','alt="Short"'));
  });
  it('preserves detail when only alt is edited and rejects oversized or duplicate input', () => {
    const html = reviseAltText('<img src="a" alt="old">',[{src:'a',text:'Short',longDescription:'Keep'}],['a']);
    expect(reviseAltText(html,[{src:'a',text:'New'}],['a'])).toContain('Keep');
    expect(()=>reviseAltText(html,[{src:'a',text:'New',longDescription:'x'.repeat(12001)}],['a'])).toThrow();
    expect(()=>reviseAltText(html,[{src:'a',text:'New'},{src:'a',text:'Again'}],['a'])).toThrow();
  });
});

it('offers already-described unique images for manual complex-image review', async () => {
  const { reviewableImages } = await import('../review-alt.js');
  const result = reviewableImages('<img src="table" alt="Valid short alt"><img src="repeated"><img src="repeated">');
  expect(result.map(i => i.data.src)).toEqual(['table']);
});
