import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { altTextVision } from '../alt-text-vision.js';

const DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX///+nxBvIAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

function makeImg(html: string): { img: HTMLImageElement; doc: Document } {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  const doc = dom.window.document;
  const img = doc.querySelector('img') as unknown as HTMLImageElement;
  return { img, doc };
}

/** Stub that records which methods were called and returns canned responses. */
function stubLlm(opts: { visionReturn?: string; visionThrows?: boolean; chatReturn?: string; chatThrows?: boolean }) {
  let visionCalls = 0;
  let chatCalls = 0;
  return {
    stub: {
      vision: async () => {
        visionCalls += 1;
        if (opts.visionThrows) throw new Error('vision blew up');
        return opts.visionReturn ?? '';
      },
      chat: async () => {
        chatCalls += 1;
        if (opts.chatThrows) throw new Error('chat blew up');
        return opts.chatReturn ?? '';
      },
    },
    get visionCalls() {
      return visionCalls;
    },
    get chatCalls() {
      return chatCalls;
    },
  };
}

describe('altTextVision', () => {
  it('tier A succeeds: vision returns alt text, sets it on the img (cap 125)', async () => {
    const { img, doc } = makeImg(`<img src="${DATA_URL}">`);
    const { stub, visionCalls, chatCalls } = stubLlm({ visionReturn: '"A silhouette of a raven on a branch."' });
    const r = await altTextVision(img, { doc, llm: stub, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(true);
    expect(r.llmCall).toBe(true);
    expect(img.getAttribute('alt')).toBe('A silhouette of a raven on a branch.');
    // No extra calls beyond vision.
  });

  it('tier A returns empty → tier B chat with DOM context succeeds', async () => {
    const { img, doc } = makeImg(`
      <h2>Cellular respiration overview</h2>
      <p>Following the citric acid cycle, the electron transport chain produces ATP:<img src="/figures/atp-synthesis.jpg"></p>
    `);
    img.setAttribute('src', `/figures/atp-synthesis.jpg`);
    const llm = stubLlm({ visionReturn: '', chatReturn: 'Diagram of ATP synthesis in the electron transport chain.' });
    const r = await altTextVision(img, { doc, llm: llm.stub, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(true);
    expect(r.mutation).toMatch(/context fallback/);
    expect(img.getAttribute('alt')).toBe('Diagram of ATP synthesis in the electron transport chain.');
  });

  it('tier A throws → falls back to tier B chat successfully', async () => {
    const { img, doc } = makeImg(`<figure><img src="/diagram.jpg"><figcaption>Krebs cycle</figcaption></figure>`);
    const llm = stubLlm({ visionThrows: true, chatReturn: 'Krebs cycle diagram.' });
    const r = await altTextVision(img, { doc, llm: llm.stub, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(true);
    expect(img.getAttribute('alt')).toBe('Krebs cycle diagram.');
  });

  it('both tiers empty → sets placeholder, still ok:true', async () => {
    const { img, doc } = makeImg('<img src="/x.jpg">');
    const llm = stubLlm({ visionReturn: '', chatReturn: '' });
    const r = await altTextVision(img, { doc, llm: llm.stub, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(true);
    expect(r.mutation).toMatch(/placeholder/);
    expect(img.getAttribute('alt')).toBe('Image description unavailable');
  });

  it('caps vision output at 125 characters with ellipsis', async () => {
    const long = 'A'.repeat(200);
    const { img, doc } = makeImg(`<img src="${DATA_URL}">`);
    const llm = stubLlm({ visionReturn: long });
    const r = await altTextVision(img, { doc, llm: llm.stub, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(true);
    const alt = img.getAttribute('alt')!;
    expect(alt.length).toBeLessThanOrEqual(125);
    expect(alt.endsWith('…')).toBe(true);
  });

  it('strips surrounding quotes from LLM output', async () => {
    const { img, doc } = makeImg(`<img src="${DATA_URL}">`);
    const llm = stubLlm({ visionReturn: '"A polite cat."' });
    const r = await altTextVision(img, { doc, llm: llm.stub, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(true);
    expect(img.getAttribute('alt')).toBe('A polite cat.');
  });

  it('returns ok:false when no llm is provided', async () => {
    const { img, doc } = makeImg(`<img src="${DATA_URL}">`);
    const r = await altTextVision(img, { doc, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/llm/i);
  });
});
