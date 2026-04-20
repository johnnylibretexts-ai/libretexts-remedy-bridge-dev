import { AltTextGenerator } from '../ai/alt-text.js';
import { BaseStrategy, errorMessage } from './base.js';
import type { InternalStrategyContext, StrategyReport } from './types.js';

/**
 * ImageStrategy
 *
 * Generates alt text for `<img>` that has `alt=""` but looks informational
 * (large, or src hints at a diagram/chart) and for `<img>` with suspicious
 * generic alt text. Defers to the existing `AltTextGenerator` which already
 * handles the vision call shape.
 *
 * Runs *after* the rules/img-alt.ts fix — the rule targets missing alt;
 * this strategy targets the "alt='' but probably informational" subset that
 * the rule flags but doesn't auto-fix.
 */
export class ImageStrategy extends BaseStrategy {
  readonly id = 'images';
  readonly description =
    'Generate alt text for images with empty or generic alt on large/informational images.';

  private static readonly GENERIC_ALTS = new Set([
    'image',
    'picture',
    'photo',
    'graphic',
    'diagram',
    'chart',
    'graph',
    'icon',
    'img',
    'pic',
    'photograph',
    'untitled',
    'no description',
  ]);

  protected async run(
    doc: Document,
    ctx: InternalStrategyContext,
    report: StrategyReport,
  ): Promise<void> {
    const imgs = Array.from(doc.querySelectorAll('img')) as HTMLImageElement[];
    if (imgs.length === 0) return;

    let generator: AltTextGenerator | null = null;
    const pageContext = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();

    for (const img of imgs) {
      const alt = img.getAttribute('alt');
      const src = img.getAttribute('src') ?? '';
      if (!src) continue;

      const needsAlt = this.needsAlt(img, alt, src);
      if (!needsAlt) continue;
      if (ctx.budget.exhausted) {
        if (!report.errors.some((e) => e.includes('budget exhausted'))) {
          report.errors.push(`${this.id}: budget exhausted`);
        }
        break;
      }

      if (!ctx.budget.consume()) {
        report.errors.push(`${this.id}: budget exhausted`);
        break;
      }
      report.llmCalls += 1;

      try {
        if (!generator) {
          generator = new AltTextGenerator({ client: this.getLlm(ctx) });
        }
        const absolute = absoluteUrl(src, ctx.hostname);
        const newAlt = await generator.generate(absolute, pageContext);
        img.setAttribute('alt', newAlt);
        report.fixesApplied.push(
          `Set alt on img src=${truncate(src, 60)}: "${truncate(newAlt, 60)}"`,
        );
      } catch (err) {
        report.errors.push(`${this.id}: ${errorMessage(err)}`);
      }
    }
  }

  private needsAlt(img: HTMLImageElement, alt: string | null, src: string): boolean {
    // Missing attribute: leave to the rule layer; we don't duplicate that.
    if (alt === null) return false;

    const trimmed = alt.trim().toLowerCase();

    // Generic alt on any image: replace.
    if (trimmed && ImageStrategy.GENERIC_ALTS.has(trimmed)) return true;

    // Empty alt: only replace if the image looks informational.
    if (trimmed === '') return this.looksInformational(img, src);

    return false;
  }

  private looksInformational(img: HTMLImageElement, src: string): boolean {
    const url = src.toLowerCase();
    if (/mathpix|chemdraw|smiles|structure|diagram|figure|chart|graph|equation|formula/.test(url)) {
      return true;
    }
    const w = parseIntOrNull(img.getAttribute('width')) ?? 0;
    const h = parseIntOrNull(img.getAttribute('height')) ?? 0;
    if (w >= 400 || h >= 400) return true;
    return false;
  }
}

function parseIntOrNull(s: string | null): number | null {
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function absoluteUrl(src: string, hostname: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `https://${hostname}${src}`;
  return `https://${hostname}/${src}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
