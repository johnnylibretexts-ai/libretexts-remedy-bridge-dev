import { LLMClient } from '../ai/llm-client.js';
import type {
  InternalStrategyContext,
  Strategy,
  StrategyContext,
  StrategyReport,
} from './types.js';

/**
 * Common plumbing for strategies: a fresh report, lazy LLM client, a guarded
 * `callLlm` helper that enforces the shared budget and catches exceptions so
 * an LLM hiccup never takes down a strategy.
 *
 * Subclasses implement `run()` which receives a typed context and the report
 * to mutate.
 */
export abstract class BaseStrategy implements Strategy {
  abstract readonly id: string;
  abstract readonly description: string;

  async apply(doc: Document, ctx: StrategyContext): Promise<StrategyReport> {
    const internal = asInternal(ctx);
    const report: StrategyReport = {
      strategyId: this.id,
      fixesApplied: [],
      errors: [],
      llmCalls: 0,
    };
    try {
      await this.run(doc, internal, report);
    } catch (err) {
      report.errors.push(`${this.id}: ${errorMessage(err)}`);
    }
    return report;
  }

  protected abstract run(
    doc: Document,
    ctx: InternalStrategyContext,
    report: StrategyReport,
  ): Promise<void>;

  /**
   * Get or lazily construct an LLM client. Subclasses should call this only
   * when they *actually* need one so contrast-only / purely-deterministic
   * runs never touch the network.
   */
  protected getLlm(ctx: InternalStrategyContext): LLMClient {
    if (!ctx.llm) ctx.llm = new LLMClient();
    return ctx.llm;
  }

  /**
   * Run a chat request under the shared budget. Returns null (never throws)
   * if the budget is exhausted or the call fails; the caller decides how to
   * fall back. Errors are appended to the report.
   */
  protected async callChat(
    ctx: InternalStrategyContext,
    report: StrategyReport,
    prompt: string,
    opts: { maxTokens?: number; temperature?: number; system?: string } = {},
  ): Promise<string | null> {
    if (ctx.budget.exhausted) {
      if (!report.errors.some((e) => e.includes('budget exhausted'))) {
        report.errors.push(`${this.id}: budget exhausted`);
      }
      return null;
    }
    if (!ctx.budget.consume()) {
      report.errors.push(`${this.id}: budget exhausted`);
      return null;
    }
    report.llmCalls += 1;
    try {
      const client = this.getLlm(ctx);
      const messages = [];
      if (opts.system) messages.push({ role: 'system' as const, content: opts.system });
      messages.push({ role: 'user' as const, content: prompt });
      const text = await client.chat({
        messages,
        maxTokens: opts.maxTokens ?? 120,
        temperature: opts.temperature ?? 0.3,
      });
      return text.trim();
    } catch (err) {
      report.errors.push(`${this.id}: ${errorMessage(err)}`);
      return null;
    }
  }
}

function asInternal(ctx: StrategyContext): InternalStrategyContext {
  if ((ctx as InternalStrategyContext).budget) {
    return ctx as InternalStrategyContext;
  }
  // A caller invoked a strategy's `apply` directly without going through the
  // runner. Give them an ad-hoc budget so the call still works.
  const limit = ctx.maxLlmCalls ?? 20;
  let used = 0;
  const budget = {
    limit,
    get used() {
      return used;
    },
    set used(v: number) {
      used = v;
    },
    get exhausted() {
      return used >= limit;
    },
    consume() {
      if (used >= limit) return false;
      used += 1;
      return true;
    },
  };
  return { ...ctx, budget };
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
