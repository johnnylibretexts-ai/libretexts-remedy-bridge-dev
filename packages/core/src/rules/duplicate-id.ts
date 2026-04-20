import type { Rule } from '../types.js';

/**
 * WCAG 4.1.1 Parsing — id must be unique.
 */
export const duplicateIdRule: Rule = {
  id: 'duplicate-id',
  wcag: '4.1.1',
  severity: 'error',
  description: 'Element ids must be unique within the document.',
  fix(doc, finding) {
    const id = String(finding.data?.id ?? '');
    if (!id) return false;
    const matches = Array.from(doc.querySelectorAll(`[id="${id.replace(/"/g, '\\"')}"]`));
    if (matches.length <= 1) return false;
    // Keep the first, rename the rest with suffixes.
    let suffix = 2;
    for (let i = 1; i < matches.length; i++) {
      let candidate = `${id}-${suffix}`;
      while (doc.getElementById(candidate)) {
        suffix++;
        candidate = `${id}-${suffix}`;
      }
      matches[i]!.setAttribute('id', candidate);
      suffix++;
    }
    return true;
  },
  detect(doc) {
    const findings: ReturnType<Rule['detect']> = [];
    const ids = new Map<string, Element[]>();
    doc.querySelectorAll('[id]').forEach((el) => {
      const id = el.getAttribute('id')!;
      const bucket = ids.get(id) ?? [];
      bucket.push(el);
      ids.set(id, bucket);
    });

    for (const [id, els] of ids) {
      if (els.length > 1) {
        findings.push({
          message: `Duplicate id "${id}" used ${els.length} times`,
          selector: `[id="${id.replace(/"/g, '\\"')}"]`,
          snippet: els[0]!.outerHTML.slice(0, 200),
          data: { id, count: els.length, reason: 'duplicate' },
        });
      }
    }
    return findings;
  },
};
