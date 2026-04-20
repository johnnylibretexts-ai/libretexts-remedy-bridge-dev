import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { chartLongdesc, parseChartJson } from '../chart-longdesc.js';

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

describe('parseChartJson', () => {
  it('parses bare JSON with a populated data_table', () => {
    const r = parseChartJson(
      '{"caption":"Sales By Quarter","long_description":"Bar chart of quarterly sales.","data_table":[{"label":"Q1","value":"100"},{"label":"Q2","value":"150"}]}',
    );
    expect(r).toEqual({
      caption: 'Sales By Quarter',
      long_description: 'Bar chart of quarterly sales.',
      data_table: [
        { label: 'Q1', value: '100' },
        { label: 'Q2', value: '150' },
      ],
    });
  });

  it('parses JSON wrapped in code fences', () => {
    const r = parseChartJson(
      '```json\n{"caption":"Hi","long_description":"A chart.","data_table":[]}\n```',
    );
    expect(r).toEqual({ caption: 'Hi', long_description: 'A chart.', data_table: [] });
  });

  it('parses JSON preceded by prose', () => {
    const r = parseChartJson(
      'Sure! Here it is:\n{"caption":"Hi","long_description":"A chart.","data_table":[]}',
    );
    expect(r).toEqual({ caption: 'Hi', long_description: 'A chart.', data_table: [] });
  });

  it('accepts an empty data_table', () => {
    const r = parseChartJson(
      '{"caption":"Trend","long_description":"A trend line.","data_table":[]}',
    );
    expect(r?.data_table).toEqual([]);
  });

  it('coerces numeric data_table values to strings', () => {
    const r = parseChartJson(
      '{"caption":"X","long_description":"Y","data_table":[{"label":"A","value":42}]}',
    );
    expect(r?.data_table).toEqual([{ label: 'A', value: '42' }]);
  });

  it('returns null on invalid JSON', () => {
    expect(parseChartJson('not json')).toBeNull();
  });

  it('returns null when shape is wrong', () => {
    // missing long_description
    expect(parseChartJson('{"caption":"ok","data_table":[]}')).toBeNull();
    // data_table not an array
    expect(
      parseChartJson('{"caption":"ok","long_description":"d","data_table":"nope"}'),
    ).toBeNull();
    // data_table entry missing label
    expect(
      parseChartJson(
        '{"caption":"ok","long_description":"d","data_table":[{"value":"1"}]}',
      ),
    ).toBeNull();
    // caption wrong type
    expect(
      parseChartJson('{"caption":123,"long_description":"d","data_table":[]}'),
    ).toBeNull();
  });
});

