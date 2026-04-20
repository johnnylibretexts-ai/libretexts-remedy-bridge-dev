import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { decorativeMark } from '../decorative-mark.js';

function makeImg(html: string): { img: HTMLImageElement; doc: Document } {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  const doc = dom.window.document;
  const img = doc.querySelector('img') as unknown as HTMLImageElement;
  return { img, doc };
}

describe('decorativeMark', () => {
  it('sets alt="" and role="presentation" on an img with existing alt', async () => {
    const { img, doc } = makeImg('<img src="s.png" alt="old alt">');
    const r = await decorativeMark(img, { doc, absoluteSrc: 'https://e.com/s.png' });
    expect(r.ok).toBe(true);
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('role')).toBe('presentation');
  });

  it('leaves non-alt/role attributes alone', async () => {
    const { img, doc } = makeImg('<img src="s.png" width="10" data-x="y">');
    await decorativeMark(img, { doc, absoluteSrc: 'https://e.com/s.png' });
    expect(img.getAttribute('src')).toBe('s.png');
    expect(img.getAttribute('width')).toBe('10');
    expect(img.getAttribute('data-x')).toBe('y');
  });

  it('makes no LLM call', async () => {
    const { img, doc } = makeImg('<img src="s.png">');
    const r = await decorativeMark(img, { doc, absoluteSrc: 'https://e.com/s.png' });
    expect(r.llmCall).toBeFalsy();
  });
});
