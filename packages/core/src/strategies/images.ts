import { plan as planImage, handlers as imageHandlers } from '../image-planner/index.js';
import type { PlannerInput } from '../image-planner/index.js';
import { BaseStrategy, errorMessage } from './base.js';
import type { InternalStrategyContext, StrategyReport } from './types.js';

/**
 * ImageStrategy
 *
 * For each `<img>` with a present `alt` attribute, ask the image planner to
 * classify the image and choose a strategy id. Dispatch to the concrete
 * handler in `imageHandlers`.
 *
 * Processing gate (an image is a candidate if ANY of):
 *   1. Generic alt text ("image", "photo", "diagram", …)
 *   2. Empty alt on a visually informational image (large, or a URL that
 *      hints at a diagram)
 *   3. Empty alt + planner confidently classifies as decorative
 *      (CSS class, container class, role=presentation, tiny size signals)
 *
 * Images missing the `alt` attribute entirely fall to the img-alt rule layer.
 *
 * The planner decides WHAT to do with each candidate; the handler does the
 * actual DOM mutation.
 */
export class ImageStrategy extends BaseStrategy {
  readonly id = 'images';
  readonly description =
    'Classify each image, then dispatch to the matching remediation handler.';

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

    const pageContext = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();

    for (const img of imgs) {
      const alt = img.getAttribute('alt');
      const src = img.getAttribute('src') ?? '';
      if (!src) continue;
      if (alt === null) continue; // rule layer handles missing alt

      const absoluteSrc = absoluteUrl(src, ctx.hostname);
      const input: PlannerInput = {
        rawSrc: src,
        absoluteSrc,
        alt,
        width: parseIntOrNull(img.getAttribute('width')) ?? undefined,
        height: parseIntOrNull(img.getAttribute('height')) ?? undefined,
        role: img.getAttribute('role'),
        figcaption: findFigcaptionNear(img) ?? undefined,
        cssClass: img.getAttribute('class') ?? undefined,
        containerClass: findContainerClass(img) ?? undefined,
        contextExcerpt: pageContext.slice(0, 500),
      };

      const decision = planImage(input);

      // Three independent gates; any true → process this image.
      const needsAltSays = this.needsAlt(img, alt, src);
      const decorativeOverride = alt === '' && decision.kind === 'decorative';
      if (!needsAltSays && !decorativeOverride) continue;

      // decorative-mark costs no budget; everything else does.
      const needsLlm = decision.strategy !== 'decorative-mark';
      if (needsLlm) {
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
      }

      const handler = imageHandlers[decision.strategy];
      const label = `[${decision.strategy} kind=${decision.kind} conf=${decision.confidence.toFixed(2)}]`;

      try {
        if (handler) {
          const result = await handler(img, {
            doc,
            llm: needsLlm ? this.getLlm(ctx) : undefined,
            absoluteSrc,
            pageContext,
          });
          if (result.ok) {
            report.fixesApplied.push(
              `${label} ${result.mutation ?? 'applied'} src=${truncate(src, 40)}`,
            );
          } else if (result.error) {
            report.errors.push(`${this.id}:${decision.strategy} ${result.error}`);
          }
        } else if (decision.strategy === 'manual-review') {
          report.errors.push(
            `${this.id}:manual-review (conf=${decision.confidence.toFixed(2)}) src=${truncate(src, 40)}`,
          );
        } else {
          // chart-longdesc / ocr-text — handlers not yet implemented.
          report.errors.push(
            `${this.id}:${decision.strategy} not yet implemented src=${truncate(src, 40)}`,
          );
        }
      } catch (err) {
        report.errors.push(`${this.id}:${decision.strategy} ${errorMessage(err)}`);
      }
    }
  }

  private needsAlt(img: HTMLImageElement, alt: string | null, src: string): boolean {
    if (alt === null) return false;
    const trimmed = alt.trim().toLowerCase();
    if (trimmed && ImageStrategy.GENERIC_ALTS.has(trimmed)) return true;
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
  if (/^(https?|data|blob):/i.test(src)) return src;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `https://${hostname}${src}`;
  return `https://${hostname}/${src}`;
}

function findFigcaptionNear(img: HTMLElement): string | null {
  let node: HTMLElement | null = img.parentElement;
  while (node) {
    if (node.tagName === 'FIGURE') {
      const cap = node.querySelector('figcaption');
      const text = cap?.textContent?.trim();
      return text || null;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * First non-empty `class` attribute walking up from the image.
 * Feeds the planner's container-class signal (banner/header/logo/icon →
 * chrome intent).
 */
function findContainerClass(el: HTMLElement): string | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const c = node.getAttribute('class');
    if (c && c.trim()) return c;
    node = node.parentElement;
  }
  return null;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