describe('chartLongdesc', () => {
  // NOTE: handler skips the real image fetch by injecting a stub LLM whose
  // `vision` resolves without reading `image`. Since imageSourceFromUrl is
  // called *before* the stub.vision, we use a data: URL that doesn't require
  // network access.
  const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX///+nxBvIAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

  it('wraps a bare img in a figure with caption, details, and data table', async () => {
    const { img, doc } = makeDocWithImg('<img src="chart.png">');
    const llm = stubLlm(
      '{"caption":"Quarterly Sales 2025","long_description":"Bar chart showing sales climbing from Q1 to Q4, with Q4 the highest.","data_table":[{"label":"Q1","value":"100"},{"label":"Q2","value":"150"},{"label":"Q3","value":"175"},{"label":"Q4","value":"220"}]}',
    );
    const r = await chartLongdesc(img, { doc, llm, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(true);
    expect(r.llmCall).toBe(true);

    const figure = doc.querySelector('figure')!;
    expect(figure).toBeTruthy();

    const innerImg = figure.querySelector('img')!;
    expect(innerImg.getAttribute('alt')).toBe('Quarterly Sales 2025');

    const caption = figure.querySelector('figcaption')!;
    expect(caption.textContent).toBe('Quarterly Sales 2025');

    const details = figure.querySelector('details')!;
    expect(details).toBeTruthy();
    expect(details.querySelector('summary')?.textContent).toBe('Long description');
    expect(details.querySelector('p')?.textContent).toMatch(/Bar chart showing sales/);

    const table = figure.querySelector('table')!;
    expect(table).toBeTruthy();
    const headers = Array.from(table.querySelectorAll('thead th')).map((h) => h.textContent);
    expect(headers).toEqual(['Label', 'Value']);
    const rows = table.querySelectorAll('tbody tr');
    expect(rows.length).toBe(4);
    const firstRowCells = Array.from(rows[0]!.querySelectorAll('td')).map((c) => c.textContent);
    expect(firstRowCells).toEqual(['Q1', '100']);
  });

  it('augments an existing <figure> in place rather than nesting', async () => {
    const { img, doc } = makeDocWithImg('<figure><img src="chart.png"></figure>');
    const llm = stubLlm(
      '{"caption":"Line Chart","long_description":"A climbing line.","data_table":[{"label":"A","value":"1"},{"label":"B","value":"2"}]}',
    );
    const r = await chartLongdesc(img, { doc, llm, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(true);

    const figures = doc.querySelectorAll('figure');
    expect(figures.length).toBe(1); // no nested figure created
    const figure = figures[0]!;
    expect(figure.querySelector('figcaption')?.textContent).toBe('Line Chart');
    expect(figure.querySelector('details')).toBeTruthy();
    expect(figure.querySelectorAll('tbody tr').length).toBe(2);
    expect(figure.querySelector('img')?.getAttribute('alt')).toBe('Line Chart');
  });

  it('preserves an existing figcaption and does not duplicate it', async () => {
    const { img, doc } = makeDocWithImg(
      '<figure><img src="chart.png"><figcaption>Existing cap</figcaption></figure>',
    );
    const llm = stubLlm(
      '{"caption":"New Caption","long_description":"Desc.","data_table":[]}',
    );
    const r = await chartLongdesc(img, { doc, llm, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(true);

    const figure = doc.querySelector('figure')!;
    const figcaptions = figure.querySelectorAll('figcaption');
    expect(figcaptions.length).toBe(1);
    expect(figcaptions[0]?.textContent).toBe('Existing cap');
    // alt still updated to the new caption
    expect(figure.querySelector('img')?.getAttribute('alt')).toBe('New Caption');
  });

  it('omits <table> when data_table is empty', async () => {
    const { img, doc } = makeDocWithImg('<img src="chart.png">');
    const llm = stubLlm(
      '{"caption":"Trend Line","long_description":"Shows an upward trend over time.","data_table":[]}',
    );
    const r = await chartLongdesc(img, { doc, llm, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(true);

    const figure = doc.querySelector('figure')!;
    expect(figure.querySelector('details')).toBeTruthy();
    expect(figure.querySelector('table')).toBeNull();
  });

  it('omits <table> when data_table has only 1 entry', async () => {
    const { img, doc } = makeDocWithImg('<img src="chart.png">');
    const llm = stubLlm(
      '{"caption":"Single Point","long_description":"A single measurement.","data_table":[{"label":"A","value":"1"}]}',
    );
    const r = await chartLongdesc(img, { doc, llm, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(true);
    expect(doc.querySelector('table')).toBeNull();
  });

  it('returns ok:false when the LLM returns an empty caption', async () => {
    const { img, doc } = makeDocWithImg('<img src="chart.png">');
    const llm = stubLlm('{"caption":"","long_description":"","data_table":[]}');
    const r = await chartLongdesc(img, { doc, llm, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(false);
    expect(r.llmCall).toBe(true);
    expect(r.error).toMatch(/not a chart/);
    // DOM should be untouched.
    expect(doc.querySelector('figure')).toBeNull();
    expect(doc.querySelector('details')).toBeNull();
  });

  it('returns ok:false when the LLM response is unparseable', async () => {
    const { img, doc } = makeDocWithImg('<img src="chart.png">');
    const llm = stubLlm('definitely not JSON');
    const r = await chartLongdesc(img, { doc, llm, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(false);
    expect(r.llmCall).toBe(true);
    expect(doc.querySelector('figure')).toBeNull();
  });

  it('returns ok:false when no llm is provided', async () => {
    const { img, doc } = makeDocWithImg('<img src="chart.png">');
    const r = await chartLongdesc(img, { doc, absoluteSrc: DATA_URL });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/llm/i);
  });
});
