/**
 * Shared DOM helpers for figure/chart accessibility rules.
 *
 * Kept provider-free and side-effect-free so it can be reused by the
 * chart-alt and figure-wrap rules without pulling in the LLM client.
 */

/** Keywords in a URL/filename that indicate the image is a chart/diagram. */
const CHART_URL_HINTS = [
  'chart',
  'graph',
  'plot',
  'figure-',
  'figure_',
  'bar',
  'line',
  'pie',
  'diagram',
  'histogram',
  'scatter',
];

/** Phrases in surrounding prose that suggest a nearby image is a chart. */
const CHART_PROSE_HINTS = /\b(shown below|shown above|figure|graph|plot|chart|diagram|histogram)\b/i;

/** Absolute pixel threshold above which an unhinted image is "chart-sized". */
const CHART_MIN_WIDTH = 500;
const CHART_MIN_HEIGHT = 300;

/** Returns true when the <img>'s URL contains a chart-ish token. */
export function urlHasChartHint(src: string): boolean {
  const s = src.toLowerCase();
  return CHART_URL_HINTS.some((tok) => s.includes(tok));
}

/** Pull width/height from width= / height= attrs or ?width=/?height= query. */
export function imageDimensions(img: Element): { width: number; height: number } {
  const src = img.getAttribute('src') ?? '';
  const w = parseIntOrNull(img.getAttribute('width')) ?? parseIntOrNull(queryParam(src, 'width')) ?? 0;
  const h = parseIntOrNull(img.getAttribute('height')) ?? parseIntOrNull(queryParam(src, 'height')) ?? 0;
  return { width: w, height: h };
}

function parseIntOrNull(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function queryParam(url: string, key: string): string | null {
  const m = url.match(new RegExp(`[?&]${key}=([^&]+)`));
  return m ? m[1]! : null;
}

/**
 * Gather short chunks of prose from the image's siblings and containing
 * paragraph. Used both for chart-proximity detection and to ground the
 * vision prompt with page context.
 */
export function surroundingText(img: Element, maxChars = 800): string {
  const parts: string[] = [];
  const push = (s: string | null | undefined) => {
    if (!s) return;
    const t = s.replace(/\s+/g, ' ').trim();
    if (t) parts.push(t);
  };
  push(img.previousElementSibling?.textContent);
  push(img.nextElementSibling?.textContent);
  push(img.parentElement?.textContent);
  // Pull one more level up for figure-caption-like patterns on div wrappers.
  const gp = img.parentElement?.parentElement;
  if (gp && gp !== img.ownerDocument?.body) push(gp.textContent);
  const joined = parts.join(' ').slice(0, maxChars);
  return joined;
}

/** True when the image itself, its URL, its dimensions, or surrounding
 *  prose indicate it is a chart/graph/diagram worth describing as data. */
export function looksLikeChart(img: Element): boolean {
  const src = img.getAttribute('src') ?? '';
  if (urlHasChartHint(src)) return true;
  const { width, height } = imageDimensions(img);
  if (width >= CHART_MIN_WIDTH && height >= CHART_MIN_HEIGHT) {
    return CHART_PROSE_HINTS.test(surroundingText(img, 400));
  }
  return false;
}

/** True when the existing alt is missing, blank, or obviously weak
 *  (looks like a filename/URL). This mirrors img-alt.ts's heuristics
 *  so the chart rule gates on real signal, not duplicate work. */
export function hasMissingOrWeakAlt(img: Element): boolean {
  if (!img.hasAttribute('alt')) return true;
  const alt = (img.getAttribute('alt') ?? '').trim();
  if (!alt) return true; // empty alt="" — decorative declaration on an
  //                        informational image; chart rule will fix it.
  const src = img.getAttribute('src') ?? '';
  if (alt.toLowerCase() === src.toLowerCase()) return true;
  if (/\.(png|jpe?g|gif|svg|webp|bmp|tiff?)$/i.test(alt)) return true;
  if (/^(image|img|photo|picture|fig(ure)?)[\s\-_]*\d*$/i.test(alt)) return true;
  // Very short alt on a chart-sized image is suspect.
  if (alt.length < 12) return true;
  return false;
}

/** Find an <img> in a document by its src attribute (first match). */
export function findImageBySrc(doc: Document, src: string): HTMLImageElement | null {
  const imgs = Array.from(doc.querySelectorAll('img'));
  return (imgs.find((i) => (i.getAttribute('src') ?? '') === src) ?? null) as HTMLImageElement | null;
}

/** Resolve a possibly-relative src against the page hostname. */
export function absoluteUrl(src: string, hostname: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `https://${hostname}${src}`;
  return `https://${hostname}/${src}`;
}

/** Build a stable-ish selector for a finding (tag + id or nth-of-type). */
export function buildSelector(el: Element, tag: string, index: number): string {
  const id = el.id ? `#${el.id}` : '';
  const cls =
    el.className && typeof el.className === 'string'
      ? '.' + el.className.split(/\s+/).filter(Boolean).join('.')
      : '';
  if (id) return `${tag}${id}`;
  return `${tag}${cls}:nth-of-type(${index + 1})`;
}

/** Truncate a string for snippets / messages. */
export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Is `el` a child of a <figure>? */
export function isInsideFigure(el: Element): boolean {
  let cur: Element | null = el.parentElement;
  while (cur) {
    if (cur.tagName.toLowerCase() === 'figure') return true;
    cur = cur.parentElement;
  }
  return false;
}

/** Block-level parents we're willing to promote a loose <img> out of
 *  into a <figure>. <body> is represented here as 'body'. */
export const PROMOTABLE_PARENT_TAGS = new Set(['p', 'div', 'body', 'section', 'article']);

/** True when the element's tag is one of PROMOTABLE_PARENT_TAGS. */
export function isPromotableParent(el: Element | null): boolean {
  if (!el) return false;
  return PROMOTABLE_PARENT_TAGS.has(el.tagName.toLowerCase());
}

/**
 * A caption-like element is one whose class matches /caption|figure-?label/i,
 * or whose textContent starts with "Figure N:" / "Fig. N:" / "Figure N."
 * Short italic-only elements are also treated as captions.
 */
export function looksLikeCaptionElement(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName.toLowerCase() === 'figcaption') return true;
  const cls = (el.getAttribute('class') ?? '').toLowerCase();
  if (/caption|figure-?label/i.test(cls)) return true;
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (FIGURE_PREFIX.test(text)) return true;
  // small italic run — <em>/<i>/<small> only, under ~200 chars.
  const tag = el.tagName.toLowerCase();
  if ((tag === 'em' || tag === 'i' || tag === 'small') && text.length < 200) return true;
  return false;
}

/** Matches "Figure 1:", "Fig. 2.", "Figure 12 -" etc. */
export const FIGURE_PREFIX = /^(figure|fig\.?)\s*\d+\s*[:.\-–—]/i;
