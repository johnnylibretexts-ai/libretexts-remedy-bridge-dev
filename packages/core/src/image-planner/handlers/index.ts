import type { PlannerStrategyId } from '../types.js';
import type { HandlerFn } from './types.js';
import { decorativeMark } from './decorative-mark.js';
import { flowchartOl } from './flowchart-ol.js';
import { altTextVision } from './alt-text-vision.js';
import { chartLongdesc } from './chart-longdesc.js';
import { ocrText } from './ocr-text.js';

export type { HandlerContext, HandlerResult, HandlerFn } from './types.js';
export { decorativeMark, flowchartOl, altTextVision, chartLongdesc, ocrText };
export { parseFlowchartJson } from './flowchart-ol.js';
export { parseChartJson } from './chart-longdesc.js';
export { markdownToHtml } from './ocr-text.js';

/**
 * Dispatch map from planner strategy id to concrete handler. Strategies
 * without a concrete handler yet are undefined; callers treat that as
 * "route to manual review" (a finding surfaced, not auto-fixed).
 */
export const handlers: Partial<Record<PlannerStrategyId, HandlerFn>> = {
  'decorative-mark': decorativeMark,
  'flowchart-ol': flowchartOl,
  'alt-text-vision': altTextVision,
  'chart-longdesc': chartLongdesc,
  'ocr-text': ocrText,
};
