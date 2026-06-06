import { JSDOM } from 'jsdom';
import type {
  DojException,
  Finding,
  PageRef,
  WcagCriterionDefinition,
  WcagCriterionResult,
  WcagCriterionStatus,
  WcagEvidence,
  WcagReview,
  WcagReviewSummary,
} from './types.js';

export const wcag21AASuccessCriteria = [
  { id: '1.1.1', title: 'Non-text Content', level: 'A', principle: 'Perceivable' },
  { id: '1.2.1', title: 'Audio-only and Video-only (Prerecorded)', level: 'A', principle: 'Perceivable' },
  { id: '1.2.2', title: 'Captions (Prerecorded)', level: 'A', principle: 'Perceivable' },
  { id: '1.2.3', title: 'Audio Description or Media Alternative (Prerecorded)', level: 'A', principle: 'Perceivable' },
  { id: '1.2.4', title: 'Captions (Live)', level: 'AA', principle: 'Perceivable' },
  { id: '1.2.5', title: 'Audio Description (Prerecorded)', level: 'AA', principle: 'Perceivable' },
  { id: '1.3.1', title: 'Info and Relationships', level: 'A', principle: 'Perceivable' },
  { id: '1.3.2', title: 'Meaningful Sequence', level: 'A', principle: 'Perceivable' },
  { id: '1.3.3', title: 'Sensory Characteristics', level: 'A', principle: 'Perceivable' },
  { id: '1.3.4', title: 'Orientation', level: 'AA', principle: 'Perceivable' },
  { id: '1.3.5', title: 'Identify Input Purpose', level: 'AA', principle: 'Perceivable' },
  { id: '1.4.1', title: 'Use of Color', level: 'A', principle: 'Perceivable' },
  { id: '1.4.2', title: 'Audio Control', level: 'A', principle: 'Perceivable' },
  { id: '1.4.3', title: 'Contrast (Minimum)', level: 'AA', principle: 'Perceivable' },
  { id: '1.4.4', title: 'Resize Text', level: 'AA', principle: 'Perceivable' },
  { id: '1.4.5', title: 'Images of Text', level: 'AA', principle: 'Perceivable' },
  { id: '1.4.10', title: 'Reflow', level: 'AA', principle: 'Perceivable' },
  { id: '1.4.11', title: 'Non-text Contrast', level: 'AA', principle: 'Perceivable' },
  { id: '1.4.12', title: 'Text Spacing', level: 'AA', principle: 'Perceivable' },
  { id: '1.4.13', title: 'Content on Hover or Focus', level: 'AA', principle: 'Perceivable' },
  { id: '2.1.1', title: 'Keyboard', level: 'A', principle: 'Operable' },
  { id: '2.1.2', title: 'No Keyboard Trap', level: 'A', principle: 'Operable' },
  { id: '2.1.4', title: 'Character Key Shortcuts', level: 'A', principle: 'Operable' },
  { id: '2.2.1', title: 'Timing Adjustable', level: 'A', principle: 'Operable' },
  { id: '2.2.2', title: 'Pause, Stop, Hide', level: 'A', principle: 'Operable' },
  { id: '2.3.1', title: 'Three Flashes or Below Threshold', level: 'A', principle: 'Operable' },
  { id: '2.4.1', title: 'Bypass Blocks', level: 'A', principle: 'Operable' },
  { id: '2.4.2', title: 'Page Titled', level: 'A', principle: 'Operable' },
  { id: '2.4.3', title: 'Focus Order', level: 'A', principle: 'Operable' },
  { id: '2.4.4', title: 'Link Purpose (In Context)', level: 'A', principle: 'Operable' },
  { id: '2.4.5', title: 'Multiple Ways', level: 'AA', principle: 'Operable' },
  { id: '2.4.6', title: 'Headings and Labels', level: 'AA', principle: 'Operable' },
  { id: '2.4.7', title: 'Focus Visible', level: 'AA', principle: 'Operable' },
  { id: '2.5.1', title: 'Pointer Gestures', level: 'A', principle: 'Operable' },
  { id: '2.5.2', title: 'Pointer Cancellation', level: 'A', principle: 'Operable' },
  { id: '2.5.3', title: 'Label in Name', level: 'A', principle: 'Operable' },
  { id: '2.5.4', title: 'Motion Actuation', level: 'A', principle: 'Operable' },
  { id: '3.1.1', title: 'Language of Page', level: 'A', principle: 'Understandable' },
  { id: '3.1.2', title: 'Language of Parts', level: 'AA', principle: 'Understandable' },
  { id: '3.2.1', title: 'On Focus', level: 'A', principle: 'Understandable' },
  { id: '3.2.2', title: 'On Input', level: 'A', principle: 'Understandable' },
  { id: '3.2.3', title: 'Consistent Navigation', level: 'AA', principle: 'Understandable' },
  { id: '3.2.4', title: 'Consistent Identification', level: 'AA', principle: 'Understandable' },
  { id: '3.3.1', title: 'Error Identification', level: 'A', principle: 'Understandable' },
  { id: '3.3.2', title: 'Labels or Instructions', level: 'A', principle: 'Understandable' },
  { id: '3.3.3', title: 'Error Suggestion', level: 'AA', principle: 'Understandable' },
  { id: '3.3.4', title: 'Error Prevention (Legal, Financial, Data)', level: 'AA', principle: 'Understandable' },
  { id: '4.1.1', title: 'Parsing', level: 'A', principle: 'Robust' },
  { id: '4.1.2', title: 'Name, Role, Value', level: 'A', principle: 'Robust' },
  { id: '4.1.3', title: 'Status Messages', level: 'AA', principle: 'Robust' },
] as const satisfies readonly WcagCriterionDefinition[];

