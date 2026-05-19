import type { LLMClient } from '../ai/llm-client.js';

/**
 * Shared types for the strategy layer. Strategies are the LLM-assisted phase
 * that runs after deterministic rule fixes in fix.ts. They are pure:
 * html -> html + reports.
 */

export interface StrategyContext {
  /** Page hostname, e.g. "dev.libretexts.org". Used for building absolute URLs. */
  hostname: string;
  /** CXone page id if known. */
  pageId?: number;
  /** CXone page path if known. */
  pagePath?: string;
  /**
   * Optional LLM client. Strategies that need one will lazily construct
   * `new LLMClient()` when this is absent. Pass one explicitly to reuse
   * a single client across strategies (usage tracking etc.).
   */
  llm?: LLMClient;
  /**
   * Maximum total LLM calls allowed *across all strategies in a run*. When
   * exceeded, subsequent LLM work is skipped and the report notes
   * "budget exhausted".
   */
  maxLlmCalls?: number;
}

export interface StrategyReport {
  strategyId: string;
  fixesApplied: string[];
  errors: string[];
  llmCalls: number;
}

export interface Strategy {
  id: string;
  description: string;
  apply(doc: Document, ctx: StrategyContext): Promise<StrategyReport>;
}

/**
 * Mutable bookkeeping passed from the runner into each strategy. Strategies
 * call `budget.consume()` before an LLM call and should check
 * `budget.exhausted` before even preparing a prompt.
 *
 * This is internal to the runner; strategies receive a `StrategyContext`
 * publicly but may access this via an augmented context shape built by the
 * runner. Keeping it separate makes the public API simple.
 */
export interface StrategyBudget {
  readonly limit: number;
  used: number;
  readonly exhausted: boolean;
  consume(): boolean;
}

export interface InternalStrategyContext extends StrategyContext {
  budget: StrategyBudget;
}
