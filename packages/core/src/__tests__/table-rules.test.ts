import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { tableLabelRule } from '../rules/table-label.js';
import { tableStructureRule } from '../rules/table-structure.js';
import { scanHtml } from '../scan.js';

describe('table remediation rules', () => {
  it('links data cells to a header that spans multiple columns', async () => {
    const html = `
      <table>
        <thead>
          <tr>
            <th scope="col" id="prefix">Prefix</th>
            <th scope="col" id="factor" colspan="2">Multiplying factor</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td headers="prefix">kilo-</td>
            <td headers="factor">1000</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    `;
    const finding = scanHtml(html, [tableStructureRule])[0]!;
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);

    const changed = await tableStructureRule.fix!(dom.window.document, finding, {
      page: { id: 1, path: '/', hostname: 'dev.libretexts.org' },
      env: process.env,
    });

    expect(changed).toBe(true);
    expect(dom.window.document.querySelector('tbody td:last-child')?.getAttribute('headers')).toBe('factor');
  });

  it('does not mark unlabeled tables fixable when no deterministic caption source exists', () => {
    const findings = scanHtml('<table><tr><td>No heading nearby</td></tr></table>', [tableLabelRule]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'table-label',
      fixable: false,
      data: {
        fixBlockedReason: 'missing-table-label-source',
      },
    });
  });

  it('marks unlabeled tables fixable when a preceding heading can supply the caption', () => {
    const findings = scanHtml('<h2>Metric prefixes</h2><table><tr><td>kilo</td></tr></table>', [tableLabelRule]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'table-label',
      fixable: true,
      data: {
        captionSource: 'preceding-heading',
      },
    });
  });
});