export interface BuildWcagReviewOptions {
  html?: string;
  findings: Finding[];
  scannedAt?: string;
  page?: Pick<PageRef, 'title' | 'path'>;
  previousReview?: WcagReview;
  exceptions?: DojException[];
}

interface HtmlFacts {
  hasHtml: boolean;
  nonTextCount: number;
  imageCount: number;
  mediaCount: number;
  audioCount: number;
  formControlCount: number;
  linkCount: number;
  interactiveCount: number;
  structureCount: number;
  headingOrLabelCount: number;
  movingOrTimingCount: number;
  pointerCandidateCount: number;
  hoverFocusCandidateCount: number;
  statusMessageCandidateCount: number;
  inlineColorCandidateCount: number;
  sensoryTextCandidateCount: number;
  textLength: number;
  hasPageTitle: boolean;
  hasLanguage: boolean;
  hasAutocompleteInput: boolean;
  hasMotionCandidate: boolean;
  hasAccessKeyOrShortcut: boolean;
}

export function buildWcagReview(opts: BuildWcagReviewOptions): WcagReview {
  const scannedAt = opts.scannedAt ?? new Date().toISOString();
  const facts = analyzeHtml(opts.html, opts.page);
  const evidenceByCriterion = buildEvidenceByCriterion(opts.findings);
  const previousById = new Map((opts.previousReview?.criteria ?? []).map((item) => [item.id, item]));

  const criteria: WcagCriterionResult[] = wcag21AASuccessCriteria.map((criterion) => {
    const evidence = evidenceByCriterion.get(criterion.id) ?? [];
    const previous = previousById.get(criterion.id);
    const scannerResult = scannerResultForCriterion(criterion.id, facts, evidence);

    if (previous?.source === 'manual') {
      return {
        ...criterion,
        status: previous.status,
        applicabilityReason: previous.applicabilityReason,
        source: evidence.length > 0 ? 'mixed' : 'manual',
        evidence,
        updatedAt: previous.updatedAt,
      };
    }

    return {
      ...criterion,
      ...scannerResult,
      evidence,
      updatedAt: scannedAt,
    };
  });

  return {
    target: 'DOJ Title II',
    standard: 'WCAG 2.1 Level A/AA',
    wcagVersion: '2.1',
    generatedAt: scannedAt,
    scannedAt,
    criteria,
    summary: summarizeWcagReview(criteria, opts.exceptions ?? []),
  };
}

