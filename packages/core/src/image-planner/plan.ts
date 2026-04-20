import type {
  ImageKind,
  PlannerConfig,
  PlannerInput,
  PlannerOutput,
  PlannerStrategyId,
} from './types.js';
import { defaultPlannerConfig } from './types.js';
import { classify } from './classify.js';

/**
 * Maps a classified image kind to a strategy handler id. The actual
 * handlers are not yet implemented — this module is the scaffold that
 * lets us wire them in incrementally without touching the caller.
 */
const STRATEGY_BY_KIND: Record<ImageKind, PlannerStrategyId> = {
  flowchart: 'flowchart-ol',
  chart: 'chart-longdesc',
  diagram: 'alt-text-vision',
  photograph: 'alt-text-vision',
  'screenshot-of-text': 'ocr-text',
  decorative: 'decorative-mark',
  unknown: 'manual-review',
};

/**
 * Plan a single image. Deterministic — no LLM, no network.
 *
 * Callers:
 * - Existing `ImageStrategy` will, in a follow-up wiring, call `plan()`
 *   for each `<img>` it would otherwise describe, then dispatch to the
 *   strategy id returned. Low-confidence decisions fall back to
 *   `manual-review` which the pipeline surfaces as a finding rather
 *   than auto-fixing.
 */
export function plan(
  input: PlannerInput,
  config: PlannerConfig = defaultPlannerConfig(),
): PlannerOutput {
  const { kind, confidence, signals } = classify(input, config);

  let strategy = STRATEGY_BY_KIND[kind];
  if (confidence < config.minConfidence) {
    strategy = 'manual-review';
  }

  const hints: Record<string, unknown> = {};
  if (input.figcaption) hints.figcaption = input.figcaption;
  if (input.alt !== null && input.alt !== '') hints.existingAlt = input.alt;

  return {
    kind: confidence < config.minConfidence ? 'unknown' : kind,
    confidence,
    strategy,
    signals,
    hints: Object.keys(hints).length ? hints : undefined,
  };
}
