/**
 * SSRF guard for outbound fetches of content-controlled URLs.
 *
 * Image `src` values come from scraped CXone page HTML, i.e. they are
 * attacker-influenceable. Fetching them blindly (then handing the bytes to an
 * LLM) is a Server-Side Request Forgery vector — a crafted `src` pointing at
 * `http://169.254.169.254/…` (cloud metadata), `http://localhost:…`, or an
 * internal RFC-1918 host would make Remedy issue requests into private
 * infrastructure on the operator's behalf.
 *
 * Default policy: allow public hosts, BLOCK loopback / private / link-local /
 * ULA / CGNAT / multicast addresses and internal-only hostnames. This closes
 * the dangerous targets without breaking legitimate public image CDNs (e.g.
 * cdn.mathpix.com). Set REMEDY_IMAGE_FETCH_ALLOWLIST to a comma-separated list
 * of host suffixes to switch to a strict positive allowlist (lock-down mode).
 *
 * Residual limitation: these checks are synchronous and do not perform DNS
 * resolution, so a public hostname that resolves to a private address
 * (DNS-rebinding) is not caught here. For this local-staff tool the realistic
 * vector is a literal internal IP / hostname in page content, which IS blocked.
 */

export class SsrfBlockedError extends Error {
  constructor(url: string, reason: string) {
    super(`Blocked outbound fetch to ${url}: ${reason}`);
    this.name = 'SsrfBlockedError';
  }
}

export type FetchGuardResult = { ok: true } | { ok: false; reason: string };

/** Pure predicate form — returns a reason string when the URL is disallowed. */
export function isImageFetchAllowed(
  rawUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): FetchGuardResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }

  // `data:` URLs are inline bytes — decoding them issues no network request, so
  // they carry no SSRF risk and are always allowed.
  if (url.protocol === 'data:') return { ok: true };

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `scheme ${url.protocol} not allowed` };
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return { ok: false, reason: 'empty host' };

  const ipReason = blockedIpReason(host);
  if (ipReason) return { ok: false, reason: ipReason };

  if (!isIpLiteral(host)) {
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === 'metadata.google.internal'
    ) {
      return { ok: false, reason: 'internal hostname' };
    }
    if (!host.includes('.')) {
      return { ok: false, reason: 'bare hostname (no public domain)' };
    }
  }

  const allowlist = (env.REMEDY_IMAGE_FETCH_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length > 0) {
    const matches = allowlist.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
    if (!matches) return { ok: false, reason: 'host not in REMEDY_IMAGE_FETCH_ALLOWLIST' };
  }

  return { ok: true };
}

/** Throwing form for call sites that should abort on a blocked URL. */
export function assertImageFetchAllowed(rawUrl: string, env: NodeJS.ProcessEnv = process.env): void {
  const result = isImageFetchAllowed(rawUrl, env);
  if (!result.ok) throw new SsrfBlockedError(rawUrl, result.reason);
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function blockedIpReason(host: string): string | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const octets = host.split('.').map(Number);
    if (octets.some((n) => n > 255)) return 'invalid IPv4';
    return blockedV4(octets);
  }
  if (host.includes(':')) return blockedV6(host);
  return null;
}

function blockedV4(o: number[]): string | null {
  const [a, b] = o;
  if (a === 0) return 'reserved 0.0.0.0/8';
  if (a === 10) return 'private 10.0.0.0/8';
  if (a === 127) return 'loopback 127.0.0.0/8';
  if (a === 169 && b === 254) return 'link-local 169.254.0.0/16 (cloud metadata)';
  if (a === 172 && b >= 16 && b <= 31) return 'private 172.16.0.0/12';
  if (a === 192 && b === 168) return 'private 192.168.0.0/16';
  if (a === 100 && b >= 64 && b <= 127) return 'CGNAT 100.64.0.0/10';
  if (a === 192 && b === 0 && o[2] === 0) return 'reserved 192.0.0.0/24';
  if (a >= 224) return 'multicast/reserved address';
  return null;
}

function blockedV6(host: string): string | null {
  const h = host.toLowerCase();
  if (h === '::1') return 'loopback ::1';
  if (h === '::') return 'unspecified ::';
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
    return 'link-local fe80::/10';
  }
  if (h.startsWith('fc') || h.startsWith('fd')) return 'unique-local fc00::/7';
  const mapped = h.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return blockedV4(mapped[1].split('.').map(Number));
  return null;
}
