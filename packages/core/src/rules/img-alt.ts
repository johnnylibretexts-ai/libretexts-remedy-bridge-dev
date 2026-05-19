import type { Rule } from '../types.js';
import { AltTextGenerator } from '../ai/alt-text.js';

/**
 * WCAG 1.1.1 Non-text Content.
 *
 * Flags <img> that lack an alt attribute, or have whitespace-only alt,
 * or have alt that looks auto-generated from a filename. A missing alt is
 * an error; a suspicious alt (e.g. the image URL) is a warning.
 *
 * Note: alt="" is *valid* for decorative images. We do NOT flag that — but
 * a later rule can flag decorative declarations that appear on clearly
 * informative images based on dimensions or surrounding text.
 */
export const imgAltRule: Rule = {
  id: 'img-alt',
  wcag: '1.1.1',
  severity: 'error',
  description: 'Images must have an alt attribute (empty alt="" is allowed for decorative).',
  async fix(doc, finding, ctx) {
    const src = String(finding.data?.src ?? '');
    if (!src) return false;
    const img = findImageBySrc(doc, src);
    if (!img) return false;
    const pageText = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (finding.data?.reason === 'long-alt') {
      const currentAlt = typeof finding.data.alt === 'string'
        ? finding.data.alt
        : img.getAttribute('alt') ?? '';
      try {
        const gen = new AltTextGenerator({
          client: ctx.getLlm?.() ?? ctx.llm,
          consumeLlmCall: ctx.consumeLlmCall,
        });
        const alt = await gen.generate(absoluteUrl(src, ctx.page.hostname), {
          existingAlt: currentAlt,
          caption: findFigcaptionNear(img) ?? undefined,
          pageContext: pageText,
        });
        if (!alt || alt === img.getAttribute('alt')) return false;
        img.setAttribute('alt', alt);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.recordFixError?.(`Could not generate replacement alt text: ${message}`);
        if (process.env.DEBUG) console.error('img-alt long-alt fix failed:', err);
        return false;
      }
    }
    try {
      const gen = new AltTextGenerator({
        client: ctx.getLlm?.() ?? ctx.llm,
        consumeLlmCall: ctx.consumeLlmCall,
      });
      const alt = await gen.generate(absoluteUrl(src, ctx.page.hostname), {
        caption: findFigcaptionNear(img) ?? undefined,
        pageContext: pageText,
      });
      img.setAttribute('alt', alt);
      return true;
    } catch (err) {
      // Soft failure — return false so the orchestrator logs a "couldn't fix" entry.
      // Detailed error bubbles via DEBUG.
      const message = err instanceof Error ? err.message : String(err);
      ctx.recordFixError?.(`Could not generate alt text: ${message}`);
      if (process.env.DEBUG) console.error('img-alt fix failed:', err);
      return false;
    }
  },
  detect(doc) {
    const findings: ReturnType<Rule['detect']> = [];
    const imgs = Array.from(doc.querySelectorAll('img'));
    imgs.forEach((img, index) => {
      const hasAttr = img.hasAttribute('alt');
      const alt = img.getAttribute('alt') ?? '';
      const src = img.getAttribute('src') ?? '(no src)';
      const selector = buildSelector(img, 'img', index);

      if (!hasAttr) {
        findings.push({
          message: `<img> is missing the alt attribute. src=${truncate(src, 80)}`,
          selector,
          snippet: img.outerHTML.slice(0, 200),
          data: { src, reason: 'missing-attr' },
        });
        return;
      }

      if (alt.trim() === '' && hasAttr) {
        // empty alt == decorative. Valid, but often misapplied on informational
        // images. Flag when the image is large or its src looks like
        // OCR/diagram content (mathpix, chem structures, etc.) — a human (or
        // vision model) should confirm it's truly decorative.
        const suspect = isSuspectDecorative(img, src);
        if (suspect) {
          findings.push({
            message: `<img> has alt="" (decorative) but looks informational: ${suspect}`,
            selector,
            snippet: img.outerHTML.slice(0, 200),
            data: { src, reason: 'suspect-decorative', hint: suspect },
          });
        }
        return;
      }

      if (alt.length > 150) {
        findings.push({
          message: `<img> alt text is ${alt.length} characters; keep alt text under 150 characters or move detail into nearby text/caption.`,
          selector,
          snippet: img.outerHTML.slice(0, 200),
          data: { src, alt, reason: 'long-alt', length: alt.length },
        });
        return;
      }

      if (looksLikeFilename(alt, src)) {
        findings.push({
          message: `<img> alt text looks like a filename/URL, not a description: "${truncate(alt, 80)}"`,
          selector,
          snippet: img.outerHTML.slice(0, 200),
          data: { src, alt, reason: 'looks-like-filename' },
        });
      }
    });
    return findings;
  },
};

function isSuspectDecorative(img: Element, src: string): string | null {
  const url = src.toLowerCase();
  if (/mathpix|chemdraw|smiles|structure|diagram|figure|chart|graph|equation|formula/.test(url)) {
    return `filename/URL hints at informational content (${shortHost(src)})`;
  }
  const widthAttr = num(img.getAttribute('width')) ?? num(getParam(src, 'width'));
  const heightAttr = num(img.getAttribute('height')) ?? num(getParam(src, 'height'));
  const w = widthAttr ?? 0;
  const h = heightAttr ?? 0;
  if (w >= 400 || h >= 400) return `large image (${w || '?'}×${h || '?'} px)`;
  return null;
}

function num(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function getParam(url: string, key: string): string | null {
  const m = url.match(new RegExp(`[?&]${key}=([^&]+)`));
  return m ? m[1]! : null;
}

function shortHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 30);
  }
}

function looksLikeFilename(alt: string, src: string): boolean {
  const a = alt.trim().toLowerCase();
  if (!a) return false;
  if (a === src.toLowerCase()) return true;
  if (/\.(png|jpe?g|gif|svg|webp|bmp|tiff?)$/.test(a)) return true;
  if (/^(image|img|photo|picture|fig(ure)?)[\s\-_]*\d*$/.test(a)) return true;
  return false;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function buildSelector(el: Element, tag: string, index: number): string {
  const id = el.id ? `#${el.id}` : '';
  const cls = el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).filter(Boolean).join('.') : '';
  if (id) return `${tag}${id}`;
  return `${tag}${cls}:nth-of-type(${index + 1})`;
}

function findImageBySrc(doc: Document, src: string): HTMLImageElement | null {
  const imgs = Array.from(doc.querySelectorAll('img'));
  return (imgs.find((i) => (i.getAttribute('src') ?? '') === src) ?? null) as HTMLImageElement | null;
}

function findFigcaptionNear(img: HTMLElement): string | null {
  let node: HTMLElement | null = img.parentElement;
  while (node) {
    if (node.tagName.toLowerCase() === 'figure') {
      const text = node.querySelector('figcaption')?.textContent?.replace(/\s+/g, ' ').trim();
      return text || null;
    }
    node = node.parentElement;
  }
  return null;
}

function absoluteUrl(src: string, hostname: string): string {
  if (/^(https?|data|blob):/i.test(src)) return src;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `https://${hostname}${src}`;
  return `https://${hostname}/${src}`;
}
