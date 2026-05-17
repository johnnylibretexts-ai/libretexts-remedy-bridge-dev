import { describe, expect, it } from 'vitest';
import {
  buildConductorCriteria,
  toConductorFindings,
} from '../conductor-compat.js';
import { scanHtml } from '../scan.js';
import type { Finding } from '../types.js';

describe('conductor compatibility helpers', () => {
  it('maps remedy findings to Conductor criteria booleans', () => {
    const findings: Finding[] = [
      finding('img-alt', true, { reason: 'missing-attr' }),
      finding('heading-order', false, { reason: 'skipped-level' }),
      finding('link-text-descriptive', true, { reason: 'bare-url' }),
      finding('axe/link-name', false, { axeRuleId: 'link-name' }),
    ];

    expect(buildConductorCriteria(findings)).toMatchObject({
      imgAltText: false,
      imgDecorative: true,
      imgShortAlt: true,
      headingNoneEmpty: true,
      headingOutline: false,
      formFieldLabels: true,
      tableHeaders: true,
      tableLabel: true,
      listOlLabel: true,
      listUlLabel: true,
      linkNoneEmpty: false,
      linkSuspicious: false,
      linkExtLabeled: true,
      docLinkFile: true,
    });
  });

  it('maps expanded deterministic scanner findings to Conductor criteria', () => {
    const longAlt = 'A'.repeat(151);
    const findings = scanHtml(`
      <img src="/decorative-photo.png" alt="" width="640">
      <img src="/photo.png" alt="${longAlt}">
      <a href="https://example.com/page">resource</a>
      <h2>Sample data</h2>
      <table><tr><th>Name</th></tr><tr><td>Water</td></tr></table>
      <ol><div>Not a list item</div></ol>
      <ul><div>Not a list item</div></ul>
      <a href="/files/report.pdf">Report</a>
    `);

    expect(buildConductorCriteria(findings)).toMatchObject({
      imgAltText: true,
      imgDecorative: false,
      imgShortAlt: false,
      tableLabel: false,
      listOlLabel: false,
      listUlLabel: false,
      linkExtLabeled: false,
      docLinkFile: false,
    });
  });

  it('assigns fixPage-compatible ids only across fixable findings', () => {
    const findings: Finding[] = [
      finding('img-alt', true),
      finding('heading-order', false),
      finding('link-text-descriptive', true, { reason: 'generic-phrase' }),
    ];

    const conductorFindings = toConductorFindings(findings);

    expect(conductorFindings.map((item) => item.id)).toEqual([
      'img-alt#0',
      'heading-order#all-1',
      'link-text-descriptive#1',
    ]);
    expect(conductorFindings[2]).toMatchObject({
      kind: 'link-generic',
      criteria_keys: ['linkSuspicious'],
    });
  });

  it('exposes expanded finding kinds and criteria keys', () => {
    const findings: Finding[] = [
      finding('img-alt', true, { reason: 'suspect-decorative' }),
      finding('img-alt', true, { reason: 'long-alt' }),
      finding('link-text-descriptive', true, { reason: 'external-unlabeled' }),
      finding('table-label', true, { reason: 'missing-accessible-name' }),
      finding('list-structure', false, { listType: 'ol' }),
      finding('list-structure', false, { listType: 'ul' }),
      finding('document-link-filetype', true, { reason: 'missing-filetype-label' }),
    ];

    expect(toConductorFindings(findings).map((item) => ({
      kind: item.kind,
      criteria_keys: item.criteria_keys,
    }))).toEqual([
      { kind: 'img-decorative-suspect', criteria_keys: ['imgDecorative'] },
      { kind: 'img-alt-too-long', criteria_keys: ['imgShortAlt'] },
      { kind: 'link-external-unlabeled', criteria_keys: ['linkExtLabeled'] },
      { kind: 'table-label-missing', criteria_keys: ['tableLabel'] },
      { kind: 'list-structure-invalid', criteria_keys: ['listOlLabel'] },
      { kind: 'list-structure-invalid', criteria_keys: ['listUlLabel'] },
      { kind: 'document-link-filetype-missing', criteria_keys: ['docLinkFile'] },
    ]);
  });
});

function finding(
  ruleId: string,
  fixable: boolean,
  data?: Record<string, unknown>,
): Finding {
  return {
    ruleId,
    severity: 'error',
    message: `${ruleId} finding`,
    source: ruleId.startsWith('axe/') ? 'cxone-health' : 'remedy',
    fixable,
    data,
  };
}
