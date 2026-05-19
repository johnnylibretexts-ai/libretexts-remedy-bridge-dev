import type { Rule } from '../types.js';
import { MathDescriber } from '../ai/math-describe.js';

/**
 * WCAG 1.1.1 — math expressions must have an accessible name.
 *
 * LibreTexts renders math via MathJax. When the a11y extension is enabled,
 * each `<mjx-container>` already has `aria-label` or a sibling
 * `<mjx-assistive-mml>`. When it isn't, the container renders pure SVG
 * glyphs and is opaque to screen readers.
 *
 * Detection heuristic:
 *   - Find `mjx-container`, `.math-inline`, `.math-display`, or `<math>`
 *     elements.
 *   - If they have a non-empty `aria-label`, `aria-labelledby`, `alttext`,
 *     or a sibling `<mjx-assistive-mml>` — pass.
 *   - Otherwise, flag with a hint about the LaTeX/MathML source (if any).
 *
 * Fix:
 *   - Prefer extracted LaTeX source (look in common `data-*` attributes).
 *   - Fall back to MathML source.
 *   - Fall back to vision on the rendered SVG.
 *   - Write the spoken form into `aria-label`.
 */
export const mathAccessibleRule: Rule = {
  id: 'math-accessible',
  wcag: '1.1.1',
  severity: 'warning',
  description: 'Math expressions must expose a spoken-form equivalent for screen readers.',
  detect(doc) {
    const findings: ReturnType<Rule['detect']> = [];
    const nodes = collectMathNodes(doc);
    nodes.forEach((el, idx) => {
      if (hasAccessibleName(el)) return;
      const source = extractSource(el);
      if (isMathPlaceholder(el, source)) return;
      const renderedSvg = !source ? getRenderedSvg(el) : null;
      findings.push({
        message: source
          ? `Math expression has no aria-label; source available (${source.kind}).`
          : renderedSvg
            ? 'Math expression has no aria-label; rendered MathJax SVG is available for vision description.'
            : 'Math expression has no aria-label and no recoverable source (LaTeX/MathML). Manual review needed.',
        selector: buildSelector(el, idx),
        snippet: el.outerHTML.slice(0, 300),
        fixable: Boolean(source || renderedSvg),
        data: {
          sourceKind: source?.kind ?? (renderedSvg ? 'svg' : 'none'),
          source: source?.value,
          reason: source ? 'missing-aria-label' : (renderedSvg ? 'rendered-svg' : 'no-recoverable-source'),
        },
      });
    });
    return findings;
  },

  async fix(doc, finding, ctx) {
    const nodes = collectMathNodes(doc);
    // Match by selector idx
    const idxMatch = finding.selector?.match(/:nth-of-type\((\d+)\)/);
    const target = idxMatch ? nodes[Number(idxMatch[1]) - 1] : nodes.find((el) => !hasAccessibleName(el));
    if (!target) return false;

    const kind = String(finding.data?.sourceKind ?? 'none');
    const source = finding.data?.source as string | undefined;

    try {
      const describer = new MathDescriber({
        client: ctx.getLlm?.() ?? ctx.llm,
        consumeLlmCall: ctx.consumeLlmCall,
      });
      let description: string | null = null;
      if (kind === 'latex' && source) description = await describer.fromLatex(source);
      else if (kind === 'mathml' && source) description = await describer.fromMathML(source);
      else if (kind === 'svg') {
        const svg = getRenderedSvg(target);
        if (!svg) return false;
        description = await describer.fromSvg(svg);
      }
      if (!description) return false;
      target.setAttribute('aria-label', description);
      if (!target.hasAttribute('role')) target.setAttribute('role', 'math');
      target.querySelectorAll('svg').forEach((svg) => {
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.recordFixError?.(`Could not generate math aria-label: ${message}`);
      if (process.env.DEBUG) console.error('math-accessible fix failed:', err);
      return false;
    }
  },
};

function collectMathNodes(doc: Document): Element[] {
  const seen = new Set<Element>();
  const out: Element[] = [];
  const selectors = ['mjx-container', 'math', '.math-inline', '.math-display', '[data-mathjax]', '[data-latex]'];
  for (const sel of selectors) {
    doc.querySelectorAll(sel).forEach((el) => {
      if (seen.has(el)) return;
      // Skip nested matches — pick the outermost container
      const hasAncestorMatch = selectors.some((s) => el.parentElement?.closest(s) && s !== sel);
      if (hasAncestorMatch) return;
      seen.add(el);
      out.push(el);
    });
  }
  return out;
}

function hasAccessibleName(el: Element): boolean {
  const label = el.getAttribute('aria-label');
  if (label && label.trim().length >= 2) return true;
  if (el.hasAttribute('aria-labelledby')) return true;
  const alttext = el.getAttribute('alttext');
  if (alttext && alttext.trim().length >= 2) return true;
  if (el.querySelector('mjx-assistive-mml')) return true;
  // A parent-level label counts (some MathJax pipelines label the wrapper span)
  const parent = el.parentElement;
  if (parent?.getAttribute('aria-label')?.trim()) return true;
  return false;
}

interface MathSource {
  kind: 'latex' | 'mathml';
  value: string;
}

/**
 * Placeholder math nodes are empty shells with no real math inside —
 * typically authored `\[\]` stubs or leftover markup. They produce
 * unfixable findings, so skip them at detection. A node with a rendered
 * MathJax SVG (or mjx-math child) is real math even if the LaTeX source
 * wasn't preserved in mode=edit — flag (don't skip) those so manual
 * review surfaces them.
 */
function isMathPlaceholder(el: Element, source: MathSource | null): boolean {
  // Whitespace-only LaTeX (`\[\]`, `  `, ``) is a real placeholder.
  if (source?.kind === 'latex' && !source.value.trim()) return true;
  if (source) return false;

  // No source: check for rendered math structure or visible glyph text.
  if ((el.textContent ?? '').trim()) return false;
  const hasMathJaxRender = el.querySelector('svg, mjx-math, mjx-assistive-mml');
  if (hasMathJaxRender) return false;

  // No source, no rendered math, no text → empty shell.
  return true;
}

function extractSource(el: Element): MathSource | null {
  // LaTeX lives in one of these commonly
  const latexAttrs = ['data-latex', 'data-tex', 'data-original-tex', 'data-mathjax-latex'];
  for (const a of latexAttrs) {
    const v = el.getAttribute(a);
    if (v && v.trim()) return { kind: 'latex', value: v };
  }
  // Sometimes sibling <script type="math/tex"> holds it
  const sibling = el.parentElement?.querySelector('script[type^="math/tex"]');
  if (sibling?.textContent?.trim()) return { kind: 'latex', value: sibling.textContent };

  // MathML — either the element itself or embedded
  if (el.tagName.toLowerCase() === 'math') {
    return { kind: 'mathml', value: el.outerHTML };
  }
  const inlineMml = el.querySelector('math');
  if (inlineMml) return { kind: 'mathml', value: inlineMml.outerHTML };

  // data-mathml attribute
  const dm = el.getAttribute('data-mathml') ?? el.getAttribute('data-original-mml');
  if (dm && dm.trim()) return { kind: 'mathml', value: dm };

  return null;
}

function getRenderedSvg(el: Element): string | null {
  const svg = el.tagName.toLowerCase() === 'svg'
    ? el
    : el.querySelector('svg');
  const outer = svg?.outerHTML?.trim();
  return outer || null;
}

function buildSelector(el: Element, idx: number): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  return `${tag}:nth-of-type(${idx + 1})`;
}
