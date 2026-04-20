import { JSDOM } from 'jsdom';
import { ContrastStrategy } from './contrast.js';
import { HeadingStrategy } from './headings.js';
import { ImageStrategy } from './images.js';
import { LinkStrategy } from './links.js';
import type {
  InternalStrategyContext,
  Strategy,
  StrategyBudget,
  StrategyContext,
  StrategyReport,
} from './types.js';

/**
 * StrategyRunner
 *
 * Applies a list of Strategy instances to an HTML string in order. Mirrors
 * `RemediationStrategyRunner` in the sibling project's
 * accessibility_strategies.py.
 *
 * The runner is pure: input html -> output html + reports. It does not
 * persist anything and does not call CXone. Wiring into the full pipeline
 * (fix.ts / pipeline.ts) is done elsewhere.
 *
 * The strategy order is deliberate — later strategies may rely on
 * transformations earlier ones made. See /docs/PIPELINE.md.
 */
export class StrategyRunner {
  private readonly strategies: Strategy[];

  constructor(strategies?: Strategy[]) {
    this.strategies =
      strategies && strategies.length > 0
        ? strategies
        : [
            new HeadingStrategy(),
            new ImageStrategy(),
            new LinkStrategy(),
            new ContrastStrategy(),
          ];
  }

  async run(
    html: string,
    ctx: StrategyContext,
  ): Promise<{ html: string; reports: StrategyReport[] }> {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
    const doc = dom.window.document;

    const budget = createBudget(ctx.maxLlmCalls ?? 20);
    const internal: InternalStrategyContext = { ...ctx, budget };

    const reports: StrategyReport[] = [];
    for (const strategy of this.strategies) {
      let report: StrategyReport;
      try {
        report = await strategy.apply(doc, internal);
      } catch (err) {
        // BaseStrategy normally swallows errors, but a custom Strategy impl
        // might not — make the runner the last line of defense.
        report = {
          strategyId: strategy.id,
          fixesApplied: [],
          errors: [`${strategy.id}: ${errorMessage(err)}`],
          llmCalls: 0,
        };
      }
      reports.push(report);
    }

    const afterHtml = doc.body.innerHTML;
    return { html: afterHtml, reports };
  }
}

function createBudget(limit: number): StrategyBudget {
  let used = 0;
  return {
    get limit() {
      return limit;
    },
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
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
