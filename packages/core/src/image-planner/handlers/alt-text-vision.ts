import { imageSourceFromUrl } from '../../ai/llm-client.js';
import type { HandlerFn } from './types.js';

const MAX_ALT = 125;
const FALLBACK_ALT = 'Image description unavailable';

const VISION_PROMPT = `Generate concise, descriptive alt text for this image. The alt text should:
1. Describe the essential content and function
2. Be under ${MAX_ALT} characters
3. Not begin with "Image of" or "Picture of"
4. Be suitable for a screen reader

Respond with ONLY the alt text, no quotes.`;

function contextPrompt(parts: string[]): string {
  return `Generate concise alt text (under ${MAX_ALT} characters) for an image based on this context:
${parts.join('\n')}

Respond with ONLY the alt text, no quotes.`;
}

/**
 * Two-tier alt-text generator.
 *
 *   Tier A: vision — fetch the image bytes, ask the vision LLM for a
 *           screen-reader-ready alt string.
 *   Tier B: chat-LLM with structured DOM context — when vision fails or
 *           returns nothing useful, build a prompt from the parent text,
 *           preceding heading, and filename stem, then ask the text LLM.
 *   Fallback: "${FALLBACK_ALT}" so screen readers always have *something*
 *           to announce rather than a bare `alt=""` the planner believed
 *           informational.
 *
 * Caps at ${MAX_ALT} characters — the WCAG guideline. Returns ok=true in
 * every path (tier A success, tier B success, placeholder) because the
 * image always ends up with an alt attribute; caller uses llmCall:true
 * to count budget if vision or chat fired.
 */
export const altTextVision: HandlerFn = async (img, ctx) => {
  if (!ctx.llm) {
    return { ok: false, error: 'alt-text-vision requires an LLM client' };
  }

  // Tier A — vision.
  try {
    const image = await imageSourceFromUrl(ctx.absoluteSrc);
    const raw = await ctx.llm.vision({
      image,
      prompt: VISION_PROMPT,
      maxTokens: 256,
    });
    const alt = cleanAlt(raw);
    if (alt) {
      img.setAttribute('alt', alt);
      return {
        ok: true,
        mutation: `set alt (vision): "${truncate(alt, 60)}"`,
        llmCall: true,
      };
    }
  } catch {
    // fall through to tier B
  }

  // Tier B — chat-LLM with DOM context clues.
  const parts = collectContext(img);
  if (parts.length > 0) {
    try {
      const raw = await ctx.llm.chat({
        messages: [{ role: 'user', content: contextPrompt(parts) }],
        maxTokens: 80,
        temperature: 0.3,
      });
      const alt = cleanAlt(raw);
      if (alt) {
        img.setAttribute('alt', alt);
        return {
          ok: true,
          mutation: `set alt (context fallback): "${truncate(alt, 60)}"`,
          llmCall: true,
        };
      }
    } catch {
      // fall through to placeholder
    }
  }

  img.setAttribute('alt', FALLBACK_ALT);
  return {
    ok: true,
    mutation: `set alt (placeholder): "${FALLBACK_ALT}"`,
    llmCall: true,
  };
};

function cleanAlt(raw: string): string {
  const trimmed = raw.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ');
  if (!trimmed) return '';
  return trimmed.length > MAX_ALT ? trimmed.slice(0, MAX_ALT - 1).trimEnd() + '…' : trimmed;
}

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
