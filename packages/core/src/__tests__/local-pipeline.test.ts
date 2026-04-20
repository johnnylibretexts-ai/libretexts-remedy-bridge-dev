import { describe, it, expect } from 'vitest';
import { runLocalPipeline } from '../local-pipeline.js';

describe('runLocalPipeline', () => {
  it('handles decorative image via decorative-mark (no LLM needed)', async () => {
    const html = `<ul>
  <li><img src="/chrome/bullet.png" alt="" class="icon"> Observation</li>
</ul>`;
    const out = await runLocalPipeline(html, { maxLlmCalls: 0, axe: false });

    expect(out.beforeHtml).toBe(html);
    expect(out.afterHtml).toContain('role="presentation"');
    expect(out.strategyReports.some((r) => r.strategyId === 'images')).toBe(true);
    expect(typeof out.bytePreserved).toBe('boolean');
    expect(out.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('is a pure HTML→HTML function (no Expert client, no network)', async () => {
    // If runLocalPipeline imported CXone, the pipeline would try to resolve
    // creds on import/call. We rely on the test env having no SERVER_*
    // vars that would let a real client succeed — and on the fact that
    // runLocalPipeline never calls createExpertClient / fetchPageHtml.
    const html = `<p>Hello world</p>`;
    const out = await runLocalPipeline(html, { maxLlmCalls: 0, axe: false });
    expect(out.beforeHtml).toBe(html);
    expect(out.afterHtml).toBeTypeOf('string');
  });

  it('returns findingsBefore and findingsAfter arrays', async () => {
    const html = `<img src="/x.png" alt="diagram" width="600" height="400">`;
    const out = await runLocalPipeline(html, { maxLlmCalls: 0, axe: false });
    expect(Array.isArray(out.findingsBefore)).toBe(true);
    expect(Array.isArray(out.findingsAfter)).toBe(true);
  });
});
