import type { Rule } from '../types.js';
import { inferHeaderScopes, slugifyHeaderId } from '../ai/table-helpers.js';

/**
 * WCAG 1.3.1 Info and Relationships — structural remediation for data
 * tables that already have `<th>` cells but lack scope attributes, a
 * `<thead>`/`<tbody>` grouping, or `id`/`headers` association between
 * header and data cells.
 *
 * Runs AFTER {@link tableHeaderRule}, which handles the td→th promotion
 * when no headers exist at all. This rule does NOT duplicate that logic.
 *
 * Ported (in shape, not verbatim) from project-remedy-server's
 * `TableRemediation` — see `accessibility_strategies.py`, specifically
 * `_fix_missing_scope`, `_fix_missing_thead`, `_fix_missing_tbody`, and
 * `_fix_header_ids`.
 */
export const tableStructureRule: Rule = {
  id: 'table-structure',
  wcag: '1.3.1',
  severity: 'warning',
  description:
    'Data tables need scope on <th>, <thead>/<tbody> grouping, and id/headers linkage between headers and cells.',

  detect(doc) {
    const findings: ReturnType<Rule['detect']> = [];
    const tables = Array.from(doc.querySelectorAll('table'));
    tables.forEach((t, idx) => {
      if (isPresentation(t)) return;
      const ths = Array.from(t.querySelectorAll('th'));
      if (ths.length === 0) return; // table-header rule covers the no-<th> case

      const problems: string[] = [];
      const missingScope = ths.some((th) => !th.getAttribute('scope'));
      if (missingScope) problems.push('missing-scope');

      if (!t.querySelector('thead') && firstRowHasTh(t)) problems.push('missing-thead');
      if (!t.querySelector('tbody')) problems.push('missing-tbody');

      const missingIds = ths.some((th) => !th.getAttribute('id'));
      const tdsWithoutHeaders = Array.from(t.querySelectorAll('td')).some(
        (td) => !td.getAttribute('headers'),
      );
      if (missingIds || tdsWithoutHeaders) problems.push('missing-header-ids');

      if (problems.length === 0) return;

      findings.push({
        message: `<table> structure needs work: ${problems.join(', ')}`,
        selector: `table:nth-of-type(${idx + 1})`,
        snippet: t.outerHTML.slice(0, 300),
        data: { problems, tableIndex: idx },
      });
    });
    return findings;
  },

  async fix(doc, finding) {
    const tables = Array.from(doc.querySelectorAll('table'));
    const idxMatch = finding.selector?.match(/:nth-of-type\((\d+)\)/);
    const tableIndex =
      typeof finding.data?.tableIndex === 'number'
        ? (finding.data.tableIndex as number)
        : idxMatch
          ? Number(idxMatch[1]) - 1
          : -1;
    const target = tables[tableIndex];
    if (!target || isPresentation(target)) return false;

    const ths = Array.from(target.querySelectorAll('th'));
    if (ths.length === 0) return false;

    let changed = false;

    if (await applyMissingScope(doc, target, ths)) changed = true;
    if (wrapMissingThead(doc, target)) changed = true;
    if (wrapMissingTbody(doc, target)) changed = true;
    if (applyHeaderIds(target)) changed = true;

    return changed;
  },
};

function isPresentation(t: Element): boolean {
  const role = (t.getAttribute('role') ?? '').toLowerCase();
  return role === 'presentation' || role === 'none';
}

function firstRowHasTh(t: Element): boolean {
  const firstRow = t.querySelector('tr');
  return !!firstRow && !!firstRow.querySelector('th');
}

// ---- scope ---------------------------------------------------------------

async function applyMissingScope(
  _doc: Document,
  table: Element,
  ths: Element[],
): Promise<boolean> {
  const needsScope = ths.filter((th) => !th.getAttribute('scope'));
  if (needsScope.length === 0) return false;

  const headerTexts = needsScope.map((th) => textOf(th));
  let aiMap: Record<string, 'col' | 'row'> = {};
  try {
    aiMap = await inferHeaderScopes(table.outerHTML, headerTexts);
  } catch (err) {
    if (process.env.DEBUG) console.error('table-structure scope inference failed:', err);
    aiMap = {};
  }

  for (const th of needsScope) {
    const text = textOf(th);
    let scope: 'col' | 'row' | undefined;
    if (text && aiMap[text]) {
      scope = aiMap[text];
    } else if (text) {
      const fuzzy = fuzzyLookup(aiMap, text);
      if (fuzzy) scope = fuzzy;
    }
    if (!scope) scope = inferScopeFromPosition(table, th);
    th.setAttribute('scope', scope);
  }
  return true;
}

function fuzzyLookup(
  map: Record<string, 'col' | 'row'>,
  text: string,
): 'col' | 'row' | undefined {
  if (!text) return undefined;
  const norm = text.toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    const kn = k.toLowerCase();
    if (kn === norm || kn.includes(norm) || norm.includes(kn)) return v;
  }
  return undefined;
}

