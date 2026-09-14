import { isIP } from 'node:net';
export function publicIPv4(ip) {
  if (isIP(ip) !== 4) return false;
  const [a,b] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)));
}
export function allowedRequest(raw, hosts, method = 'GET') {
  try { const u = new URL(raw); return ['GET','HEAD'].includes(method) && u.protocol === 'https:' &&
    !u.username && !u.password && (!u.port || u.port === '443') && hosts.has(u.hostname); } catch { return false; }
}
export function pageURL(raw) {
  const u = new URL(raw), path = decodeURIComponent(u.pathname);
  if (!allowedRequest(raw, new Set(['dev.libretexts.org'])) ||
    !(path === '/Sandboxes/johnnyphung' || path.startsWith('/Sandboxes/johnnyphung/'))) throw Error('Page outside configured sandbox.');
  return u.href;
}
