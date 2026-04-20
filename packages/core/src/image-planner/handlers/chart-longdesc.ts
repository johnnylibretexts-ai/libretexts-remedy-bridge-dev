import { imageSourceFromUrl } from '../../ai/llm-client.js';
import type { HandlerFn } from './types.js';

const MAX_CAPTION = 80;
const MAX_LONG_DESC = 400;

const PROMPT = `Examine this chart image carefully (bar, line, pie, scatter, histogram, etc.).

Extract:
1. A SHORT title-cased caption (5-12 words, under ${MAX_CAPTION} characters) suitable as alt text.
2. A LONG description (1-3 sentences, under ${MAX_LONG_DESC} characters) describing what the chart shows, its axes, and the main takeaway.
3. A data_table array of {label, value} pairs extracted from the chart. May be empty for charts without discrete data points (e.g., trend lines).

Respond with JSON in this exact shape, no other text:
{
  "caption": "...",
  "long_description": "...",
  "data_table": [
    { "label": "...", "value": "..." }
  ]
}

If the image is NOT a chart, or you cannot extract a caption and long description, respond exactly:
{"caption": "", "long_description": "", "data_table": []}`;

export interface ChartDataPoint {
  label: string;
  value: string;
}

export interface ChartExtraction {
  caption: string;
  long_description: string;
  data_table: ChartDataPoint[];
}

/**
 * Parse the LLM's JSON response. Lenient: accepts responses wrapped in
 * code fences or preceded by prose. Strict on shape.
 */
export function parseChartJson(raw: string): ChartExtraction | null {
  const trimmed = raw.trim();
  // Extract the first {...} block — handles both bare JSON and fenced/prose wrappers.
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (typeof parsed?.caption !== 'string') return null;
    if (typeof parsed?.long_description !== 'string') return null;
    if (!Array.isArray(parsed?.data_table)) return null;
    const points: ChartDataPoint[] = [];
    for (const entry of parsed.data_table) {
      if (!entry || typeof entry !== 'object') return null;
      const label = (entry as Record<string, unknown>).label;
      const value = (entry as Record<string, unknown>).value;
      if (typeof label !== 'string') return null;
      // Accept numeric values by stringifying — charts often report raw numbers.
      let valueStr: string;
      if (typeof value === 'string') {
        valueStr = value;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        valueStr = String(value);
      } else {
        return null;
      }
      points.push({ label, value: valueStr });
    }
    return {
      caption: parsed.caption,
      long_description: parsed.long_description,
      data_table: points,
    };
  } catch {
    return null;
  }
}

/**
 * Convert a chart image into an accessible `<figure>` with a short alt
 * caption, a `<details><summary>Long description</summary>…</details>`
 * collapsible carrying the prose description, and (optionally) a data
 * `<table>` when the vision model pulled out ≥2 data points.
 *
 * Final markup when the image is NOT already inside a figure:
 *   <figure>
 *     <img ... alt="[caption]">
 *     <figcaption>[caption]</figcaption>
 *     <details><summary>Long description</summary><p>…</p></details>
 *     <table>…</table>   (only if data_table has ≥2 entries)
 *   </figure>
 *
 * When the image IS already inside a figure: augment that figure in place.
 * A figcaption is only added if the figure doesn't already have one.
 *
 * Emits an LLM vision call. On any failure (LLM error, parse failure,
 * empty caption/long_description), returns `{ok: false, llmCall: true}`
 * so the planner can fall back to alt-text-vision.
 */
export const chartLongdesc: HandlerFn = async (img, ctx) => {
  if (!ctx.llm) {
    return { ok: false, error: 'chart-longdesc requires an LLM client' };
  }
  if (!img.parentNode) {
    return { ok: false, error: 'image has no parent node' };
  }

  let raw: string;
  try {
    const image = await imageSourceFromUrl(ctx.absoluteSrc);
    raw = await ctx.llm.vision({ image, prompt: PROMPT, maxTokens: 1024 });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      llmCall: true,
    };
  }

  const parsed = parseChartJson(raw);
  if (!parsed || !parsed.caption.trim() || !parsed.long_description.trim()) {
    return {
      ok: false,
      error: 'not a chart',
      llmCall: true,
    };
  }

  const doc = ctx.doc;
  const existingFigure = findAncestorFigure(img);

  // Short, screen-reader-friendly alt on the img itself.
  img.setAttribute('alt', parsed.caption);

  // Build the long-description <details> block.
  const details = doc.createElement('details');
  const summary = doc.createElement('summary');
  summary.textContent = 'Long description';
  details.appendChild(summary);
  const p = doc.createElement('p');
  p.textContent = parsed.long_description;
  details.appendChild(p);

  // Build optional <table> for the data points.
  let table: HTMLElement | null = null;
  if (parsed.data_table.length >= 2) {
    table = doc.createElement('table');
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    const thLabel = doc.createElement('th');
    thLabel.textContent = 'Label';
    const thValue = doc.createElement('th');
    thValue.textContent = 'Value';
    headRow.appendChild(thLabel);
    headRow.appendChild(thValue);
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    for (const point of parsed.data_table) {
      const tr = doc.createElement('tr');
      const tdLabel = doc.createElement('td');
      tdLabel.textContent = point.label;
      const tdValue = doc.createElement('td');
      tdValue.textContent = point.value;
      tr.appendChild(tdLabel);
      tr.appendChild(tdValue);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  let figure: HTMLElement;
  if (existingFigure) {
    figure = existingFigure;
    if (!figure.querySelector(':scope > figcaption')) {
      const figcaption = doc.createElement('figcaption');
      figcaption.textContent = parsed.caption;
      figure.appendChild(figcaption);
    }
  } else {
    figure = doc.createElement('figure');
    const parent = img.parentNode!;
    parent.insertBefore(figure, img);
    figure.appendChild(img); // move (not clone) — preserves other listeners
    const figcaption = doc.createElement('figcaption');
    figcaption.textContent = parsed.caption;
    figure.appendChild(figcaption);
  }

  figure.appendChild(details);
  if (table) figure.appendChild(table);

  const tableNote = table ? ` + <table> (${parsed.data_table.length} rows)` : '';
  return {
    ok: true,
    mutation: `set alt + appended <details>${tableNote}`,
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