function inferScopeFromPosition(table: Element, th: Element): 'col' | 'row' {
  const parentRow = th.parentElement;
  if (!parentRow || parentRow.tagName.toLowerCase() !== 'tr') return 'col';

  const parentSection = parentRow.parentElement;
  if (parentSection && parentSection.tagName.toLowerCase() === 'thead') return 'col';

  const allRows = Array.from(table.querySelectorAll('tr'));
  const rowIndex = allRows.indexOf(parentRow as HTMLTableRowElement);
  const cells = Array.from(parentRow.querySelectorAll(':scope > th, :scope > td'));
  const cellIndex = cells.indexOf(th as HTMLTableCellElement);

  if (rowIndex === 0) return 'col';
  if (cellIndex === 0) return 'row';
  return 'col';
}

// ---- thead / tbody -------------------------------------------------------

function wrapMissingThead(doc: Document, table: Element): boolean {
  if (table.querySelector('thead')) return false;
  const firstRow = table.querySelector('tr');
  if (!firstRow || !firstRow.querySelector('th')) return false;
  const thead = doc.createElement('thead');
  firstRow.parentNode?.removeChild(firstRow);
  thead.appendChild(firstRow);
  table.insertBefore(thead, table.firstChild);
  return true;
}

function wrapMissingTbody(doc: Document, table: Element): boolean {
  if (table.querySelector('tbody')) return false;
  const rows = Array.from(table.querySelectorAll('tr')).filter((tr) => {
    const parent = tr.parentElement?.tagName.toLowerCase();
    return parent !== 'thead' && parent !== 'tfoot';
  });
  if (rows.length === 0) return false;
  const tbody = doc.createElement('tbody');
  for (const row of rows) {
    row.parentNode?.removeChild(row);
    tbody.appendChild(row);
  }
  const thead = table.querySelector('thead');
  if (thead && thead.parentElement === table) {
    thead.insertAdjacentElement('afterend', tbody);
  } else {
    table.appendChild(tbody);
  }
  return true;
}

// ---- id / headers= -------------------------------------------------------

function applyHeaderIds(table: Element): boolean {
  const ths = Array.from(table.querySelectorAll('th'));
  if (ths.length === 0) return false;

  let changed = false;
  const used = new Set<string>();
  // Collect already-used ids so we don't stomp.
  for (const th of ths) {
    const existing = th.getAttribute('id');
    if (existing) used.add(existing);
  }

  ths.forEach((th, i) => {
    if (th.getAttribute('id')) return;
    let id = slugifyHeaderId(textOf(th), i);
    let suffix = 2;
    const base = id;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    th.setAttribute('id', id);
    changed = true;
  });

  // Build position -> id map based on row/col indices, accounting for
  // simple colspan/rowspan geometry so a spanned header labels every covered
  // data column.
  const placements = buildCellPlacements(table);
  const headerByPos = new Map<string, string>();
  for (const placement of placements) {
    if (placement.cell.tagName.toLowerCase() !== 'th') continue;
    const id = placement.cell.getAttribute('id');
    if (!id) continue;
    for (let rowIdx = placement.rowStart; rowIdx <= placement.rowEnd; rowIdx += 1) {
      for (let colIdx = placement.colStart; colIdx <= placement.colEnd; colIdx += 1) {
        headerByPos.set(`${rowIdx}:${colIdx}`, id);
      }
    }
  }

  // Link data cells via headers="...". Column header is the th at (0, col);
  // row header is the th at (row, 0) when present.
  for (const placement of placements) {
    const cell = placement.cell;
    if (cell.tagName.toLowerCase() !== 'td') continue;
    const ids: string[] = [];
    for (let colIdx = placement.colStart; colIdx <= placement.colEnd; colIdx += 1) {
      const colHeader = headerByPos.get(`0:${colIdx}`);
      if (colHeader && !ids.includes(colHeader)) ids.push(colHeader);
    }
    const rowHeader = headerByPos.get(`${placement.rowStart}:0`);
    if (rowHeader && !ids.includes(rowHeader)) ids.push(rowHeader);
    if (ids.length === 0) continue;
    const joined = ids.join(' ');
    if (cell.getAttribute('headers') === joined) continue;
    cell.setAttribute('headers', joined);
    changed = true;
  }

  return changed;
}

interface CellPlacement {
  cell: Element;
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
}

function buildCellPlacements(table: Element): CellPlacement[] {
  const rows = Array.from(table.querySelectorAll('tr'));
  const occupied = new Set<string>();
  const placements: CellPlacement[] = [];

  rows.forEach((row, rowIdx) => {
    let colIdx = 0;
    const cells = Array.from(row.querySelectorAll(':scope > th, :scope > td'));
    for (const cell of cells) {
      while (occupied.has(`${rowIdx}:${colIdx}`)) colIdx += 1;
      const colspan = span(cell.getAttribute('colspan'));
      const rowspan = span(cell.getAttribute('rowspan'));
      const placement = {
        cell,
        rowStart: rowIdx,
        rowEnd: rowIdx + rowspan - 1,
        colStart: colIdx,
        colEnd: colIdx + colspan - 1,
      };
      placements.push(placement);
      for (let r = placement.rowStart; r <= placement.rowEnd; r += 1) {
        for (let c = placement.colStart; c <= placement.colEnd; c += 1) {
          occupied.add(`${r}:${c}`);
        }
      }
      colIdx = placement.colEnd + 1;
    }
  });

  return placements;
}

function span(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function textOf(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}
