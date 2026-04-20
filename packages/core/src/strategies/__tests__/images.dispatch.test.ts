import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { ImageStrategy } from '../images.js';
import type { StrategyContext } from '../types.js';

// 1x1 PNG — valid image bytes so imageSourceFromUrl can fetch it via data: scheme.
const DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX///+nxBvIAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

function makeCtx(llmOverride?: unknown): StrategyContext {
  return {
    hostname: 'dev.libretexts.org',
    maxLlmCalls: 10,
    llm: (llmOverride ?? null) as unknown as StrategyContext['llm'],
  };
}

describe('ImageStrategy dispatch', () => {
  it('routes an img with role="presentation" + generic alt to decorative-mark (no LLM)', async () => {
    // Generic alt ("diagram") trips needsAlt; role="presentation" gives the
    // planner a confident decorative signal; no LLM call should happen.
    const dom = new JSDOM(
      '<!doctype html><html><body><img src="/ornament.png" alt="diagram" role="presentation"></body></html>',
    );
    const doc = dom.window.document;

    const strat = new ImageStrategy();
    const sentinelLlm = {
      vision: async () => {
        throw new Error('LLM must not be called for decorative-mark');
      },
    };
    const report = await strat.apply(doc as unknown as Document, makeCtx(sentinelLlm));

    expect(report.errors).toEqual([]);
    expect(report.llmCalls).toBe(0);
    expect(report.fixesApplied).toHaveLength(1);
    expect(report.fixesApplied[0]).toMatch(/decorative-mark/);
    const img = doc.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('role')).toBe('presentation');
  });

  it('decorative override: empty alt + class="icon" now routes to decorative-mark (previously skipped)', async () => {
    // Before the reshape: this image passed needsAlt=false (empty alt + not informational-size + no URL match)
    // so the strategy never saw it. With the decorative override, the planner's CSS-class signal
    // classifies it decorative and decorative-mark runs.
    const dom = new JSDOM(
      '<!doctype html><html><body><img src="/chrome/bullet.png" alt="" class="icon"></body></html>',
    );
    const doc = dom.window.document;

    const sentinelLlm = {
      vision: async () => {
        throw new Error('LLM must not be called for decorative-mark');
      },
    };
    const strat = new ImageStrategy();
    const report = await strat.apply(doc as unknown as Document, makeCtx(sentinelLlm));

    expect(report.errors).toEqual([]);
    expect(report.llmCalls).toBe(0);
    expect(report.fixesApplied).toHaveLength(1);
    expect(report.fixesApplied[0]).toMatch(/decorative-mark/);
    const img = doc.querySelector('img')!;
    expect(img.getAttribute('role')).toBe('presentation');
  });

  it('routes a captioned flowchart img to flowchart-ol (stubbed vision)', async () => {
    // Use a data: URL so the handler's imageSourceFromUrl fetch doesn't hit the network.
    const dom = new JSDOM(
      `<!doctype html><html><body>
        <figure>
          <img src="${DATA_URL}" alt="" width="800" height="600">
          <figcaption>Scientific method flowchart</figcaption>
        </figure>
      </body></html>`,
    );
    const doc = dom.window.document;

    const stubLlm = {
      vision: async () =>
        '{"caption":"Scientific method flowchart","steps":["Observation","Hypothesis","Experiment","Conclusion"]}',
    };
    const strat = new ImageStrategy();
    const report = await strat.apply(doc as unknown as Document, makeCtx(stubLlm));

    expect(report.errors).toEqual([]);
    expect(report.llmCalls).toBe(1);
    expect(report.fixesApplied).toHaveLength(1);
    expect(report.fixesApplied[0]).toMatch(/flowchart-ol/);

    const ol = doc.querySelector('figure > ol');
    expect(ol).not.toBeNull();
    expect(ol!.querySelectorAll('li').length).toBe(4);
    const img = doc.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('role')).toBe('presentation');
  });
});
