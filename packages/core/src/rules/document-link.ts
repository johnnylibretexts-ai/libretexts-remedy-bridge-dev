import type { Rule } from '../types.js';

const FILETYPE_LABELS: Record<string, string> = {
  csv: 'CSV',
  doc: 'DOC',
  docx: 'DOCX',
  odp: 'ODP',
  ods: 'ODS',
  odt: 'ODT',
  pdf: 'PDF',
  ppt: 'PPT',
  pptx: 'PPTX',
  rtf: 'RTF',
  xls: 'XLS',
  xlsx: 'XLSX',
};

/**
 * WCAG 2.4.4 Link Purpose — linked documents should disclose their file type
 * in the link text or accessible label.
 */
export const documentLinkRule: Rule = {
  id: 'document-link-filetype',
  wcag: '2.4.4',
  severity: 'warning',
  description: 'Document links should include their file type in the link text or accessible label.',

  detect(doc) {
    const findings: ReturnType<Rule['detect']> = [];
    const anchors = Array.from(doc.querySelectorAll('a[href]')) as HTMLAnchorElement[];

    anchors.forEach((anchor, index) => {
      const href = (anchor.getAttribute('href') ?? '').trim();
      const ext = fileExtension(href);
      if (!ext) return;
      const label = FILETYPE_LABELS[ext];
      if (!label || hasFiletypeLabel(anchor, label)) return;

      findings.push({
        message: `Document link should include file type (${label}) in the link text or accessible label.`,
        selector: `a:nth-of-type(${index + 1})`,
        snippet: anchor.outerHTML.slice(0, 240),
        data: {
          reason: 'missing-filetype-label',
          href,
          text: (anchor.textContent ?? '').trim(),
          filetype: label,
        },
      });
    });

    return findings;
  },

  fix(doc, finding) {
    const href = String(finding.data?.href ?? '');
    const text = String(finding.data?.text ?? '');
    const filetype = String(finding.data?.filetype ?? '');
    if (!href || !text || !filetype) return false;

    const anchors = Array.from(doc.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const candidates = anchors.filter((anchor) => (anchor.getAttribute('href') ?? '').trim() === href);
    const target = candidates.find((anchor) => (anchor.textContent ?? '').trim() === text)
      ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!target || hasFiletypeLabel(target, filetype)) return false;

    target.appendChild(doc.createTextNode(` (${filetype})`));
    return true;
  },
};

function fileExtension(href: string): string | null {
  const withoutHash = href.split('#')[0] ?? href;
  const withoutQuery = withoutHash.split('?')[0] ?? withoutHash;
  const match = withoutQuery.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : null;
}

function hasFiletypeLabel(anchor: Element, filetype: string): boolean {
  const text = [
    anchor.textContent,
    anchor.getAttribute('aria-label'),
    anchor.getAttribute('title'),
  ].filter(Boolean).join(' ');
  return new RegExp(`\\b${escapeRegExp(filetype)}\\b`, 'i').test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
