/**
 * Image planner — type-aware routing for image remediation.
 *
 * The existing `ImageStrategy` is kind-agnostic: every image that needs alt
 * text goes through the same vision-LLM path. Real textbook content has
 * categorically different image types (a flowchart needs stepwise list
 * markup; a decorative flourish needs `alt=""` + `role="presentation"`; a
 * screenshot of text needs OCR, not a description). This module classifies
 * images deterministically first, then routes each to a kind-specific
 * strategy.
 *
 * Scaffold only — no vision calls yet, no pipeline wiring. Strategy handlers
 * are referenced by id so they can be filled in incrementally.
 */

/** Categorical image types we plan differently for. */
export type ImageKind =
  /** Stepwise diagram — map to `<figure><ol><li>step</li>…</ol></figure>`. */
  | 'flowchart'
  /** Chart / graph with data — long description + optional data table. */
  | 'chart'
  /** Chemistry / physics / math diagram (mathpix, chemdraw, etc.). */
  | 'diagram'
  /** Real-world photograph — descriptive alt text via vision. */
  | 'photograph'
  /** Screenshot or image-of-text — OCR, not description. */
  | 'screenshot-of-text'
  /** Ornamental / spacer / brand flourish — mark decorative. */
  | 'decorative'
  /** Classifier couldn't make a confident call — route to manual review. */
  | 'unknown';

/** Heuristic signals the classifier produced for this image. */
export interface ClassificationSignal {
  /** Which signal fired (e.g. "url-pattern:mathpix", "size:tiny"). */
  source: string;
  /** Which kind this signal votes for. */
  votes: ImageKind;
  /** 0–1 confidence contribution. Sum across signals feeds the final score. */
  weight: number;
  /** Human-readable rationale; surfaced in reports. */
  rationale: string;
}

/** Input to planner.plan(). A normalized view of one image + DOM context. */
export interface PlannerInput {
  /** Absolute URL (protocol + host) — already resolved by caller. */
  absoluteSrc: string;
  /** Raw src attribute value (may be relative). */
  rawSrc: string;
  /** Current alt attribute, if any. `null` means attribute absent. */
  alt: string | null;
  /** Parsed width attribute or naturalWidth, if known. */
  width?: number;
  /** Parsed height attribute or naturalHeight, if known. */
  height?: number;
  /** Role attribute value. `'presentation'` / `'none'` are decorative signals. */
  role?: string | null;
  /** Text of an ancestor `<figcaption>`, if present. */
  figcaption?: string;
  /**
   * A short excerpt of the surrounding body text (prev + next siblings),
   * useful for context-aware alt generation later. Planner-level classifier
   * only uses it for a couple of keyword checks.
   */
  contextExcerpt?: string;
}

/** What strategy a planner decision routes to. These are stable string ids. */
export type PlannerStrategyId =
  | 'alt-text-vision' // photograph, diagram — describe via vision
  | 'flowchart-ol' // generate ordered-list flowchart markup
  | 'chart-longdesc' // chart/graph — long description + data table
  | 'ocr-text' // screenshot-of-text — OCR to real text or alt
  | 'decorative-mark' // set alt="" + role="presentation", no LLM
  | 'manual-review'; // unknown / low-confidence — surface for human

/** Output of planner.plan() — a routing decision for one image. */
export interface PlannerOutput {
  kind: ImageKind;
  /** 0–1. Below `minConfidence`, strategy routes to `manual-review`. */
  confidence: number;
  strategy: PlannerStrategyId;
  /** Every signal that fired during classification, for auditability. */
  signals: ClassificationSignal[];
  /** Optional hint to feed the strategy handler. */
  hints?: Record<string, unknown>;
}

/** Planner tuning knobs. Safe defaults live in defaultPlannerConfig(). */
export interface PlannerConfig {
  /** If aggregated confidence < this, fall back to manual-review. */
  minConfidence: number;
  /** Max pixel dimension for "decorative-sized" image. */
  decorativePxThreshold: number;
  /** Min pixel dimension to consider an image "informational by size". */
  informationalPxThreshold: number;
}

export function defaultPlannerConfig(): PlannerConfig {
  return {
    minConfidence: 0.55,
    decorativePxThreshold: 32,
    informationalPxThreshold: 400,
  };
}
