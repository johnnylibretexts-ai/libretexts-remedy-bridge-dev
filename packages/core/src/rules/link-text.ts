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
    const href = String(finding.data?.href ?? '');
    const text = String(finding.data?.text ?? '');
    if (!href) return false;
    const anchors = Array.from(doc.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const target = anchors.find(
      (a) => (a.getAttribute('href') ?? '') === href && (a.textContent ?? '').trim() === text,
    );
    if (!target) return false;

    if (finding.data?.reason === 'bare-url') {
      target.textContent = humanizeUrl(href);
      return true;
    }

    if (finding.data?.reason === 'external-unlabeled') {
      const label = destinationLabel(href);
      if (!label || !text) return false;
      target.textContent = `${text} (${label})`;
      return true;
    }

    return false;
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

      if (isExternalHref(href) && !hasDestinationLabel(a, href)) {
        findings.push({
          message: `External link text should identify the third-party destination: "${truncate(text, 80)}" -> ${truncate(href, 80)}`,
          selector,
          snippet: a.outerHTML.slice(0, 200),
          data: { href, text, reason: 'external-unlabeled' },
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

function isExternalHref(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  try {
    const host = new URL(href).hostname.toLowerCase();
    return !/(^|\.)libretexts\.org$/.test(host)
      && !/(^|\.)libretexts\.net$/.test(host)
      && !/(^|\.)libretexts\.com$/.test(host);
  } catch {
    return false;
  }
}

function hasDestinationLabel(a: Element, href: string): boolean {
  const label = destinationLabel(href);
  if (!label) return true;
  const host = hostname(href);
  const siteName = label.split('.')[0] ?? label;
  const text = [
    a.textContent,
    a.getAttribute('aria-label'),
    a.getAttribute('title'),
  ].filter(Boolean).join(' ').toLowerCase();
  return text.includes(label.toLowerCase())
    || text.includes(host.toLowerCase())
    || text.includes(siteName.toLowerCase());
}

function destinationLabel(href: string): string | null {
  const host = hostname(href);
  if (!host) return null;
  const parts = host.replace(/^www\./, '').split('.');
  if (parts.length < 2) return host;
  return parts.slice(-2).join('.');
}

function hostname(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
