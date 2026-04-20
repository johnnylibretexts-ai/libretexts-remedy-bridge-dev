import type {
  ClassificationSignal,
  ImageKind,
  PlannerConfig,
  PlannerInput,
} from './types.js';
import { defaultPlannerConfig } from './types.js';

/**
 * Deterministic image classifier.
 *
 * No LLM, no vision calls — only URL patterns, dimensions, DOM context.
 * Returns an ordered list of signals that voted for candidate kinds plus
 * the aggregated winner. Ties break toward the more-specific kind
 * (flowchart > diagram > photograph > decorative > unknown).
 */

interface UrlPattern {
  pattern: RegExp;
  kind: ImageKind;
  weight: number;
  source: string;
  rationale: string;
}

const URL_PATTERNS: UrlPattern[] = [
  {
    pattern: /mathpix|chemdraw|smiles|marvinjs/i,
    kind: 'diagram',
    weight: 0.6,
    source: 'url-pattern:chem-tool',
    rationale: 'URL indicates a chemistry/math rendering tool',
  },
  {
    pattern: /flowchart|flow[-_]?diagram|workflow/i,
    kind: 'flowchart',
    weight: 0.7,
    source: 'url-pattern:flowchart',
    rationale: 'URL mentions flowchart or workflow',
  },
  {
    pattern: /chart|graph|plot|histogram|scatter|barchart|piechart/i,
    kind: 'chart',
    weight: 0.55,
    source: 'url-pattern:chart',
    rationale: 'URL mentions chart/graph/plot',
  },
  {
    pattern: /screenshot|screen[-_]?shot|screen[-_]?cap/i,
    kind: 'screenshot-of-text',
    weight: 0.55,
    source: 'url-pattern:screenshot',
    rationale: 'URL mentions screenshot',
  },
  {
    pattern: /\b(spacer|divider|bullet|pixel|1x1|transparent|blank)\b/i,
    kind: 'decorative',
    weight: 0.7,
    source: 'url-pattern:decorative',
    rationale: 'URL mentions known decorative patterns',
  },
  {
    pattern: /\.(jpe?g|heic|heif)(\?|$)/i,
    kind: 'photograph',
    weight: 0.35,
    source: 'url-pattern:photo-extension',
    rationale: 'JPEG/HEIC extension weakly suggests a photograph',
  },
];

const CAPTION_FLOWCHART_TERMS = /\b(flow\s*chart|flow\s*diagram|pipeline|workflow|process flow|step-by-step)\b/i;
const CAPTION_CHART_TERMS = /\b(chart|graph|plot|histogram|bar chart|pie chart|scatter)\b/i;

/** Class-name tokens that mark the image itself as decorative. */
const CSS_DECORATIVE_PATTERNS = /\b(decorative|icon|bullet|separator|spacer|bg)\b/i;
/** Container-class tokens that suggest the image sits in chrome (logo, banner...). */
const CONTAINER_DECORATIVE_PATTERNS = /\b(banner|header|logo|icon)\b/i;

/** Aggregate per-kind scores from individual signals. */
function tally(signals: ClassificationSignal[]): Map<ImageKind, number> {
  const out = new Map<ImageKind, number>();
  for (const sig of signals) {
    out.set(sig.votes, (out.get(sig.votes) ?? 0) + sig.weight);
  }
  return out;
}

/**
 * Pick the winning kind. Returns 'unknown' if no signals fired.
 * Tiebreak: the `PRIORITY` order below — more-specific kinds win.
 */
const PRIORITY: ImageKind[] = [
  'flowchart',
  'chart',
  'diagram',
  'screenshot-of-text',
  'photograph',
  'decorative',
  'unknown',
];

function pickWinner(scores: Map<ImageKind, number>): { kind: ImageKind; score: number } {
  if (scores.size === 0) return { kind: 'unknown', score: 0 };
  let best: ImageKind = 'unknown';
  let bestScore = -Infinity;
  for (const kind of PRIORITY) {
    const s = scores.get(kind);
    if (s === undefined) continue;
    if (s > bestScore) {
      best = kind;
      bestScore = s;
    }
  }
  return { kind: best, score: bestScore };
}

/** Normalize aggregated score into 0–1 confidence. */
function normalizeConfidence(score: number): number {
  if (score <= 0) return 0;
  if (score >= 1.4) return 1;
  return score / 1.4;
}

export function classify(
  input: PlannerInput,
  config: PlannerConfig = defaultPlannerConfig(),
): { kind: ImageKind; confidence: number; signals: ClassificationSignal[] } {
  const signals: ClassificationSignal[] = [];

  // 1. Role = presentation/none is an authoritative decorative signal.
  if (input.role === 'presentation' || input.role === 'none') {
    signals.push({
      source: 'attr:role',
      votes: 'decorative',
      weight: 1.2,
      rationale: `role="${input.role}" marks the image as decorative`,
    });
  }

  // 2. Alt="" on a very-small image is a confident decorative signal.
  const maxDim = Math.max(input.width ?? 0, input.height ?? 0);
  if (maxDim > 0 && maxDim <= config.decorativePxThreshold && input.alt === '') {
    signals.push({
      source: 'size:tiny+empty-alt',
      votes: 'decorative',
      weight: 0.8,
      rationale: `image is ${maxDim}px max dimension with alt="" — likely spacer/icon`,
    });
  }

  // 3. URL-pattern matches.
  for (const p of URL_PATTERNS) {
    if (p.pattern.test(input.rawSrc) || p.pattern.test(input.absoluteSrc)) {
      signals.push({
        source: p.source,
        votes: p.kind,
        weight: p.weight,
        rationale: p.rationale,
      });
    }
  }

  // 3b. CSS class on the img itself.
  if (input.cssClass && CSS_DECORATIVE_PATTERNS.test(input.cssClass)) {
    signals.push({
      source: 'css-class:decorative',
      votes: 'decorative',
      weight: 0.7,
      rationale: 'img class token suggests decorative intent',
    });
  }

  // 3c. Container class — nearest-ancestor class carries intent.
  if (input.containerClass && CONTAINER_DECORATIVE_PATTERNS.test(input.containerClass)) {
    signals.push({
      source: 'container-class:decorative',
      votes: 'decorative',
      weight: 0.5,
      rationale: 'ancestor container class suggests chrome/logo/banner',
    });
  }

  // 4. Caption-text heuristics.
  if (input.figcaption) {
    if (CAPTION_FLOWCHART_TERMS.test(input.figcaption)) {
      signals.push({
        source: 'figcaption:flowchart-terms',
        votes: 'flowchart',
        weight: 0.8,
        rationale: 'figcaption mentions flow/workflow/pipeline terminology',
      });
    }
    if (CAPTION_CHART_TERMS.test(input.figcaption)) {
      signals.push({
        source: 'figcaption:chart-terms',
        votes: 'chart',
        weight: 0.6,
        rationale: 'figcaption mentions chart/graph/plot terminology',
      });
    }
  }

  // 5. Large dimension without other signals: default to photograph
  // (weak, so real signals override).
  if (maxDim >= config.informationalPxThreshold) {
    signals.push({
      source: 'size:large',
      votes: 'photograph',
      weight: 0.2,
      rationale: `image is ${maxDim}px max dimension — informational by size`,
    });
  }

  const scores = tally(signals);
  const { kind, score } = pickWinner(scores);
  return { kind, confidence: normalizeConfidence(score), signals };
}
