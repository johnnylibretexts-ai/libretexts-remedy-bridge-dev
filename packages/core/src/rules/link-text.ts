import type { Rule } from '../types.js';

const GENERIC_PHRASES = new Set([
  'click here',
  'here',
  'read more',
  'more',
  'link',
  'this link',
  'this',
  'learn more',
]);

/**
 * WCAG 2.4.4 Link Purpose.
 *
 * Flags:
 *   - empty link text,
 *   - bare-URL link text (href === text),
 *   - generic phrases ("click here", "read more", etc.).
 */
export const linkTextRule: Rule = {
  id: 'link-text-descriptive',
  wcag: '2.4.4',
  severity: 'warning',
  description: 'Link text must describe the destination; avoid "click here" or bare URLs.',
  fix(doc, finding) {
    // Only attempt the bare-URL case; generic-phrase and empty-text need human context.
    if (finding.data?.reason !== 'bare-url') return false;
    const href = String(finding.data.href);
    const text = String(finding.data.text);
    const anchors = Array.from(doc.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const target = anchors.find(
      (a) => (a.getAttribute('href') ?? '') === href && (a.textContent ?? '').trim() === text,
    );
    if (!target) return false;
    target.textContent = humanizeUrl(href);
    return true;
  },
  detect(doc) {
    const findings: ReturnType<Rule['detect']> = [];
    const anchors = Array.from(doc.querySelectorAll('a[href]'));

    anchors.forEach((a, idx) => {
      const href = (a.getAttribute('href') ?? '').trim();
      if (!href || href.startsWith('#')) return;
      const text = (a.textContent ?? '').trim();
      const selector = `a:nth-of-type(${idx + 1})`;

      if (!text) {
        // An <a> that wraps only an <img> is fine if the img has alt — that's checked by img-alt.
        if (a.querySelector('img')) return;
        findings.push({
          message: `Link has empty text (href=${truncate(href, 60)})`,
          selector,
          snippet: a.outerHTML.slice(0, 200),
          data: { href, reason: 'empty-text' },
        });
        return;
      }

      if (text === href || isBareUrl(text)) {
        findings.push({
          message: `Link text is a bare URL: "${truncate(text, 80)}"`,
          selector,
          snippet: a.outerHTML.slice(0, 200),
          data: { href, text, reason: 'bare-url' },
        });
        return;
      }

      if (GENERIC_PHRASES.has(text.toLowerCase())) {
        findings.push({
          message: `Link text is non-descriptive: "${text}"`,
          selector,
          snippet: a.outerHTML.slice(0, 200),
          data: { href, text, reason: 'generic-phrase' },
        });
      }
    });

    return findings;
  },
};

function isBareUrl(s: string): boolean {
  return /^https?:\/\/\S+$/.test(s.trim());
}

function humanizeUrl(href: string): string {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, '');
    const segs = url.pathname.split('/').filter(Boolean);
    const last = segs.at(-1);
    if (!last) return host;
    const pretty = decodeURIComponent(last)
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/%20/g, ' ')
      .trim();
    if (pretty.length < 3) return host;
    return `${pretty} (${host})`;
  } catch {
    return href;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
