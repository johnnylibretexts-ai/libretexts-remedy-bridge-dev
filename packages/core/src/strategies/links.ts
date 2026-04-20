import { BaseStrategy } from './base.js';
import type { InternalStrategyContext, StrategyReport } from './types.js';

/**
 * LinkStrategy
 *
 * Rewrites non-descriptive anchor text ("click here", "read more", ...) using
 * surrounding sentence context. The rules layer already handles the simple
 * bare-URL case deterministically; this strategy owns the "generic phrase"
 * case where a human (or LLM) needs to read the context to produce good text.
 *
 * Port of `LinkRemediation._fix_generic_links` in the Python prior-art.
 */
export class LinkStrategy extends BaseStrategy {
  readonly id = 'links';
  readonly description =
    'Rewrite generic anchor text ("click here", "read more", ...) using surrounding context.';

  private static readonly GENERIC_TEXTS = new Set([
    'click here',
    'here',
    'read more',
    'more',
    'learn more',
    'details',
    'link',
    'this link',
    'this',
    'go',
    'more details',
    'more info',
    'more information',
    'view',
    'view more',
    'see more',
    'continue',
    'continue reading',
  ]);

  private static readonly SIMPLE_REPLACEMENTS: Record<string, string> = {
    'click here': 'View details',
    'read more': 'Read more about this topic',
    'learn more': 'Learn more about this topic',
  };

  protected async run(
    doc: Document,
    ctx: InternalStrategyContext,
    report: StrategyReport,
  ): Promise<void> {
    const anchors = Array.from(doc.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    for (const a of anchors) {
      if (a.getAttribute('aria-label')) continue;
      const rawText = (a.textContent ?? '').trim();
      const text = rawText.toLowerCase();
      if (!LinkStrategy.GENERIC_TEXTS.has(text)) continue;

      const href = a.getAttribute('href') ?? '';
      const context = this.surroundingContext(a, rawText);

      let newText: string | null = null;

      if (context && !ctx.budget.exhausted) {
        const prompt =
          `A hyperlink currently says "${rawText}" and sits inside this context: ` +
          `"${context}". The link points to: ${href || '(no href)'}\n\n` +
          'Produce a short (under 60 characters) descriptive replacement. ' +
          'Respond with ONLY the new link text — no quotes, no HTML.';
        const response = await this.callChat(ctx, report, prompt, {
          maxTokens: 40,
          temperature: 0.3,
        });
        if (response) {
          const cleaned = cleanLinkText(response);
          if (cleaned && cleaned.length <= 80) newText = cleaned;
        }
      }

      if (!newText) newText = this.fallback(text, href);
      if (!newText || newText === rawText) continue;

      a.textContent = newText;
      report.fixesApplied.push(
        `Rewrote link "${rawText}" -> "${truncate(newText, 60)}"`,
      );
    }
  }

  private surroundingContext(a: HTMLAnchorElement, linkText: string): string {
    const parent = a.parentElement;
    if (!parent) return '';
    if (parent.tagName === 'BODY') return '';
    const full = (parent.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!full) return '';
    const stripped = full.replace(linkText, '').trim();
    if (!stripped) return '';
    return stripped.length > 240 ? stripped.slice(0, 237) + '…' : stripped;
  }

  private fallback(text: string, href: string): string | null {
    if (href.startsWith('http')) {
      const m = href.match(/https?:\/\/(?:www\.)?([^/]+)/);
      if (m) return `Visit ${m[1]}`;
    }
    if (LinkStrategy.SIMPLE_REPLACEMENTS[text]) {
      return LinkStrategy.SIMPLE_REPLACEMENTS[text]!;
    }
    return 'View related information';
  }
}

function cleanLinkText(raw: string): string {
  return raw
    .split(/\r?\n/)[0]!
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
