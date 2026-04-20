import { imageSourceFromUrl } from '../../ai/llm-client.js';
import type { HandlerFn } from './types.js';

const PROMPT = `Examine this flowchart image carefully.

Identify:
1. A SHORT caption naming what the flowchart depicts (5-10 words).
2. An ORDERED list of steps (or stages) the flowchart conveys. Each step is a short phrase (2-8 words).

Respond with JSON in this exact shape, no other text:
{"caption": "...", "steps": ["...", "...", ...]}

If the image is not a flowchart or a stepwise process, respond exactly:
{"caption": "", "steps": []}`;

export interface FlowchartExtraction {
  caption: string;
  steps: string[];
}

/**
 * Parse the LLM's JSON response. Lenient: accepts responses wrapped in
 * code fences or preceded by prose.
 */
export function parseFlowchartJson(raw: string): FlowchartExtraction | null {
  const trimmed = raw.trim();
  // Extract the first {...} block — handles both bare JSON and fenced/prose wrappers.
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (typeof parsed?.caption !== 'string') return null;
    if (!Array.isArray(parsed?.steps)) return null;
    if (!parsed.steps.every((s: unknown) => typeof s === 'string')) return null;
    return { caption: parsed.caption, steps: parsed.steps };
  } catch {
    return null;
  }
}

/**
 * Convert a flowchart image into a `<figure>` with a structured `<ol>` of
 * steps while keeping the image as a visual aid (alt="" + role="presentation"
 * because the list IS the accessible equivalent).
 *
 * Final markup when the image is NOT already inside a figure:
 *   <figure role="group" aria-label="[caption]">
 *     <img ... alt="" role="presentation">
 *     <figcaption>[caption]</figcaption>
 *     <ol><li>step</li>...</ol>
 *   </figure>
 *
 * When the image IS already inside a figure: augment that figure in place.
 *
 * Emits an LLM vision call. On any failure (LLM, parse, <2 steps), returns
 * `{ok: false}` so the caller can fall back to a simpler strategy.
 */
export const flowchartOl: HandlerFn = async (img, ctx) => {
  if (!ctx.llm) {
    return { ok: false, error: 'flowchart-ol requires an LLM client' };
  }
  if (!img.parentNode) {
    return { ok: false, error: 'image has no parent node' };
  }

  let raw: string;
  try {
    const image = await imageSourceFromUrl(ctx.absoluteSrc);
    raw = await ctx.llm.vision({ image, prompt: PROMPT, maxTokens: 512 });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      llmCall: true,
    };
  }

  const parsed = parseFlowchartJson(raw);
  if (!parsed || parsed.steps.length < 2 || !parsed.caption) {
    return {
      ok: false,
      error: 'could not extract a caption + 2+ steps from image',
      llmCall: true,
    };
  }

  const doc = ctx.doc;
  const existingFigure = findAncestorFigure(img);

  // Mark the image decorative since the list carries the information.
  img.setAttribute('alt', '');
  img.setAttribute('role', 'presentation');

  const figcaption = doc.createElement('figcaption');
  figcaption.textContent = parsed.caption;
  const ol = doc.createElement('ol');
  for (const step of parsed.steps) {
    const li = doc.createElement('li');
    li.textContent = step;
    ol.appendChild(li);
  }

  if (existingFigure) {
    // Augment the existing figure: append figcaption (if missing) + ol.
    if (!existingFigure.querySelector(':scope > figcaption')) {
      existingFigure.appendChild(figcaption);
    }
    existingFigure.appendChild(ol);
    existingFigure.setAttribute('role', 'group');
    existingFigure.setAttribute('aria-label', parsed.caption);
  } else {
    // Wrap the image in a new figure.
    const figure = doc.createElement('figure');
    figure.setAttribute('role', 'group');
    figure.setAttribute('aria-label', parsed.caption);
    const parent = img.parentNode!;
    parent.insertBefore(figure, img);
    figure.appendChild(img); // move (not clone) — preserves other event listeners in tests
    figure.appendChild(figcaption);
    figure.appendChild(ol);
  }

  return {
    ok: true,
    mutation: `wrapped in <figure> + <ol> with ${parsed.steps.length} steps`,
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
