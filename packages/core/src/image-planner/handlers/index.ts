import type { PlannerStrategyId } from '../types.js';
import type { HandlerFn } from './types.js';
import { decorativeMark } from './decorative-mark.js';
import { flowchartOl } from './flowchart-ol.js';

export type { HandlerContext, HandlerResult, HandlerFn } from './types.js';
export { decorativeMark, flowchartOl };
export { parseFlowchartJson } from './flowchart-ol.js';

/**
 * Dispatch map from planner strategy id to concrete handler. Strategies
 * without a concrete handler yet are undefined; callers treat that as
 * "route to manual review" (a finding surfaced, not auto-fixed).
 */
export const handlers: Partial<Record<PlannerStrategyId, HandlerFn>> = {
  'decorative-mark': decorativeMark,
  'flowchart-ol': flowchartOl,
};
