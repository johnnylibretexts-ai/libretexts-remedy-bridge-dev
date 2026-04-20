/**
 * chart-alt — detect chart/graph/diagram <img> and generate
 * an accessible equivalent: alt text + <figure>/<figcaption> wrapping
 * + a <details> data-table disclosure after the figure.
 *
 * This rule is intentionally *narrower* than img-alt: it fires only on
 * images that (a) have missing/weak alt AND (b) look like charts either
 * via URL/filename hints or size-plus-prose signals. That gating prevents
 * duplicate findings with img-alt.ts for ordinary photos.
 */
import type { Rule } from '../types.js';
import { ChartDescriber, type ChartDescription } from '../ai/chart-describe.js';
import {
  absoluteUrl,
  buildSelector,
  findImageBySrc,
  hasMissingOrWeakAlt,
  isInsideFigure,
  looksLikeChart,
  surroundingText,
  truncate,
} from '../ai/figure-helpers.js';

export const chartAltRule: Rule = {
  id: 'chart-alt',
  wcag: '1.1.1',
  severity: 'error',
  description:
    'Chart, graph, and diagram images must have descriptive alt text and a data-equivalent text alternative.',
  async fix(doc, finding, ctx) {
    const src = String(finding.data?.src ?? '');
    if (!src) return false;
    const img = findImageBySrc(doc, src);
    if (!img) return false;
    try {
      const describer = new ChartDescriber();
      const url = absoluteUrl(src, ctx.page.hostname);
      const context = surroundingText(img, 800);
      const description = await describer.describeAsTable(url, context);
      injectChartDescription(doc, img, description);
      return true;
    } catch (err) {
      if (process.env.DEBUG) console.error('chart-alt fix failed:', err);
      return false;
    }
  },
  detect(doc) {
    const findings: ReturnType<Rule['detect']> = [];
    const imgs = Array.from(doc.querySelectorAll('img'));
    imgs.forEach((img, index) => {
      if (!looksLikeChart(img)) return;
      if (!hasMissingOrWeakAlt(img)) return;
      const src = img.getAttribute('src') ?? '(no src)';
      const selector = buildSelector(img, 'img', index);
      findings.push({
        message: `Chart/diagram image needs accessible alt and data-equivalent. src=${truncate(src, 80)}`,
        selector,
        snippet: img.outerHTML.slice(0, 200),
        data: { src, reason: chartReason(img) },
      });
    });
    return findings;
  },
};

/** Wrap img in <figure>, set alt, inject <figcaption> + <details>. */
export function injectChartDescription(
  doc: Document,
  img: Element,
  description: ChartDescription,
): void {
  img.setAttribute('alt', description.altText);

  // Promote into a <figure> if not already inside one.
  let figure: Element;
  if (isInsideFigure(img)) {
    figure = closestFigure(img)!;
  } else {
    figure = doc.createElement('figure');
    const parent = img.parentElement;
    if (!parent) return;
    parent.insertBefore(figure, img);
    figure.appendChild(img);
  }

  // Ensure a <figcaption>. If absent, use a short caption derived from altText.
  let figcaption = figure.querySelector(':scope > figcaption');
  if (!figcaption) {
    figcaption = doc.createElement('figcaption');
    figcaption.textContent = description.altText;
    figure.appendChild(figcaption);
  }

  // Avoid double-injecting the details block on re-runs: look for an
  // existing sibling <details data-remedy="chart-alt"> and replace it.
  const existing = figure.nextElementSibling;
  const details = doc.createElement('details');
  details.setAttribute('data-remedy', 'chart-alt');

  const summary = doc.createElement('summary');
  summary.textContent = 'Chart data (text equivalent)';
  details.appendChild(summary);

  const descDiv = doc.createElement('div');
  descDiv.setAttribute('class', 'remedy-chart-longdesc');
  descDiv.textContent = description.longDescription;
  details.appendChild(descDiv);

  if (description.dataTable) {
    const tableHost = doc.createElement('div');
    tableHost.setAttribute('class', 'remedy-chart-table');
    const parsedTable = parseTableHtml(doc, description.dataTable);
    if (parsedTable) tableHost.appendChild(parsedTable);
    details.appendChild(tableHost);
  }

  if (
    existing &&
    existing.tagName.toLowerCase() === 'details' &&
    existing.getAttribute('data-remedy') === 'chart-alt'
  ) {
    existing.replaceWith(details);
  } else if (figure.parentElement) {
    figure.parentElement.insertBefore(details, figure.nextSibling);
  }
}

/**
 * Parse a <table>...</table> HTML string into a live Element using the
 * owner document's template parser. Returns null if parsing yields no
 * <table> element. Going through <template> avoids script execution
 * and XSS vectors that direct innerHTML assignment could enable.
 */
function parseTableHtml(doc: Document, html: string): Element | null {
  const tpl = doc.createElement('template') as HTMLTemplateElement;
  // HTMLTemplateElement content is an inert DocumentFragment — no script
  // execution, no resource loads. Source is narrowly pre-validated upstream
  // to start with `<table ` and end with `</table>`.
  tpl.innerHTML = html;
  const table = tpl.content.querySelector('table');
  return table ? (table as Element) : null;
}

function closestFigure(el: Element): Element | null {
  let cur: Element | null = el.parentElement;
  while (cur) {
    if (cur.tagName.toLowerCase() === 'figure') return cur;
    cur = cur.parentElement;
  }
  return null;
}

function chartReason(img: Element): string {
  const src = img.getAttribute('src') ?? '';
  if (/chart|graph|plot|figure-|figure_|bar|line|pie|diagram|histogram|scatter/i.test(src)) {
    return 'url-hint';
  }
  return 'size-plus-prose';
}
