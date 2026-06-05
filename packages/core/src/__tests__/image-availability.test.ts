import { describe, expect, it } from 'vitest';
import { toConductorFindings } from '../conductor-compat.js';
import { markUnavailableImageFixes } from '../image-availability.js';
import { scanHtml } from '../scan.js';

describe('image availability preflight', () => {
  it('keeps broken image findings in WCAG evidence but removes them from targeted fix IDs', async () => {
    const findings = scanHtml(`
      <img src="https://cdn.mathpix.com/cropped/missing.jpg?height=400&width=1000" alt="">
      <img src="/available.png">
    `);
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('missing.jpg')) {
        return new Response('missing', {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('', {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    };

    const marked = await markUnavailableImageFixes(findings, { hostname: 'dev.libretexts.org', path: '/Sandboxes/johnnyphung' }, {
      fetchImpl,
      timeoutMs: 25,
      concurrency: 2,
    });
    const conductorFindings = toConductorFindings(marked);

    expect(marked[0]).toMatchObject({
      ruleId: 'img-alt',
      fixable: false,
      data: {
        fixBlockedReason: 'broken-image-url',
        fixBlockedMessage: 'Image URL is unavailable (HTTP 404); alt text cannot be generated until the image source is fixed.',
        imageStatus: 404,
      },
    });
    expect(marked[0]?.message).toContain('looks informational');
    expect(marked[1]).toMatchObject({
      ruleId: 'img-alt',
      fixable: true,
    });
    expect(conductorFindings.map((finding) => ({
      id: finding.id,
      kind: finding.kind,
      fixable: finding.fixable,
    }))).toEqual([
      { id: 'img-alt#all-0', kind: 'img-broken-url', fixable: false },
      { id: 'img-alt#0', kind: 'img-alt-missing', fixable: true },
    ]);
  });
});