export function summarizeWcagReview(
  criteria: WcagCriterionResult[],
  exceptions: DojException[] = [],
): WcagReviewSummary {
  const verifiedExceptions = exceptions.filter((item) => item.status === 'verified');
  const verifiedExceptionIds = new Set(verifiedExceptions.map((item) => item.id));
  const verifiedEvidenceRefs = new Set(
    verifiedExceptions.flatMap((item) => item.evidenceRefs),
  );
  const hasVerifiedPageException = verifiedExceptions.some((item) => item.scope === 'page');

  let passCount = 0;
  let failCount = 0;
  let manualReviewCount = 0;
  let notTestedCount = 0;
  let notApplicableCount = 0;
  let scorePassCount = 0;
  let scoreFailCount = 0;

  for (const criterion of criteria) {
    if (criterion.status === 'pass') passCount += 1;
    if (criterion.status === 'fail') failCount += 1;
    if (criterion.status === 'manual_review') manualReviewCount += 1;
    if (criterion.status === 'not_tested') notTestedCount += 1;
    if (criterion.status === 'not_applicable') notApplicableCount += 1;

    if (hasVerifiedPageException) continue;
    if (criterion.status === 'pass') {
      scorePassCount += 1;
    } else if (criterion.status === 'fail' && !criterionFailCoveredByException(
      criterion,
      verifiedExceptionIds,
      verifiedEvidenceRefs,
    )) {
      scoreFailCount += 1;
    }
  }

  const scoreDenominator = scorePassCount + scoreFailCount;
  const score = scoreDenominator === 0
    ? null
    : Math.round((scorePassCount / scoreDenominator) * 100);

  return {
    score,
    scorePassCount,
    scoreFailCount,
    scoreDenominator,
    passCount,
    failCount,
    manualReviewCount,
    notTestedCount,
    exceptionCount: exceptions.length,
    verifiedExceptionCount: verifiedExceptions.length,
    notApplicableCount,
    complete: failCount === 0 && manualReviewCount === 0 && notTestedCount === 0,
  };
}

export function wcagCriterionIdsForFinding(finding: Finding): string[] {
  const axeRuleId = String(finding.data?.axeRuleId ?? '');
  switch (finding.ruleId) {
    case 'img-alt':
    case 'chart-alt':
    case 'math-accessible':
    case 'axe/image-alt':
    case 'axe/area-alt':
    case 'axe/input-image-alt':
    case 'axe/object-alt':
    case 'axe/role-img-alt':
      return ['1.1.1'];
    case 'figure-wrap':
    case 'heading-as-bold':
    case 'heading-order':
    case 'table-header':
    case 'table-label':
    case 'table-structure':
    case 'list-structure':
    case 'axe/empty-table-header':
    case 'axe/td-has-header':
    case 'axe/th-has-data-cells':
    case 'axe/table-duplicate-name':
    case 'axe/table-fake-caption':
    case 'axe/list':
    case 'axe/listitem':
      return ['1.3.1'];
    case 'axe/empty-heading':
      return ['1.3.1', '2.4.6'];
    case 'link-text-descriptive':
    case 'document-link-filetype':
      return ['2.4.4'];
    case 'axe/link-name':
      return ['2.4.4', '4.1.2'];
    case 'form-label':
    case 'axe/label':
    case 'axe/aria-input-field-name':
    case 'axe/select-name':
    case 'axe/form-field-multiple-labels':
      return ['2.4.6', '3.3.2', '4.1.2'];
    case 'duplicate-id':
    case 'axe/duplicate-id-aria':
      return ['4.1.1'];
    case 'axe/button-name':
    case 'axe/input-button-name':
      return ['4.1.2'];
    case 'axe/valid-lang':
      return ['3.1.2'];
    case 'axe/aria-allowed-attr':
    case 'axe/aria-hidden-body':
    case 'axe/aria-hidden-focus':
    case 'axe/aria-required-attr':
    case 'axe/aria-required-children':
    case 'axe/aria-required-parent':
    case 'axe/aria-roles':
    case 'axe/aria-valid-attr':
    case 'axe/aria-valid-attr-value':
      return ['4.1.2'];
    default:
      if (axeRuleId === 'link-name') return ['2.4.4', '4.1.2'];
      if (axeRuleId === 'empty-heading') return ['1.3.1', '2.4.6'];
      if (axeRuleId === 'label' || axeRuleId === 'aria-input-field-name') {
        return ['2.4.6', '3.3.2', '4.1.2'];
      }
      if (axeRuleId.startsWith('table-') || axeRuleId === 'list' || axeRuleId === 'listitem') {
        return ['1.3.1'];
      }
      if (axeRuleId.endsWith('-alt')) return ['1.1.1'];
      if (axeRuleId.startsWith('aria-')) return ['4.1.2'];
      return finding.wcag ? finding.wcag.split(',').map((item) => item.trim()).filter(Boolean) : [];
  }
}

