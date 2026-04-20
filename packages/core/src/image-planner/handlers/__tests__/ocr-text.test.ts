import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { ocrText, markdownToHtml } from '../ocr-text.js';

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

function makeDoc(): Document {
  return new JSDOM('<!doctype html><html><body></body></html>').window.document;
}

describe('markdownToHtml', () => {
  it('wraps a single paragraph in one <p>', () => {
    const doc = makeDoc();
    const frag = markdownToHtml('Hello world.', doc);
    const host = doc.createElement('div');
    host.appendChild(frag);
    expect(host.children.length).toBe(1);
    expect(host.children[0]!.tagName).toBe('P');
    expect(host.children[0]!.textContent).toBe('Hello world.');
  });

  it('maps # / ## / ### to <h3> / <h4> / <h5>', () => {
    const doc = makeDoc();
    const frag = markdownToHtml('# Top\n\n## Middle\n\n### Deep', doc);
    const host = doc.createElement('div');
    host.appendChild(frag);
    const tags = Array.from(host.children).map((c) => c.tagName);
    expect(tags).toEqual(['H3', 'H4', 'H5']);
    expect(host.children[0]!.textContent).toBe('Top');
    expect(host.children[1]!.textContent).toBe('Middle');
    expect(host.children[2]!.textContent).toBe('Deep');
  });

  it('groups consecutive bullet items into one <ul>', () => {
    const doc = makeDoc();
    const frag = markdownToHtml('- a\n- b\n- c', doc);
    const host = doc.createElement('div');
    host.appendChild(frag);
    expect(host.children.length).toBe(1);
    const ul = host.children[0]!;
    expect(ul.tagName).toBe('UL');
    const items = ul.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(Array.from(items).map((l) => l.textContent)).toEqual(['a', 'b', 'c']);
  });

  it('groups consecutive numbered items into one <ol>', () => {
    const doc = makeDoc();
    const frag = markdownToHtml('1. a\n2. b', doc);
    const host = doc.createElement('div');
    host.appendChild(frag);
    expect(host.children.length).toBe(1);
    const ol = host.children[0]!;
    expect(ol.tagName).toBe('OL');
    const items = ol.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(Array.from(items).map((l) => l.textContent)).toEqual(['a', 'b']);
  });

  it('renders a fenced code block as <pre><code>', () => {
    const doc = makeDoc();
    const frag = markdownToHtml('```js\nconst x = 1;\nconsole.log(x);\n```', doc);
    const host = doc.createElement('div');
    host.appendChild(frag);
    expect(host.children.length).toBe(1);
    const pre = host.children[0]!;
    expect(pre.tagName).toBe('PRE');
    const code = pre.querySelector('code')!;
    expect(code).toBeTruthy();
    expect(code.textContent).toBe('const x = 1;\nconsole.log(x);');
  });

  it('handles mixed heading + paragraph + list with correct grouping', () => {
    const doc = makeDoc();
    const md = '# Title\n\nIntro paragraph.\n\n- one\n- two\n- three\n\nAfter list.';
    const frag = markdownToHtml(md, doc);
    const host = doc.createElement('div');
    host.appendChild(frag);
    const tags = Array.from(host.children).map((c) => c.tagName);
    expect(tags).toEqual(['H3', 'P', 'UL', 'P']);
    expect(host.children[0]!.textContent).toBe('Title');
    expect(host.children[1]!.textContent).toBe('Intro paragraph.');
    expect(host.children[2]!.querySelectorAll('li').length).toBe(3);
    expect(host.children[3]!.textContent).toBe('After list.');
  });
});

describe('ocrText', () => {
  // NOTE: handler skips the real image fetch by injecting a stub LLM whose
  // `vision` resolves without reading `image`. Since imageSourceFromUrl is
  // called *before* the stub.vision, we use a data: URL that doesn't require
  // network access.
  const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX///+nxBvIAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

  it('wraps the img in a figure with the OCR\'d HTML inlined after it', async () => {
    const { img, doc } = makeDocWithImg('<img src="code.png">');
    const md = '# Example\n\nThis is a snippet.\n\n- step one\n- step two';
    const llm = stubLlm(md);
    const r = await ocrText(img, { doc, llm, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(true);
    expect(r.llmCall).toBe(true);

    const figure = doc.querySelector('figure')!;
    expect(figure).toBeTruthy();

    const innerImg = figure.querySelector('img')!;
    expect(innerImg.getAttribute('alt')).toBe('Screenshot');
    expect(innerImg.getAttribute('role')).toBe('presentation');

    // img should come first, then the OCR'd HTML.
    const children = Array.from(figure.children).map((c) => c.tagName);
    expect(children[0]).toBe('IMG');
    expect(children.slice(1)).toEqual(['H3', 'P', 'UL']);

    const ul = figure.querySelector('ul')!;
    expect(ul.querySelectorAll('li').length).toBe(2);
  });

  it('returns ok:false when vision says NOT_TEXT, leaving img untouched', async () => {
    const { img, doc } = makeDocWithImg('<img src="chart.png">');
    const llm = stubLlm('NOT_TEXT');
    const r = await ocrText(img, { doc, llm, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(false);
    expect(r.llmCall).toBe(true);
    expect(r.error).toMatch(/does not contain text/);

    // DOM should be untouched.
    expect(doc.querySelector('figure')).toBeNull();
    expect(img.hasAttribute('alt')).toBe(false);
    expect(img.hasAttribute('role')).toBe(false);
  });

  it('returns ok:false when vision returns an empty string', async () => {
    const { img, doc } = makeDocWithImg('<img src="blank.png">');
    const llm = stubLlm('   ');
    const r = await ocrText(img, { doc, llm, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(false);
    expect(r.llmCall).toBe(true);

    expect(doc.querySelector('figure')).toBeNull();
    expect(img.hasAttribute('alt')).toBe(false);
    expect(img.hasAttribute('role')).toBe(false);
  });

  it('returns ok:false when no llm is provided', async () => {
    const { img, doc } = makeDocWithImg('<img src="code.png">');
    const r = await ocrText(img, { doc, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/llm/i);
  });
});
