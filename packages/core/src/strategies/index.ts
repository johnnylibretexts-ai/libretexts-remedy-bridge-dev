/**
 * Strategy layer public entrypoint.
 *
 * See /docs/PIPELINE.md — this is the LLM-assisted phase of the remediation
 * pipeline, running after the deterministic `rules/*` fixes. Ported in shape
 * from the sibling project's `RemediationStrategyRunner`.
 */

export type {
  Strategy,
  StrategyContext,
  StrategyReport,
  StrategyBudget,
  InternalStrategyContext,
} from './types.js';

export { BaseStrategy } from './base.js';
export { HeadingStrategy } from './headings.js';
export { ImageStrategy } from './images.js';
export { LinkStrategy } from './links.js';
export { ContrastStrategy } from './contrast.js';
export { StrategyRunner } from './runner.js';

// Re-export the contrast helpers so downstream strategies and tests can reuse
// them without drilling into the ai/ directory.
export {
  parseCssColor,
  relativeLuminance,
  contrastRatio,
  nearestPassingColor,
  rgbToHex,
  type RGB,
} from '../ai/contrast-helpers.js';
