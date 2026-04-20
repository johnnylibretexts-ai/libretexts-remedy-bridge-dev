import {
  contrastRatio,
  nearestPassingColor,
  parseCssColor,
  rgbToHex,
  type RGB,
} from '../ai/contrast-helpers.js';
import { BaseStrategy } from './base.js';
import type { InternalStrategyContext, StrategyReport } from './types.js';

/**
 * ContrastStrategy
 *
 * axe-core running under jsdom cannot evaluate color contrast because jsdom
 * has no layout engine or canvas. So we do this ourselves, limited to inline
 * `style="color:..."` / `style="background-color:..."` pairs — the common
 * LibreTexts case where a page author inlined a colored word or callout box.
 *
 * For each element with an inline color (and optionally an inline
 * background-color), we compute the WCAG contrast ratio against either the
 * specified background or a default white page background. If the ratio is
 * below 4.5:1, we walk the foreground toward black/white until it passes.
 *
 * This does NOT handle class-based or stylesheet-derived colors — those
 * require a live browser. We leave a note in report.errors for elements that
 * reference only CSS classes (so a human reviewer knows to check them).
 */
export class ContrastStrategy extends BaseStrategy {
  readonly id = 'contrast';
  readonly description =
    'Check WCAG contrast on inline-styled text and nudge foreground colors that fail 4.5:1.';

  protected async run(
    doc: Document,
    _ctx: InternalStrategyContext,
    report: StrategyReport,
  ): Promise<void> {
    const elements = Array.from(doc.querySelectorAll<HTMLElement>('[style]'));
    // Also flag text wrapped in a class-only colored element, as a review hint.
    const classOnlyColorHints = new Set<string>();
    for (const el of elements) {
      const style = el.getAttribute('style') ?? '';
      const fgRaw = readStyleValue(style, 'color');
      const bgRaw = readStyleValue(style, 'background-color');

      // Only meaningful on elements that actually contain text content.
      const text = (el.textContent ?? '').trim();
      if (!text) continue;

      // Skip elements whose only children are other elements (the contrast
      // that matters is where the text actually lives).
      if (!hasDirectTextChild(el)) continue;

      const fg = parseCssColor(fgRaw);
      const effectiveBg = parseCssColor(bgRaw) ?? this.inheritedBg(el) ?? DEFAULT_WHITE_BG;

      if (!fg) {
        // No inline color. If there's a class that suggests color, flag once.
        const cls = el.className;
        if (typeof cls === 'string' && /\b(color|text-|fg-|warn|alert|note)\b/i.test(cls)) {
          classOnlyColorHints.add(cls);
        }
        continue;
      }

      const ratio = contrastRatio(fg, effectiveBg);
      if (ratio >= 4.5) continue;

      const fixed = nearestPassingColor(fg, effectiveBg, 4.5);
      const newColor = rgbToHex(fixed);
      const patched = replaceStyleValue(style, 'color', newColor);
      el.setAttribute('style', patched);
      report.fixesApplied.push(
        `Adjusted inline color ${rgbToHex(fg)} -> ${newColor} on <${el.tagName.toLowerCase()}> ` +
          `(was ratio ${ratio.toFixed(2)}:1, target 4.5:1)`,
      );
    }

    for (const cls of classOnlyColorHints) {
      report.errors.push(
        `${this.id}: element(s) with class="${cls}" use stylesheet-derived colors; ` +
          'manual review recommended (jsdom cannot evaluate CSS-class contrast).',
      );
    }
  }

  /**
   * Walk up ancestors looking for an inline background-color so a
   * colored-box wrapper is respected when evaluating its inner text.
   * Returns null if no ancestor has an inline background.
   */
  private inheritedBg(el: HTMLElement): RGB | null {
    let node: HTMLElement | null = el.parentElement;
    while (node) {
      const style = node.getAttribute('style');
      if (style) {
        const bg = readStyleValue(style, 'background-color');
        const rgb = parseCssColor(bg);
        if (rgb) return rgb;
      }
      node = node.parentElement;
    }
    return null;
  }
}

const DEFAULT_WHITE_BG: RGB = { r: 255, g: 255, b: 255 };

/**
 * Read a single CSS property value out of an inline style string.
 * Case-insensitive property match; whitespace-trimmed value; stops at `;`.
 * Returns null if not present.
 */
function readStyleValue(style: string, prop: string): string | null {
  const lower = prop.toLowerCase();
  // Tokenize on `;` and scan. We don't build a real parser — inline styles
  // in CXone content are shallow and well-behaved.
  const parts = style.split(';');
  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    if (name !== lower) continue;
    return part.slice(colon + 1).trim();
  }
  return null;
}

/**
 * Replace a property value in an inline style string. If the property is
 * absent, appends it. Preserves other properties' order and formatting.
 */
function replaceStyleValue(style: string, prop: string, newValue: string): string {
  const lower = prop.toLowerCase();
  const parts = style.split(';').map((p) => p.trim()).filter(Boolean);
  let replaced = false;
  const next: string[] = [];
  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon < 0) {
      next.push(part);
      continue;
    }
    const name = part.slice(0, colon).trim().toLowerCase();
    if (name === lower) {
      next.push(`${prop}: ${newValue}`);
      replaced = true;
    } else {
      next.push(part);
    }
  }
  if (!replaced) next.push(`${prop}: ${newValue}`);
  return next.join('; ');
}

/**
 * Does this element directly contain text (not just child elements)?
 * Used to skip wrapper nodes whose text is really in a grandchild.
 */
function hasDirectTextChild(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 /* TEXT_NODE */ && (node.nodeValue ?? '').trim()) {
      return true;
    }
  }
  return false;
}
