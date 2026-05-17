import type { Rule } from '../types.js';

/**
 * WCAG 1.3.1 Info and Relationships — data tables need an accessible name.
 *
 * Flags non-presentational tables that have rows but no caption, aria-label,
 * aria-labelledby text, or summary. The fixer only adds a caption when there is
 * an adjacent preceding heading, so preview/apply never invents a label.
 */
export const tableLabelRule: Rule = {
  id: 'table-label',
  wcag: '1.3.1',
  severity: 'warning',
  description: 'Data tables should have a caption or accessible table name.',

  detect(doc) {
    const findings: ReturnType<Rule['detect']> = [];
    const tables = Array.from(doc.querySelectorAll('table'));

    tables.forEach((table, index) => {
      if (isPresentation(table)) return;
      if (!table.querySelector('tr')) return;
      if (hasAccessibleName(doc, table)) return;

      findings.push({
        message: '<table> has no caption or accessible table name.',
        selector: `table:nth-of-type(${index + 1})`,
        snippet: table.outerHTML.slice(0, 300),
        data: { reason: 'missing-accessible-name', tableIndex: index },
      });
    });

    return findings;
  },

  fix(doc, finding) {
    const tables = Array.from(doc.querySelectorAll('table'));
    const tableIndex =
      typeof finding.data?.tableIndex === 'number'
        ? finding.data.tableIndex
        : tableIndexFromSelector(finding.selector);
    const target = tables[tableIndex];
    if (!target || isPresentation(target) || hasAccessibleName(doc, target)) return false;

    const headingText = findPrecedingHeadingText(target);
    if (!headingText) return false;

    const caption = doc.createElement('caption');
    caption.textContent = headingText;
    target.insertBefore(caption, target.firstChild);
    return true;
  },
};

function isPresentation(table: Element): boolean {
  const role = (table.getAttribute('role') ?? '').toLowerCase();
  return role === 'presentation' || role === 'none';
}

function hasAccessibleName(doc: Document, table: Element): boolean {
  const caption = table.querySelector(':scope > caption');
  if (textOf(caption)) return true;
  if (textOfAttribute(table, 'aria-label')) return true;
  if (textOfAttribute(table, 'summary')) return true;

  const labelledBy = table.getAttribute('aria-labelledby') ?? '';
  for (const id of labelledBy.split(/\s+/).filter(Boolean)) {
    const labelSource = doc.getElementById(id);
    if (textOf(labelSource)) return true;
  }

  return false;
}

function findPrecedingHeadingText(table: Element): string | null {
  let node: Node | null = table.previousSibling;
  while (node) {
    if (node.nodeType === 1) {
      const el = node as Element;
      if (/^h[1-6]$/i.test(el.tagName)) return textOf(el) || null;
      return null;
    }
    if (node.nodeType === 3 && textOf(node)) return null;
    node = node.previousSibling;
  }
  return null;
}

function tableIndexFromSelector(selector: string | undefined): number {
  const idxMatch = selector?.match(/:nth-of-type\((\d+)\)/);
  return idxMatch ? Number(idxMatch[1]) - 1 : -1;
}

function textOf(node: Node | null | undefined): string {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function textOfAttribute(el: Element, attr: string): string {
  return (el.getAttribute(attr) ?? '').replace(/\s+/g, ' ').trim();
}