function buildEvidenceByCriterion(findings: Finding[]): Map<string, WcagEvidence[]> {
  const out = new Map<string, WcagEvidence[]>();
  let fixableIndex = 0;
  findings.forEach((finding, index) => {
    const findingId = finding.fixable
      ? `${finding.ruleId}#${fixableIndex++}`
      : `${finding.ruleId}#all-${index}`;
    const evidence = findingToEvidence(finding, findingId);
    for (const criterionId of wcagCriterionIdsForFinding(finding)) {
      const bucket = out.get(criterionId) ?? [];
      bucket.push(evidence);
      out.set(criterionId, bucket);
    }
  });
  return out;
}

function findingToEvidence(finding: Finding, findingId: string): WcagEvidence {
  const exceptionId = typeof finding.data?.exceptionId === 'string'
    ? finding.data.exceptionId
    : undefined;
  const fixBlockedReason = optionalString(finding.data?.fixBlockedReason);
  const fixBlockedMessage = optionalString(finding.data?.fixBlockedMessage);
  const imageUrl = optionalString(finding.data?.imageUrl);
  const imageStatus = typeof finding.data?.imageStatus === 'number'
    ? finding.data.imageStatus
    : undefined;
  const imageMimeType = optionalString(finding.data?.imageMimeType);
  return {
    source: finding.source,
    ruleId: finding.ruleId,
    findingId,
    severity: finding.severity,
    message: finding.message,
    selector: finding.selector,
    snippet: finding.snippet,
    fixable: finding.fixable,
    exceptionId,
    fixBlockedReason,
    fixBlockedMessage,
    imageUrl,
    imageStatus,
    imageMimeType,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function scannerResultForCriterion(
  id: string,
  facts: HtmlFacts,
  evidence: WcagEvidence[],
): Pick<WcagCriterionResult, 'status' | 'applicabilityReason' | 'source'> {
  if (evidence.length > 0) {
    const hasFailure = evidence.some((item) => item.severity !== 'info');
    return {
      status: hasFailure ? 'fail' : 'manual_review',
      applicabilityReason: hasFailure
        ? 'Scanner evidence maps to this WCAG criterion.'
        : 'Scanner returned incomplete or informational evidence that needs review.',
      source: 'scanner',
    };
  }

  if (!facts.hasHtml) return notTested('No HTML source was provided to evaluate this criterion.');

  switch (id) {
    case '1.1.1':
      return facts.nonTextCount === 0
        ? notApplicable('No non-text content candidates were detected.')
        : pass('Non-text content candidates were covered by automated checks with no mapped failures.');
    case '1.2.1':
    case '1.2.2':
    case '1.2.3':
    case '1.2.4':
    case '1.2.5':
      return facts.mediaCount === 0
        ? notApplicable('No audio or video content candidates were detected.')
        : manualReview('Audio/video alternatives, captions, and descriptions require human verification.');
    case '1.3.1':
      return facts.structureCount === 0
        ? notTested('No structural candidates were detected; semantic relationships still need spot review.')
        : pass('Detected headings, lists, tables, figures, or form structure had no mapped scanner failures.');
    case '1.3.2':
      return facts.structureCount === 0
        ? notTested('No structural sequence candidates were detected.')
        : manualReview('Meaningful reading sequence cannot be proven from static markup alone.');
    case '1.3.3':
      return facts.sensoryTextCandidateCount === 0
        ? notApplicable('No sensory-instruction language candidates were detected.')
        : manualReview('Instructions that rely on shape, color, size, position, or sound need human review.');
    case '1.3.4':
      return facts.interactiveCount === 0
        ? notApplicable('No orientation-sensitive interactive content was detected.')
        : manualReview('Orientation behavior requires browser/device review.');
    case '1.3.5':
      return facts.formControlCount === 0
        ? notApplicable('No form input controls were detected.')
        : facts.hasAutocompleteInput
        ? pass('Form inputs expose autocomplete/purpose hints and no mapped failures were found.')
        : manualReview('Input purpose may need autocomplete or equivalent programmatic identification.');
    case '1.4.1':
      return facts.inlineColorCandidateCount === 0
        ? notTested('No color-use candidates were detected by the static scanner.')
        : manualReview('Use of color as the only visual cue requires human review.');
    case '1.4.2':
      return facts.audioCount === 0
        ? notApplicable('No audio content candidates were detected.')
        : manualReview('Autoplay and audio control behavior require browser review.');
    case '1.4.3':
      return facts.inlineColorCandidateCount === 0
        ? notTested('Contrast requires rendered CSS evaluation beyond this static scan.')
        : manualReview('Text contrast needs rendered color verification.');
    case '1.4.4':
    case '1.4.10':
    case '1.4.12':
      return facts.textLength === 0
        ? notApplicable('No text content was detected.')
        : manualReview('Resize, reflow, and text-spacing behavior require rendered layout review.');
    case '1.4.5':
      return facts.imageCount === 0
        ? notApplicable('No image candidates were detected.')
        : manualReview('Images of text require human visual review.');
    case '1.4.11':
      return facts.interactiveCount === 0 && facts.imageCount === 0
        ? notApplicable('No non-text UI or graphical object candidates were detected.')
        : manualReview('Non-text contrast requires rendered visual review.');
    case '1.4.13':
      return facts.hoverFocusCandidateCount === 0
        ? notApplicable('No hover or focus-triggered content candidates were detected.')
        : manualReview('Hover/focus content behavior requires browser review.');
    case '2.1.1':
    case '2.1.2':
    case '2.4.3':
    case '2.4.7':
      return facts.interactiveCount === 0
        ? notApplicable('No keyboard-focusable interactive content was detected.')
        : manualReview('Keyboard operation, focus order, traps, and focus visibility require browser review.');
    case '2.1.4':
      return facts.hasAccessKeyOrShortcut
        ? manualReview('Character key shortcut behavior requires manual verification.')
        : notApplicable('No character-key shortcut candidates were detected.');
    case '2.2.1':
    case '2.2.2':
    case '2.3.1':
      return facts.movingOrTimingCount === 0
        ? notApplicable('No timing, moving, blinking, autoplay, or flashing candidates were detected.')
        : manualReview('Timed, moving, blinking, autoplay, or flashing behavior requires manual review.');
    case '2.4.1':
      return notTested('Bypass-block support is provided at page/template level and was not proven by this content scan.');
    case '2.4.2':
      return facts.hasPageTitle
        ? pass('A page title was available from the page metadata or HTML title.')
        : notTested('No page title was available to the scanner.');
    case '2.4.4':
      return facts.linkCount === 0
        ? notApplicable('No links were detected.')
        : pass('Links were covered by automated purpose checks with no mapped failures.');
    case '2.4.5':
      return notTested('Multiple ways to locate a page is a site/navigation-level requirement.');
    case '2.4.6':
      return facts.headingOrLabelCount === 0
        ? notApplicable('No headings or labels were detected.')
        : pass('Headings and labels had no mapped scanner failures.');
    case '2.5.1':
    case '2.5.2':
      return facts.pointerCandidateCount === 0
        ? notApplicable('No pointer gesture candidates were detected.')
        : manualReview('Pointer gesture and cancellation behavior require browser/device review.');
    case '2.5.3':
      return facts.formControlCount === 0
        ? notApplicable('No labeled controls were detected.')
        : manualReview('Visible label text and accessible name alignment require human review.');
    case '2.5.4':
      return facts.hasMotionCandidate
        ? manualReview('Motion-actuation behavior requires device review.')
        : notApplicable('No motion-actuation candidates were detected.');
    case '3.1.1':
      return facts.hasLanguage
        ? pass('A page language was detected in HTML.')
        : notTested('Page language is usually supplied by the platform shell and was not proven here.');
    case '3.1.2':
      return notTested('Language changes within content require linguistic review.');
    case '3.2.1':
    case '3.2.2':
      return facts.interactiveCount === 0
        ? notApplicable('No focusable or input controls were detected.')
        : manualReview('Focus and input-triggered context changes require browser review.');
    case '3.2.3':
    case '3.2.4':
      return notTested('Consistent navigation and identification are site-level requirements.');
    case '3.3.1':
    case '3.3.3':
    case '3.3.4':
      return facts.formControlCount === 0
        ? notApplicable('No form controls were detected.')
        : manualReview('Form error identification, suggestions, and prevention require workflow review.');
    case '3.3.2':
      return facts.formControlCount === 0
        ? notApplicable('No form controls were detected.')
        : pass('Form controls were covered by automated label checks with no mapped failures.');
    case '4.1.1':
      return pass('No parser-level failures were detected by configured rules.');
    case '4.1.2':
      return facts.interactiveCount === 0 && facts.nonTextCount === 0
        ? notApplicable('No name/role/value candidates were detected.')
        : pass('Name, role, and value candidates had no mapped scanner failures.');
    case '4.1.3':
      return facts.statusMessageCandidateCount === 0
        ? notApplicable('No status message candidates were detected.')
        : manualReview('Status message announcements require assistive-technology review.');
    default:
      return notTested('No scanner coverage is configured for this criterion.');
  }
}

function analyzeHtml(html: string | undefined, page?: Pick<PageRef, 'title' | 'path'>): HtmlFacts {
  if (!html) return emptyFacts(false, Boolean(page?.title || page?.path));

  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const body = doc.body ?? doc;
  const text = (body.textContent ?? '').replace(/\s+/g, ' ').trim();
  const qs = (selector: string): number => body.querySelectorAll(selector).length;
  const qsa = (selector: string): Element[] => Array.from(body.querySelectorAll(selector));
  const title = page?.title ?? doc.querySelector('title')?.textContent ?? page?.path;

  const formControlSelector = 'input:not([type="hidden"]), select, textarea, button, [contenteditable="true"]';
  const linkCount = qs('a[href]');
  const formControlCount = qs(formControlSelector);
  const interactiveExtras = qs('[tabindex], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"]');
  const imageCount = qs('img, svg[role="img"], canvas, [role="img"]');
  const mediaCount = qs('audio, video, iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="kaltura"]');
  const audioCount = qs('audio');
  const structureCount = qs('h1, h2, h3, h4, h5, h6, table, ol, ul, dl, figure, label, fieldset');
  const headingOrLabelCount = qs('h1, h2, h3, h4, h5, h6, label, [aria-label], [aria-labelledby]');
  const movingOrTimingCount = qs('marquee, blink, video[autoplay], audio[autoplay], [style*="animation"], [style*="transition"], meta[http-equiv="refresh" i]');
  const hoverFocusCandidateCount = qs('[onmouseover], [onmouseenter], [onfocus], [aria-expanded], [aria-haspopup]');
  const statusMessageCandidateCount = qs('[aria-live], [role="status"], [role="alert"], [role="log"], [role="progressbar"]');
  const pointerCandidateCount = qs('[onclick], [onpointerdown], [onpointerup], [ontouchstart], [ontouchend], button, a[href], input, select, textarea');
  const inlineColorCandidateCount = qsa('[style]').filter((el) => {
    const style = el.getAttribute('style') ?? '';
    return /\b(color|background|border)\s*:/i.test(style);
  }).length;
  const hasAutocompleteInput = qsa('input, textarea, select').some((el) => {
    const autocomplete = el.getAttribute('autocomplete');
    return Boolean(autocomplete && autocomplete !== 'off');
  });

  return {
    hasHtml: true,
    nonTextCount: imageCount + mediaCount + qs('object, embed, math, mjx-container'),
    imageCount,
    mediaCount,
    audioCount,
    formControlCount,
    linkCount,
    interactiveCount: linkCount + formControlCount + interactiveExtras,
    structureCount,
    headingOrLabelCount,
    movingOrTimingCount,
    pointerCandidateCount,
    hoverFocusCandidateCount,
    statusMessageCandidateCount,
    inlineColorCandidateCount,
    sensoryTextCandidateCount: /\b(left|right|above|below|color|shape|size|red|green|blue|sound|click the)\b/i.test(text) ? 1 : 0,
    textLength: text.length,
    hasPageTitle: Boolean(title && title.trim()),
    hasLanguage: Boolean(doc.documentElement.getAttribute('lang') || body.querySelector('[lang]')),
    hasAutocompleteInput,
    hasMotionCandidate: qs('[ondevicemotion], [ondeviceorientation]') > 0,
    hasAccessKeyOrShortcut: qs('[accesskey], [data-shortcut], [aria-keyshortcuts]') > 0,
  };
}

function emptyFacts(hasHtml: boolean, hasPageTitle: boolean): HtmlFacts {
  return {
    hasHtml,
    nonTextCount: 0,
    imageCount: 0,
    mediaCount: 0,
    audioCount: 0,
    formControlCount: 0,
    linkCount: 0,
    interactiveCount: 0,
    structureCount: 0,
    headingOrLabelCount: 0,
    movingOrTimingCount: 0,
    pointerCandidateCount: 0,
    hoverFocusCandidateCount: 0,
    statusMessageCandidateCount: 0,
    inlineColorCandidateCount: 0,
    sensoryTextCandidateCount: 0,
    textLength: 0,
    hasPageTitle,
    hasLanguage: false,
    hasAutocompleteInput: false,
    hasMotionCandidate: false,
    hasAccessKeyOrShortcut: false,
  };
}

function pass(applicabilityReason: string): Pick<WcagCriterionResult, 'status' | 'applicabilityReason' | 'source'> {
  return { status: 'pass', applicabilityReason, source: 'scanner' };
}

function manualReview(applicabilityReason: string): Pick<WcagCriterionResult, 'status' | 'applicabilityReason' | 'source'> {
  return { status: 'manual_review', applicabilityReason, source: 'scanner' };
}

function notApplicable(applicabilityReason: string): Pick<WcagCriterionResult, 'status' | 'applicabilityReason' | 'source'> {
  return { status: 'not_applicable', applicabilityReason, source: 'scanner' };
}

function notTested(applicabilityReason: string): Pick<WcagCriterionResult, 'status' | 'applicabilityReason' | 'source'> {
  return { status: 'not_tested', applicabilityReason, source: 'not_tested' };
}

function criterionFailCoveredByException(
  criterion: WcagCriterionResult,
  verifiedExceptionIds: Set<string>,
  verifiedEvidenceRefs: Set<string>,
): boolean {
  const failingEvidence = criterion.evidence.filter((item) => item.severity !== 'info');
  return failingEvidence.length > 0 && failingEvidence.every((item) => (
    (item.exceptionId !== undefined && verifiedExceptionIds.has(item.exceptionId))
      || verifiedEvidenceRefs.has(item.findingId)
  ));
}

export function criterionById(id: string): WcagCriterionDefinition | undefined {
  return wcag21AASuccessCriteria.find((criterion) => criterion.id === id);
}
