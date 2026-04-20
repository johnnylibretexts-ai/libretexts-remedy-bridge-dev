import { imageSourceFromUrl } from '../../ai/llm-client.js';
import type { HandlerFn } from './types.js';

const OCR_PROMPT = `Extract ALL text from this image as clean Markdown.
- Preserve headings (# H1, ## H2, etc.), paragraphs, lists, tables, and code blocks in reading order.
- Use \`\`\`fence\`\`\` for monospace/code content.
- Do NOT add commentary, do NOT invent content that's not in the image.
- If the image is not image-of-text (e.g., a chart or diagram), respond with exactly: NOT_TEXT`;

/**
 * Convert a *minimal* subset of Markdown into semantic HTML nodes. This is
 * intentionally not a full CommonMark implementation — we only need to
 * render what the vision OCR prompt is trained to emit:
 *
 *   - `# H1` / `## H2` / `### H3`  → `<h3>` / `<h4>` / `<h5>`
 *       (we down-shift because we don't know the heading depth of the host page)
 *   - `- item` / `* item`          → `<ul><li>…</li></ul>` (consecutive grouped)
 *   - `1. item`                    → `<ol><li>…</li></ol>` (consecutive grouped)
 *   - ```fenced code```            → `<pre><code>…</code></pre>`
 *   - anything else non-blank      → `<p>…</p>`
 *
 * Blank lines separate paragraphs. Inline formatting (bold/italic/links) is
 * stripped — we keep the plain text only, YAGNI until we see real usage.
 *
 * Exported so it can be unit-tested independently of the handler.
 */
export function markdownToHtml(md: string, doc: Document): DocumentFragment {
  const frag = doc.createDocumentFragment();
  const lines = md.replace(/\r\n/g, '\n').split('\n');

  let i = 0;
  // Buffer for the current run of list items — `null` means "not currently in a list".
  let listKind: 'ul' | 'ol' | null = null;
  let listEl: HTMLElement | null = null;
  const flushList = () => {
    if (listEl) frag.appendChild(listEl);
    listEl = null;
    listKind = null;
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // Blank line — closes any open list + paragraph run.
    if (!trimmed) {
      flushList();
      i++;
      continue;
    }

    // Fenced code block: ``` (optionally with language tag) … ```
    const fenceMatch = trimmed.match(/^```(.*)$/);
    if (fenceMatch) {
      flushList();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i] ?? '';
        if (next.trim().startsWith('```')) {
          i++;
          break;
        }
        codeLines.push(next);
        i++;
      }
      const pre = doc.createElement('pre');
      const code = doc.createElement('code');
      code.textContent = codeLines.join('\n');
      pre.appendChild(code);
      frag.appendChild(pre);
      continue;
    }

    // Heading: # / ## / ### (we cap at ### — deeper markdown is rare from OCR).
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1]!.length; // 1, 2, or 3
      const tag = level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5';
      const h = doc.createElement(tag);
      h.textContent = stripInline(headingMatch[2]!.trim());
      frag.appendChild(h);
      i++;
      continue;
    }

    // Unordered list item: `- foo` or `* foo`
    const ulMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (ulMatch) {
      if (listKind !== 'ul') {
        flushList();
        listKind = 'ul';
        listEl = doc.createElement('ul');
      }
      const li = doc.createElement('li');
      li.textContent = stripInline(ulMatch[1]!);
      listEl!.appendChild(li);
      i++;
      continue;
    }

    // Ordered list item: `1. foo`
    const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      if (listKind !== 'ol') {
        flushList();
        listKind = 'ol';
        listEl = doc.createElement('ol');
      }
      const li = doc.createElement('li');
      li.textContent = stripInline(olMatch[1]!);
      listEl!.appendChild(li);
      i++;
      continue;
    }

    // Single-line inline code wrapped entirely in backticks becomes <pre><code>.
    const inlineCodeMatch = trimmed.match(/^`([^`]+)`$/);
    if (inlineCodeMatch) {
      flushList();
      const pre = doc.createElement('pre');
      const code = doc.createElement('code');
      code.textContent = inlineCodeMatch[1]!;
      pre.appendChild(code);
      frag.appendChild(pre);
      i++;
      continue;
    }

    // Default: paragraph. Consume consecutive non-blank, non-special lines so
    // a multi-line prose block becomes a single <p> with line breaks joined
    // by a space.
    flushList();
    const paraLines: string[] = [trimmed];
    i++;
    while (i < lines.length) {
      const next = (lines[i] ?? '').trim();
      if (!next) break;
      // Stop if the next line starts a different block construct.
      if (/^(#{1,3}\s|[-*]\s|\d+\.\s|```)/.test(next)) break;
      paraLines.push(next);
      i++;
    }
    const p = doc.createElement('p');
    p.textContent = stripInline(paraLines.join(' '));
    frag.appendChild(p);
  }

  flushList();
  return frag;
}

/**
 * Strip Markdown inline syntax (bold/italic/links/inline-code markers) to
 * leave the visible text content. Not a full parser — just the common cases
 * OCR output actually contains.
 */
function stripInline(s: string): string {
  return s
    // Links [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Bold **x** or __x__ → x
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    // Italic *x* or _x_ → x
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_([^_]+)_(?!_)/g, '$1')
    // Inline code `x` → x
    .replace(/`([^`]+)`/g, '$1');
}

/**
 * OCR an image-of-text (screenshot of a code block, textbook-quote-as-PNG,
 * etc.) into semantic HTML and inline it next to the original img, which is
 * demoted to a decorative visual aid.
 *
 * Final markup (image had no ancestor figure):
 *   <figure>
 *     <img ... alt="Screenshot" role="presentation">
 *     …parsed markdown as HTML…
 *   </figure>
 *
 * When the image IS already inside a figure: append the parsed HTML to that
 * figure and mark the img decorative in place (don't create a nested figure).
 *
 * Emits one vision call with a bigger token budget than the other handlers
 * (1500) because OCR output can be long. Returns `{ok:false, llmCall:true}`
 * when the vision model says the image isn't text-of-image so the planner
 * can fall back to another handler.
 */
export const ocrText: HandlerFn = async (img, ctx) => {
  if (!ctx.llm) {
    return { ok: false, error: 'ocr-text requires an LLM client' };
  }
  if (!img.parentNode) {
    return { ok: false, error: 'image has no parent node' };
  }

  let raw: string;
  try {
    const image = await imageSourceFromUrl(ctx.absoluteSrc);
    raw = await ctx.llm.vision({ image, prompt: OCR_PROMPT, maxTokens: 1500 });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      llmCall: true,
    };
  }

  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'NOT_TEXT') {
    return {
      ok: false,
      error: 'image does not contain text',
      llmCall: true,
    };
  }

  const doc = ctx.doc;
  const existingFigure = findAncestorFigure(img);
  const parsed = markdownToHtml(trimmed, doc);

  // Mark the image decorative — the inlined HTML IS the accessible content.
  img.setAttribute('alt', 'Screenshot');
  img.setAttribute('role', 'presentation');

  if (existingFigure) {
    existingFigure.appendChild(parsed);
  } else {
    const figure = doc.createElement('figure');
    const parent = img.parentNode!;
    parent.insertBefore(figure, img);
    figure.appendChild(img); // move (not clone) — preserves test handles on the node
    figure.appendChild(parsed);
  }

  return {
    ok: true,
    mutation: 'wrapped in <figure> with OCR\'d HTML',
    llmCall: true,
  };
};

function findAncestorFigure(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    if (node.tagName === 'FIGURE') return node;
    node = node.parentElement;
  }
  return null;
}
