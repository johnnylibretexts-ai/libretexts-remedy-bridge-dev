import type { Rule } from '../types.js';

/**
 * Detects paragraphs that are short, entirely bold, end without punctuation,
 * and are followed by regular content — a common LibreTexts pattern where
 * <strong>/<b> is used instead of a real <h3>/<h4>. Meeting called this out
 * explicitly ("subsections use bold text instead of proper heading tags").
 *
 * Heuristic, high precision / moderate recall. Flag-only in MVP; a fix
 * would promote to <h3> or <h4> based on surrounding heading levels.
 */
export const headingAsBoldRule: Rule = {
  id: 'heading-as-bold',
  wcag: '1.3.1',
  severity: 'warning',
  description: 'Paragraphs consisting solely of <strong>/<b> often should be real headings.',
  fix(doc, finding) {
    const text = String(finding.data?.text ?? '');
    if (!text) return false;
    // Find the first matching <p><strong>text</strong></p>
    const paragraphs = Array.from(doc.querySelectorAll('p'));
    const target = paragraphs.find((p) => {
      const t = (p.textContent ?? '').trim();
      const kids = Array.from(p.children);
      return (
        t === text &&
        kids.length === 1 &&
        /^(strong|b)$/i.test(kids[0]!.tagName)
      );
    });
    if (!target) return false;

    // Choose heading level: one deeper than the nearest preceding heading,
    // capped at h4 to avoid runaway nesting. Default h3.
    const level = Math.min(4, deepestPrecedingLevel(target) + 1);
    const heading = doc.createElement(`h${level}`);
    heading.textContent = text;
    target.parentNode?.replaceChild(heading, target);
    return true;
  },
  detect(doc) {
    const findings: ReturnType<Rule['detect']> = [];
    const paragraphs = Array.from(doc.querySelectorAll('p'));

    paragraphs.forEach((p, idx) => {
      const text = (p.textContent ?? '').trim();
      if (!text || text.length > 120) return;

      const children = Array.from(p.children);
      const onlyBold =
        children.length === 1 &&
        /^(strong|b)$/i.test(children[0]!.tagName) &&
        p.childNodes.length === 1;

      if (!onlyBold) return;

      // A real bold sentence typically ends with punctuation. Headings don't.
      if (/[.!?:;]$/.test(text)) return;

      findings.push({
        message: `Bold paragraph may be a misused heading: "${truncate(text, 80)}"`,
        selector: `p:nth-of-type(${idx + 1})`,
        snippet: p.outerHTML.slice(0, 200),
        data: { text, reason: 'bold-as-heading' },
      });
    });

    return findings;
  },
};

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function deepestPrecedingLevel(el: Element): number {
  let node: Element | null = el.previousElementSibling;
  let deepest = 2; // default h2 (LibreTexts pages start at h2 in body)
  while (node) {
    const tag = node.tagName;
    if (/^H[1-6]$/.test(tag)) {
      deepest = Math.max(deepest, Number(tag.substring(1)));
      break;
    }
    node = node.previousElementSibling;
  }
  return deepest;
}
