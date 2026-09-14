import type { Rule } from '../types.js';

/**
 * WCAG 1.3.1 Info and Relationships — data tables need header cells.
 *
 * Flags <table> elements that contain rows but no <th>. Ignores tables
 * marked role="presentation" (intentional layout tables — discouraged
 * but not an error on their own).
 */
export const tableHeaderRule: Rule = {
  id: 'table-header',
  wcag: '1.3.1',
  severity: 'error',
  description: 'Data tables must declare header cells with <th>.',
  fix(doc, finding) {
    const tables = Array.from(doc.querySelectorAll('table'));
    const index = Number(finding.data?.tableIndex);
    const target = Number.isInteger(index) ? tables[index] : undefined;
    if (!target) return false;

    const firstRow = target.querySelector('tr');
    if (!firstRow || !hasExplicitHeaderRow(target)) return false;
    const tds = Array.from(firstRow.querySelectorAll('td'));
    if (tds.length === 0) return false;

    for (const td of tds) {
      const th = doc.createElement('th');
      th.setAttribute('scope', 'col');
      // Copy children and attributes
      for (const a of Array.from(td.attributes)) th.setAttribute(a.name, a.value);
      while (td.firstChild) th.appendChild(td.firstChild);
      td.parentNode?.replaceChild(th, td);
    }

    // Add a <caption> derived from the preceding heading when the table
    // has none. Mirrors project-remedy-server's _fix_missing_caption.
    if (!target.querySelector('caption')) {
      const headingText = findPrecedingHeadingText(target);
      if (headingText) {
        const caption = doc.createElement('caption');
        caption.textContent = headingText;
        target.insertBefore(caption, target.firstChild);
      }
    }

    // Suppress unused finding warning
    void finding;
    return true;
  },
  detect(doc) {
    const findings: ReturnType<Rule['detect']> = [];
    const tables = Array.from(doc.querySelectorAll('table'));

    tables.forEach((t, idx) => {
      if (t.getAttribute('role') === 'presentation' || t.getAttribute('role') === 'none') return;
      const rows = t.querySelectorAll('tr');
      if (rows.length === 0) return;
      const hasTh = t.querySelector('th') !== null;
      if (hasTh) return;

      findings.push({
        fixable: hasExplicitHeaderRow(t),
        message: `<table> has ${rows.length} row(s) but no <th> header cells`,
        selector: `table:nth-of-type(${idx + 1})`,
        snippet: t.outerHTML.slice(0, 300),
        data: { rows: rows.length, tableIndex: idx, reason: 'no-th', ...(!hasExplicitHeaderRow(t) ? { fixBlockedReason: 'header-meaning-required', fixBlockedMessage: 'The first row may contain data. A reviewer must identify or supply the table headers.' } : {}) },
      });
    });

    return findings;
  },
};

/**
 * Walk backward through preceding siblings (and, if none, up through
 * ancestors' previous siblings) looking for an `<h1>`–`<h6>` immediately
 * before the table. Whitespace-only text nodes are skipped.
 */
function findPrecedingHeadingText(table: Element): string | null {
  let node: Node | null = table.previousSibling;
  while (node) {
    if (node.nodeType === 1 /* Element */) {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const text = (el.textContent ?? '').trim();
        return text || null;
      }
      // Another element type — stop; don't cross structural boundaries.
      return null;
    }
    if (node.nodeType === 3 /* Text */) {
      const text = (node.textContent ?? '').trim();
      if (text) return null; // non-empty text breaks the adjacency
    }
    node = node.previousSibling;
  }
  return null;
}

function hasExplicitHeaderRow(table: Element): boolean {
  const row = table.querySelector('tr');
  const cells = row ? Array.from(row.children) : [];
  return cells.length > 0 && (!!row?.closest('thead') || cells.every(cell => cell.getAttribute('role') === 'columnheader'));
}
