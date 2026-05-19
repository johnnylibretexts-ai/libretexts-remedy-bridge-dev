import { AltTextGenerator } from '../../ai/alt-text.js';
import type { HandlerFn } from './types.js';

const MAX_ALT = 125;

/**
 * Two-tier alt-text generator.
 *
 *   Tier A: vision — fetch the image bytes, ask the vision LLM for a
 *           screen-reader-ready alt string.
 *           The prompt includes nearby DOM context. If the output is too
 *           long, retry once with a shorter rewrite prompt.
 *
 * If the LLM cannot produce acceptable alt text, leave the image unchanged
 * and return ok=false. Do not truncate with an ellipsis and do not write a
 * placeholder.
 */
export const altTextVision: HandlerFn = async (img, ctx) => {
  if (!ctx.llm) {
    return { ok: false, error: 'alt-text-vision requires an LLM client' };
  }

  try {
    const gen = new AltTextGenerator({
      client: ctx.llm,
      maxLength: MAX_ALT,
    });
    const contextParts = collectContext(img);
    if (ctx.pageContext?.trim()) contextParts.push(`Page context: ${ctx.pageContext.trim().slice(0, 700)}`);
    const alt = await gen.generate(ctx.absoluteSrc, {
      existingAlt: img.getAttribute('alt') ?? undefined,
      pageContext: contextParts.join('\n'),
    });
    img.setAttribute('alt', alt);
    return {
      ok: true,
      mutation: `set alt (vision): "${truncate(alt, 60)}"`,
      llmCall: true,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      llmCall: true,
    };
  }
};

function collectContext(img: HTMLElement): string[] {
  const parts: string[] = [];

  const parent = img.parentElement;
  if (parent) {
    const parentText = (parent.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (parentText && parentText.length < 200) {
      parts.push(`Surrounding text: ${parentText}`);
    }
  }

  const heading = findPrecedingHeading(img);
  if (heading) parts.push(`Section heading: ${heading}`);

  const src = img.getAttribute('src') ?? '';
  if (src) {
    const filename = filenameStem(src);
    if (filename) parts.push(`Filename: ${filename}`);
  }

  return parts;
}

function findPrecedingHeading(start: HTMLElement): string {
  // Walk previous siblings; if none, ascend and try parent's previous siblings.
  let node: Element | null = start;
  while (node) {
    let sib: Element | null = node.previousElementSibling;
    while (sib) {
      if (/^H[1-6]$/.test(sib.tagName)) {
        const text = (sib.textContent ?? '').trim();
        if (text) return text;
      }
      sib = sib.previousElementSibling;
    }
    node = node.parentElement;
  }
  return '';
}

function filenameStem(src: string): string {
  const last = src.split('/').pop() ?? '';
  const stem = last.split('?')[0]?.split('.')[0] ?? '';
  // Skip bare numbers and very short stems — they rarely add meaning.
  if (stem.length <= 5) return '';
  if (/^\d+$/.test(stem)) return '';
  return stem;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
