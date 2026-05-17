import { describe, expect, it } from 'vitest';
import {
  buildWcagReview,
  summarizeWcagReview,
  wcag21AASuccessCriteria,
} from '../wcag.js';
import { scanHtml } from '../scan.js';
import type { DojException, Finding } from '../types.js';

describe('DOJ Title II WCAG 2.1 A/AA review', () => {
  it('contains exactly the WCAG 2.1 Level A and AA success criteria', () => {
    const ids = wcag21AASuccessCriteria.map((criterion) => criterion.id);

    expect(wcag21AASuccessCriteria).toHaveLength(50);
    expect(new Set(ids).size).toBe(50);
    expect(wcag21AASuccessCriteria.every((criterion) => (
      criterion.level === 'A' || criterion.level === 'AA'
    ))).toBe(true);
    expect(ids).not.toContain('2.5.5');
    expect(ids).not.toContain('2.5.6');
    expect(ids).not.toContain('imgShortAlt');
    expect(ids).not.toContain('linkExtLabeled');
    expect(ids).not.toContain('docLinkFile');
    expect(ids).not.toContain('codeAltText');
    expect(ids).not.toContain('divSection');
  });

  it('marks absent image, media, and form prerequisites as not applicable', () => {
    const review = buildWcagReview({
      html: '<p>Plain textbook paragraph.</p>',
      findings: [],
      scannedAt: '2026-05-17T00:00:00.000Z',
    });

    expect(status(review, '1.1.1')).toBe('not_applicable');
    for (const id of ['1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5']) {
      expect(status(review, id)).toBe('not_applicable');
    }
    for (const id of ['3.3.1', '3.3.2', '3.3.3', '3.3.4']) {
      expect(status(review, id)).toBe('not_applicable');
    }
  });

  it('marks present but unverifiable content as manual review', () => {
    const review = buildWcagReview({
      html: '<video src="lecture.mp4"></video><img src="diagram.png" alt="phase diagram">',
      findings: [],
      scannedAt: '2026-05-17T00:00:00.000Z',
    });

    expect(status(review, '1.2.2')).toBe('manual_review');
    expect(status(review, '1.2.5')).toBe('manual_review');
    expect(status(review, '1.4.5')).toBe('manual_review');
  });

  it('maps scanner findings to WCAG criteria instead of legacy policy keys', () => {
    const findings = scanHtml(`
      <img src="missing-alt.png">
      <table><tr><td>Water</td></tr></table>
      <ul><div>Not a list item</div></ul>
      <a href="https://example.com">https://example.com</a>
      <input name="email">
    `);
    const review = buildWcagReview({
      html: '<p>fixture</p>',
      findings,
      scannedAt: '2026-05-17T00:00:00.000Z',
    });

    expect(status(review, '1.1.1')).toBe('fail');
    expect(evidenceRuleIds(review, '1.1.1')).toContain('img-alt');
    expect(status(review, '1.3.1')).toBe('fail');
    expect(evidenceRuleIds(review, '1.3.1')).toEqual(
      expect.arrayContaining(['table-header', 'list-structure']),
    );
    expect(status(review, '2.4.4')).toBe('fail');
    expect(evidenceRuleIds(review, '2.4.4')).toContain('link-text-descriptive');
    expect(status(review, '3.3.2')).toBe('fail');
    expect(status(review, '4.1.2')).toBe('fail');
    expect(evidenceRuleIds(review, '3.3.2')).toContain('form-label');
  });

  it('excludes manual, not tested, not applicable, and verified exceptions from score', () => {
    const exception: DojException = {
      id: 'exception-1',
      type: 'preexisting-document',
      scope: 'evidence',
      status: 'verified',
      reason: 'Verified DOJ content exception for this evidence.',
      evidenceRefs: ['img-alt#0'],
      source: 'manual',
      updatedAt: '2026-05-17T00:00:00.000Z',
    };
    const review = buildWcagReview({
      html: '<img src="missing-alt.png">',
      findings: [finding('img-alt', true)],
      scannedAt: '2026-05-17T00:00:00.000Z',
      exceptions: [exception],
    });

    expect(status(review, '1.1.1')).toBe('fail');
    expect(review.summary.scoreFailCount).toBe(0);
    expect(review.summary.manualReviewCount).toBeGreaterThan(0);
    expect(review.summary.notTestedCount).toBeGreaterThan(0);
    expect(review.summary.notApplicableCount).toBeGreaterThan(0);
    expect(review.summary.verifiedExceptionCount).toBe(1);

    const withoutException = summarizeWcagReview(review.criteria, []);
    expect(withoutException.scoreFailCount).toBe(1);
  });
});

function status(review: ReturnType<typeof buildWcagReview>, id: string) {
  const criterion = review.criteria.find((item) => item.id === id);
  if (!criterion) throw new Error(`missing criterion ${id}`);
  return criterion.status;
}

function evidenceRuleIds(review: ReturnType<typeof buildWcagReview>, id: string): string[] {
  const criterion = review.criteria.find((item) => item.id === id);
  if (!criterion) throw new Error(`missing criterion ${id}`);
  return criterion.evidence.map((item) => item.ruleId);
}

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
