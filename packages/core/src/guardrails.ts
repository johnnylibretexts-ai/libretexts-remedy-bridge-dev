import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class WriteNotAllowedError extends Error {
  constructor(path: string, allowlist: RegExp[]) {
    super(
      `Write refused: page path "${path}" does not match REMEDY_WRITE_ALLOWLIST ` +
      `(${allowlist.map((r) => r.source).join(', ')}).`,
    );
    this.name = 'WriteNotAllowedError';
  }
}

export function loadAllowlist(env: NodeJS.ProcessEnv = process.env): RegExp[] {
  const raw = env.REMEDY_WRITE_ALLOWLIST ?? '^Sandboxes/';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new RegExp(s));
}

export function assertWriteAllowed(path: string, env: NodeJS.ProcessEnv = process.env): void {
  const allowlist = loadAllowlist(env);
  const normalized = path.replace(/^\/+/, '');
  if (!allowlist.some((re) => re.test(normalized))) {
    throw new WriteNotAllowedError(normalized, allowlist);
  }
}

export function maskToken(token: string | undefined): string {
  if (!token) return '<unset>';
  if (token.length <= 8) return '****';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function hashContent(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

export interface AuditEntry {
  ts: string;
  page: { id: number; path: string; hostname: string };
  rules: string[];
  mode: 'preview' | 'apply' | 'revert';
  beforeHash: string;
  afterHash: string;
  operator: string;
  revisionSummary?: string;
  /** Path on disk to the HTML snapshot of the before-state (if saved). */
  snapshotPath?: string;
  /** CXone revision ID returned by postPageContents, when available. */
  cxoneRevisionId?: string | number;
  /** If this entry is a revert, points back to the audit entry it's undoing. */
  revertedFrom?: string;
  /** True when the Patch API wrote only changed bytes; false = full-rewrite fallback. */
  bytePreserved?: boolean;
  /** Present when bytePreserved=false. */
  fallbackReason?: 'unsupported-mutation' | 'no-source-location' | 'verification-mismatch' | 'parse-error';
  /** Count of splices applied in a successful byte-preserve. */
  splicesApplied?: number;
}

export async function appendAudit(
  entry: AuditEntry,
  logPath: string = process.env.REMEDY_AUDIT_LOG ?? '.remedy/audit.log',
): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, JSON.stringify(entry) + '\n', 'utf8');
}

export function operatorFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.USER ?? env.LOGNAME ?? env.USERNAME ?? 'unknown';
}

/* -------------------------------------------------------------------------- *
 * Snapshots — pre-write on-disk copies of the page HTML so we can always
 * revert, even if CXone revision retention is limited.
 * -------------------------------------------------------------------------- */

export interface SnapshotMeta {
  /** ISO 8601 write timestamp. */
  ts: string;
  /** CXone page id. */
  pageId: number;
  /** Full page path (e.g. "Sandboxes/johnnyphung/…"). */
  pagePath: string;
  /** Hostname the page was fetched from (e.g. "dev.libretexts.org"). */
  hostname: string;
  /** Operator who initiated the write. */
  operator: string;
  /** SHA-256 hash (first 16 hex chars) of the HTML. */
  hash: string;
  /** Rule ids that will be applied after this snapshot. */
  rules: string[];
  /** The CLI revision summary about to be written. */
  revisionSummary?: string;
  /** The tier or mode that produced the snapshot. */
  source?: 'fix' | 'pipeline' | 'revert';
  /** Size of the HTML in bytes. */
  bytes: number;
}

export interface SnapshotEntry {
  htmlPath: string;
  metaPath: string;
  meta: SnapshotMeta;
}

function snapshotRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.REMEDY_SNAPSHOT_DIR ?? '.remedy/snapshots';
}

function snapshotDir(pageId: number, env: NodeJS.ProcessEnv = process.env): string {
  return join(snapshotRoot(env), String(pageId));
}

/**
 * Write a pre-apply snapshot to disk. Always returns the absolute path so
 * callers can record it in the audit log.
 *
 * Files written:
 *   {REMEDY_SNAPSHOT_DIR}/{pageId}/{YYYYMMDDTHHMMSSZ}_{hash}.html
 *   {REMEDY_SNAPSHOT_DIR}/{pageId}/{YYYYMMDDTHHMMSSZ}_{hash}.json
 *
 * The .html is the raw page body *before* the planned write. The .json has
 * the metadata needed for the `revert` command to identify and restore it.
 */
export async function saveSnapshot(
  html: string,
  meta: Omit<SnapshotMeta, 'ts' | 'hash' | 'bytes'>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SnapshotEntry> {
  const ts = new Date().toISOString();
  const hash = hashContent(html);
  const full: SnapshotMeta = { ...meta, ts, hash, bytes: Buffer.byteLength(html, 'utf8') };
  const stamp = ts.replace(/[:.]/g, '-');
  const dir = snapshotDir(meta.pageId, env);
  const base = `${stamp}_${hash}`;
  const htmlPath = join(dir, `${base}.html`);
  const metaPath = join(dir, `${base}.json`);
  await mkdir(dir, { recursive: true });
  await writeFile(htmlPath, html, 'utf8');
  await writeFile(metaPath, JSON.stringify(full, null, 2), 'utf8');
  return { htmlPath, metaPath, meta: full };
}

/** List snapshots for a page, newest first. */
export async function listSnapshots(
  pageId: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SnapshotEntry[]> {
  const dir = snapshotDir(pageId, env);
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const metas = entries.filter((f) => f.endsWith('.json')).sort().reverse();
  const out: SnapshotEntry[] = [];
  for (const f of metas) {
    const metaPath = join(dir, f);
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as SnapshotMeta;
      out.push({ metaPath, htmlPath: metaPath.replace(/\.json$/, '.html'), meta });
    } catch {
      // ignore malformed
    }
  }
  return out;
}

/** Read a snapshot's HTML + metadata, resolved by timestamp or by explicit path. */
export async function readSnapshot(
  entryOrPath: SnapshotEntry | string,
): Promise<{ html: string; meta: SnapshotMeta }> {
  const metaPath = typeof entryOrPath === 'string' ? entryOrPath : entryOrPath.metaPath;
  const htmlPath = metaPath.replace(/\.json$/, '.html');
  const [html, metaJson] = await Promise.all([readFile(htmlPath, 'utf8'), readFile(metaPath, 'utf8')]);
  return { html, meta: JSON.parse(metaJson) as SnapshotMeta };
}

/**
 * Extract a CXone revision identifier out of the loosely-typed postPageContents
 * response. The SDK returns an XML-derived JSON shape; revision lives under a
 * few different keys depending on content-type. Returns undefined if not found.
 */
export function extractRevisionId(pageResponse: unknown): string | number | undefined {
  if (!pageResponse || typeof pageResponse !== 'object') return undefined;
  const r = pageResponse as Record<string, unknown>;
  const page = (r.page ?? r) as Record<string, unknown> | undefined;
  if (!page) return undefined;
  const rev = (page as Record<string, unknown>)['@revision'] ?? (page as Record<string, unknown>)['revision'];
  if (typeof rev === 'string' || typeof rev === 'number') return rev;
  if (rev && typeof rev === 'object' && '#text' in (rev as Record<string, unknown>)) {
    const t = (rev as Record<string, unknown>)['#text'];
    if (typeof t === 'string' || typeof t === 'number') return t;
  }
  return undefined;
}
