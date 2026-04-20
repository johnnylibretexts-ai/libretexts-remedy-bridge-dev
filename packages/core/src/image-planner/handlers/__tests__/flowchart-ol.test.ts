import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { flowchartOl, parseFlowchartJson } from '../flowchart-ol.js';

function stubLlm(response: string): any {
  return {
    vision: async () => response,
  };
}

function makeDocWithImg(innerHTML: string): { img: HTMLImageElement; doc: Document } {
  const dom = new JSDOM(`<!doctype html><html><body>${innerHTML}</body></html>`);
  const doc = dom.window.document;
  const img = doc.querySelector('img') as unknown as HTMLImageElement;
  return { img, doc };
}

describe('parseFlowchartJson', () => {
  it('parses bare JSON', () => {
    const r = parseFlowchartJson('{"caption":"Hi","steps":["a","b"]}');
    expect(r).toEqual({ caption: 'Hi', steps: ['a', 'b'] });
  });

  it('parses JSON wrapped in code fences', () => {
    const r = parseFlowchartJson('```json\n{"caption":"Hi","steps":["a","b"]}\n```');
    expect(r).toEqual({ caption: 'Hi', steps: ['a', 'b'] });
  });

  it('parses JSON preceded by prose', () => {
    const r = parseFlowchartJson('Sure! Here it is:\n{"caption":"Hi","steps":["a"]}');
    expect(r).toEqual({ caption: 'Hi', steps: ['a'] });
  });

  it('returns null on invalid JSON', () => {
    expect(parseFlowchartJson('not json')).toBeNull();
  });

  it('returns null when shape is wrong', () => {
    expect(parseFlowchartJson('{"caption":123,"steps":["a"]}')).toBeNull();
    expect(parseFlowchartJson('{"caption":"ok","steps":"not array"}')).toBeNull();
    expect(parseFlowchartJson('{"caption":"ok","steps":[1,2]}')).toBeNull();
  });
});

describe('flowchartOl', () => {
  // NOTE: handler skips the real image fetch by injecting a stub LLM whose
  // `vision` resolves without reading `image`. Since imageSourceFromUrl is
  // called *before* the stub.vision, we use a data: URL that doesn't require
  // network access.
  const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX///+nxBvIAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

  it('wraps a bare img in a figure with caption and ordered list', async () => {
    const { img, doc } = makeDocWithImg('<img src="flow.jpg">');
    const llm = stubLlm('{"caption":"Scientific method flowchart","steps":["Observation","Hypothesis","Experiment","Conclusion"]}');
    const r = await flowchartOl(img, { doc, llm, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(true);
    expect(r.mutation).toMatch(/4 steps/);

    const figure = doc.querySelector('figure')!;
    expect(figure).toBeTruthy();
    expect(figure.getAttribute('role')).toBe('group');
    expect(figure.getAttribute('aria-label')).toBe('Scientific method flowchart');

    const innerImg = figure.querySelector('img')!;
    expect(innerImg.getAttribute('alt')).toBe('');
    expect(innerImg.getAttribute('role')).toBe('presentation');

    const caption = figure.querySelector('figcaption')!;
    expect(caption.textContent).toBe('Scientific method flowchart');

    const lis = figure.querySelectorAll('ol > li');
    expect(lis.length).toBe(4);
    expect(Array.from(lis).map((l) => l.textContent)).toEqual([
      'Observation',
      'Hypothesis',
      'Experiment',
      'Conclusion',
    ]);
  });

  it('augments an existing <figure> in place rather than nesting', async () => {
    const { img, doc } = makeDocWithImg('<figure><img src="flow.jpg"></figure>');
    const llm = stubLlm('{"caption":"Flow","steps":["A","B"]}');
    const r = await flowchartOl(img, { doc, llm, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(true);

    const figures = doc.querySelectorAll('figure');
    expect(figures.length).toBe(1); // did not create a nested figure
    const figure = figures[0]!;
    expect(figure.querySelector('figcaption')?.textContent).toBe('Flow');
    expect(figure.querySelectorAll('ol > li').length).toBe(2);
  });

  it('returns ok:false when the LLM response is unparseable', async () => {
    const { img, doc } = makeDocWithImg('<img src="flow.jpg">');
    const llm = stubLlm('definitely not JSON');
    const r = await flowchartOl(img, { doc, llm, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(false);
    expect(r.llmCall).toBe(true);
    // DOM should be untouched.
    expect(doc.querySelector('figure')).toBeNull();
  });

  it('returns ok:false when fewer than 2 steps are extracted', async () => {
    const { img, doc } = makeDocWithImg('<img src="flow.jpg">');
    const llm = stubLlm('{"caption":"x","steps":["only one"]}');
    const r = await flowchartOl(img, { doc, llm, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(false);
  });

  it('returns ok:false when no llm is provided', async () => {
    const { img, doc } = makeDocWithImg('<img src="flow.jpg">');
    const r = await flowchartOl(img, { doc, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/llm/i);
  });
});
