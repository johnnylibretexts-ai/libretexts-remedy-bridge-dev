import type { Rule } from '../types.js';

/**
 * WCAG 1.3.1 Info and Relationships (heading hierarchy).
 *
 * Flags skipped heading levels (e.g. h2 → h4) and empty headings.
 * Does NOT flag "first heading must be h1" because LibreTexts pages
 * commonly start at h2 (h1 is the page title rendered by the platform).
 */
export const headingOrderRule: Rule = {
  id: 'heading-order',
  wcag: '1.3.1',
  severity: 'warning',
  description: 'Heading levels must not skip (e.g. h2 → h4) and must not be empty.',
  detect(doc) {
    const findings: ReturnType<Rule['detect']> = [];
    const headings = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    let prevLevel = 0;

    headings.forEach((h) => {
      const level = Number(h.tagName.substring(1));
      const text = (h.textContent ?? '').trim();

      if (!text) {
        findings.push({
          message: `Empty <${h.tagName.toLowerCase()}> heading`,
          selector: elementSelector(h),
          snippet: h.outerHTML.slice(0, 200),
          data: { level, reason: 'empty' },
        });
      }

      if (prevLevel > 0 && level > prevLevel + 1) {
        findings.push({
          message: `Heading level skipped: h${prevLevel} followed by h${level} ("${truncate(text, 60)}")`,
          selector: elementSelector(h),
          snippet: h.outerHTML.slice(0, 200),
          data: { from: prevLevel, to: level, text, reason: 'skipped-level' },
        });
      }

      prevLevel = level;
    });

    return findings;
  },
};

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function elementSelector(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.tagName !== 'BODY') {
    const index = current.parentElement ? Array.from(current.parentElement.children).indexOf(current) + 1 : 1;
    parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
    current = current.parentElement;
  }
  return 'body > ' + parts.join(' > ');
}
