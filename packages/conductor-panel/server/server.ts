/**
 * Minimal Node API server for the Conductor panel.
 *
 * Exposes /api/scan, /api/preview, /api/apply — thin wrappers around
 * @libretexts/remedy-core. Only runs locally for staff use; do not
 * expose to the public internet without auth.
 */
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import {
  createExpertClient,
  resolvePageRef,
  scanPage,
  fetchPageHtml,
  fixPage,
  runPipeline,
  canonicalizeHtml,
  runLocalPipeline,
  hashContent,
  writePageRevision,
  conductorScanKeys,
  buildConductorCriteria,
  toConductorFindings,
  buildWcagReview,
  type DojException,
  type WcagReview,
} from '@libretexts/remedy-core';

// Repo root = three dirs up from packages/conductor-panel/server/server.ts.
// Resolve from this file's URL so the server works regardless of cwd.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

loadDotenv({ path: resolve(REPO_ROOT, '.env') });

const PORT = Number(process.env.CONDUCTOR_API_PORT ?? 5175);
// Bind to loopback by default — this is a local staff tool with no auth, so it
// must not be reachable off-host. Override CONDUCTOR_API_HOST deliberately
// (and add auth) before exposing it anywhere else.
const HOST = process.env.CONDUCTOR_API_HOST ?? '127.0.0.1';
const MAX_REQUEST_BYTES = Number(process.env.REMEDY_MAX_REQUEST_BYTES ?? 5_000_000);
const FIXTURE_ROOT = resolve(REPO_ROOT, 'fixtures/local-lab');
const STATIC_ROOT = resolve(HERE, '../dist');
const PIPELINE_PREVIEW_TTL_MS = Number(process.env.REMEDY_PIPELINE_PREVIEW_TTL_MS ?? 30 * 60 * 1000);

type FixEngineMode = 'deterministic' | 'pipeline';

interface PipelinePreviewSession {
  token: string;
  expiresAt: number;
  pageId: number;
  pagePath: string;
  hostname: string;
  tier: 1 | 2 | 3;
  beforeHash: string;
  beforeHtml: string;
  afterHtml: string;
  diff: string;
  finalFindingsCount: number;
  appliedRuleIds: string[];
}

const pipelinePreviewSessions = new Map<string, PipelinePreviewSession>();
const targetedPreviewSessions = new Map<string, {
  token: string;
  expiresAt: number;
  pageId: number;
  pagePath: string;
  hostname: string;
  beforeHash: string;
  beforeHtml: string;
  afterHtml: string;
  diff: string;
  attemptedRuleIds: string[];
  appliedRuleIds: string[];
  attemptedFindingIds?: string[];
  appliedFindingIds?: string[];
  fixErrors?: unknown[];
  llmCalls?: number;
  bytePreserved?: boolean;
  fallbackReason?: string;
  splicesApplied?: number;
}>();

type Handler = (body: Record<string, unknown>) => Promise<unknown>;

const routes: Record<string, Handler> = {
  '/v1/cxone/page/scan': async (body) => {
    const page = requirePageInput(body);
    const result = await scanPage(page);
    const findings = toConductorFindings(result.findings);
    const dojExceptions = optionalDojExceptions(body.doj_exceptions ?? body.dojExceptions);
    const wcagReview = buildWcagReview({
      html: result.html,
      findings: result.findings,
      scannedAt: result.scannedAt,
      page: result.page,
      previousReview: optionalWcagReview(body.wcag_review ?? body.wcagReview),
      exceptions: dojExceptions,
    });
    return {
      page_id: result.page.id,
      page_path: result.page.path,
      page: result.page,
      page_url: optionalStr(body.page_url),
      section_title: optionalStr(body.section_title),
      criteria: buildConductorCriteria(result.findings),
      evaluated_keys: Array.from(conductorScanKeys),
      wcag_review: wcagReview,
      wcagReview,
      doj_exceptions: dojExceptions,
      dojExceptions,
      findings,
      stats: result.stats,
      scanned_at: result.scannedAt,
    };
  },

  '/v1/cxone/page/preview-fix': async (body) => {
    const page = requirePageInput(body);
    const fixMode = optionalFixMode(body.fix_mode ?? body.fixMode);
    if (fixMode === 'pipeline') {
      prunePipelinePreviewSessions();
      const tier = optionalTier(body.tier) ?? 1;
      const result = await runPipeline(page, {
        tier,
        mode: 'preview',
      });
      const token = randomUUID();
      const previewHash = hashContent(result.beforeHtml);
      pipelinePreviewSessions.set(token, {
        token,
        expiresAt: Date.now() + PIPELINE_PREVIEW_TTL_MS,
        pageId: result.pageId,
        pagePath: result.pagePath,
        hostname: result.hostname,
        tier,
        beforeHash: previewHash,
        beforeHtml: result.beforeHtml,
        afterHtml: result.finalHtml,
        diff: result.diff,
        finalFindingsCount: result.finalFindingsCount,
        appliedRuleIds: result.appliedRuleIds,
      });
      return {
        fix_mode: 'pipeline',
        page_wide: true,
        page_id: result.pageId,
        page_path: result.pagePath,
        hostname: result.hostname,
        tier,
        preview_hash: previewHash,
        preview_token: token,
        previewToken: token,
        before_html: result.beforeHtml,
        after_html: result.finalHtml,
        diff: result.diff,
        attempted_rule_ids: result.appliedRuleIds,
        applied_rule_ids: result.appliedRuleIds,
        tiers_run: result.tiersRun,
        final_findings_count: result.finalFindingsCount,
        noise_only_change: canonicalizeHtml(result.beforeHtml) === canonicalizeHtml(result.finalHtml),
      };
    }

    const findingIds = optionalStringArray(body.finding_ids ?? body.findingIds ?? body.findingIDs, 'finding_ids');
    const result = await fixPage(page, {
      mode: 'preview',
      findingIds,
    });
    prunePreviewSessions();
    const token = randomUUID();
    const previewHash = hashContent(result.before);
    targetedPreviewSessions.set(token, {
      token,
      expiresAt: Date.now() + PIPELINE_PREVIEW_TTL_MS,
      pageId: result.page.id,
      pagePath: result.page.path,
      hostname: result.page.hostname,
      beforeHash: previewHash,
      beforeHtml: result.before,
      afterHtml: result.after,
      diff: result.diff,
      attemptedRuleIds: result.attempted,
      appliedRuleIds: result.applied,
      attemptedFindingIds: result.attemptedFindingIds,
      appliedFindingIds: result.appliedFindingIds,
      fixErrors: result.fixErrors,
      llmCalls: result.llmCalls,
      bytePreserved: result.bytePreserved,
      fallbackReason: result.fallbackReason,
      splicesApplied: result.splicesApplied,
    });
    return {
      fix_mode: 'deterministic',
      page_wide: false,
      page_id: result.page.id,
      page_path: result.page.path,
      hostname: result.page.hostname,
      preview_hash: previewHash,
      preview_token: token,
      previewToken: token,
      before_html: result.before,
      after_html: result.after,
      diff: result.diff,
      attempted_rule_ids: result.attempted,
      applied_rule_ids: result.applied,
      attempted_finding_ids: result.attemptedFindingIds,
      applied_finding_ids: result.appliedFindingIds,
      fix_errors: result.fixErrors,
      llm_calls: result.llmCalls,
      noise_only_change: canonicalizeHtml(result.before) === canonicalizeHtml(result.after),
      byte_preserved: result.bytePreserved,
      fallback_reason: result.fallbackReason,
      splices_applied: result.splicesApplied,
    };
  },

  '/v1/cxone/page/apply-fix': async (body) => {
    const page = requirePageInput(body);
    const fixMode = optionalFixMode(body.fix_mode ?? body.fixMode);
    if (fixMode === 'pipeline') {
      prunePipelinePreviewSessions();
      const previewHash = requireStr(body.preview_hash ?? body.previewHash, 'preview_hash');
      const previewToken = requireStr(body.preview_token ?? body.previewToken, 'preview_token');
      const session = pipelinePreviewSessions.get(previewToken);
      if (!session || session.expiresAt <= Date.now()) {
        pipelinePreviewSessions.delete(previewToken);
        throw new HttpError(409, {
          error: 'expired_preview',
          message: 'Pipeline preview expired; refresh and preview again.',
        });
      }
      if (session.beforeHash !== previewHash) {
        throw new HttpError(409, {
          error: 'stale_preview',
          message: 'Preview hash does not match the cached pipeline preview; refresh and preview again.',
        });
      }

      const env = process.env;
      const expert = createExpertClient(env);
      const pageRef = await resolvePageRef(expert, page, env);
      if (pageRef.id !== session.pageId) {
        throw new HttpError(409, {
          error: 'preview_page_mismatch',
          message: 'Pipeline preview was created for a different page; refresh and preview again.',
        });
      }
      const currentHtml = await fetchPageHtml(expert, page);
      const currentHash = hashContent(currentHtml);
      if (currentHash !== previewHash) {
        throw new HttpError(409, {
          error: 'stale_preview',
          message: 'Page content changed since preview; refresh and preview again.',
        });
      }

      const revisionSummary = `Remedy pipeline: applied Tier ${session.tier} page-wide preview`;
      const write = await writePageRevision({
        expert,
        pageInput: page,
        page: pageRef,
        beforeHtml: currentHtml,
        afterHtml: session.afterHtml,
        rules: session.appliedRuleIds,
        revisionSummary,
        source: 'pipeline',
        env,
      });
      pipelinePreviewSessions.delete(previewToken);
      return {
        fix_mode: 'pipeline',
        page_wide: true,
        applied: write.written,
        revision_summary: write.revisionSummary,
        snapshot_path: write.snapshotPath,
        attempted_rule_ids: session.appliedRuleIds,
        applied_rule_ids: session.appliedRuleIds,
        final_findings_count: session.finalFindingsCount,
      };
    }

    const findingIds = optionalStringArray(body.finding_ids ?? body.findingIds ?? body.findingIDs, 'finding_ids');
    const previewHash = requireStr(body.preview_hash ?? body.previewHash, 'preview_hash');
    const previewToken = optionalStr(body.preview_token ?? body.previewToken);
    if (previewToken) {
      prunePreviewSessions();
      const session = targetedPreviewSessions.get(previewToken);
      if (!session || session.expiresAt <= Date.now()) {
        targetedPreviewSessions.delete(previewToken);
        throw new HttpError(409, {
          error: 'expired_preview',
          message: 'Preview expired; refresh and preview again.',
        });
      }
      if (session.beforeHash !== previewHash) {
        throw new HttpError(409, {
          error: 'stale_preview',
          message: 'Preview hash does not match the cached preview; refresh and preview again.',
        });
      }

      const env = process.env;
      const expert = createExpertClient(env);
      const pageRef = await resolvePageRef(expert, page, env);
      if (pageRef.id !== session.pageId) {
        throw new HttpError(409, {
          error: 'preview_page_mismatch',
          message: 'Preview was created for a different page; refresh and preview again.',
        });
      }
      const currentHtml = await fetchPageHtml(expert, page);
      const currentHash = hashContent(currentHtml);
      if (currentHash !== previewHash) {
        throw new HttpError(409, {
          error: 'stale_preview',
          message: 'Page content changed since preview; refresh and preview again.',
        });
      }

      const revisionSummary = `Remedy: fixed ${session.appliedFindingIds?.length ?? findingIds.length} selected finding(s)`;
      const write = await writePageRevision({
        expert,
        pageInput: page,
        page: pageRef,
        beforeHtml: currentHtml,
        afterHtml: session.afterHtml,
        rules: session.appliedRuleIds,
        revisionSummary,
        source: 'fix',
        env,
      });
      targetedPreviewSessions.delete(previewToken);
      return {
        fix_mode: 'deterministic',
        page_wide: false,
        applied: write.written,
        revision_summary: write.revisionSummary,
        snapshot_path: write.snapshotPath,
        attempted_rule_ids: session.attemptedRuleIds,
        applied_rule_ids: session.appliedRuleIds,
        attempted_finding_ids: session.attemptedFindingIds,
        applied_finding_ids: session.appliedFindingIds,
        fix_errors: session.fixErrors,
        llm_calls: session.llmCalls,
        byte_preserved: session.bytePreserved,
        fallback_reason: session.fallbackReason,
        splices_applied: session.splicesApplied,
      };
    }

    const preview = await fixPage(page, {
      mode: 'preview',
      findingIds,
    });
    const currentHash = hashContent(preview.before);
    if (currentHash !== previewHash) {
      throw new HttpError(409, {
        error: 'stale_preview',
        message: 'Page content changed since preview; refresh and preview again.',
      });
    }

    const result = await fixPage(page, {
      mode: 'apply',
      findingIds,
      revisionSummary: `Remedy: fixed ${findingIds.length} selected finding(s)`,
    });
    return {
      fix_mode: 'deterministic',
      page_wide: false,
      applied: result.written,
      revision_summary: result.revisionSummary,
      snapshot_path: result.snapshotPath,
      attempted_rule_ids: result.attempted,
      applied_rule_ids: result.applied,
      attempted_finding_ids: result.attemptedFindingIds,
      applied_finding_ids: result.appliedFindingIds,
      fix_errors: result.fixErrors,
      llm_calls: result.llmCalls,
      byte_preserved: result.bytePreserved,
      fallback_reason: result.fallbackReason,
      splices_applied: result.splicesApplied,
    };
  },

  '/api/scan': async (body) => {
    const page = requireStr(body.page, 'page');
    const result = await scanPage(page);
    // Strip html payload — the UI doesn't need the full page source.
    const { html: _unused, ...rest } = result;
    void _unused;
    return rest;
  },

  '/api/preview': async (body) => {
    const page = requireStr(body.page, 'page');
    const tier = requireTier(body.tier);
    const r = await runPipeline(page, { tier, mode: 'preview' });
    return {
      pageId: r.pageId,
      pagePath: r.pagePath,
      hostname: r.hostname,
      tiersRun: r.tiersRun.map((t) => ({ tier: t.tier, before: t.before, after: t.after, elapsedMs: t.elapsedMs })),
      finalFindingsCount: r.finalFindingsCount,
      diff: r.diff,
      beforeHtml: r.beforeHtml,
      finalHtml: r.finalHtml,
      noiseOnlyChange: canonicalizeHtml(r.beforeHtml) === canonicalizeHtml(r.finalHtml),
    };
  },

  '/api/apply': async (body) => {
    const page = requireStr(body.page, 'page');
    const tier = requireTier(body.tier);
    const r = await runPipeline(page, { tier, mode: 'apply' });
    return {
      applied: r.applied,
      applyError: r.applyError,
    };
  },

  '/api/local/fixtures': async () => {
    const entries = await readdir(FIXTURE_ROOT, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.html'));
    const out = await Promise.all(
      files.map(async (f) => {
        const full = resolve(FIXTURE_ROOT, f.name);
        const s = await stat(full);
        return { name: f.name, relPath: relative(REPO_ROOT, full), size: s.size };
      }),
    );
    out.sort((a, b) => a.name.localeCompare(b.name));
    return { fixtures: out };
  },

  '/api/local/run': async (body) => {
    const source = body.source as 'fixture' | 'inline' | undefined;
    let html: string;
    let fixtureName: string | undefined;

    if (source === 'fixture') {
      const relPath = requireStr(body.relPath, 'relPath');
      const resolved = resolve(REPO_ROOT, relPath);
      if (resolved !== FIXTURE_ROOT && !resolved.startsWith(FIXTURE_ROOT + sep)) {
        throw new Error('fixture path escapes fixture root');
      }
      html = await readFile(resolved, 'utf8');
      fixtureName = relPath;
    } else if (source === 'inline') {
      html = requireStr(body.html, 'html');
    } else {
      throw new Error('source must be "fixture" or "inline"');
    }

    const result = await runLocalPipeline(html, {
      maxLlmCalls: typeof body.maxLlm === 'number' ? body.maxLlm : undefined,
      onlyRuleIds: Array.isArray(body.onlyRuleIds) ? (body.onlyRuleIds as string[]) : undefined,
    });

    return { fixtureName, ...result };
  },
};

const server = createServer(async (req, res) => {
  setSecurityHeaders(res);
  setCors(res, req);
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.method !== 'POST' && req.method !== 'GET') {
    json(res, 405, { error: 'method not allowed' });
    return;
  }

  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  const handler = routes[pathname];
  if (!handler) {
    if (req.method === 'GET') {
      await serveStatic(pathname, res);
      return;
    }
    json(res, 404, { error: 'not found' });
    return;
  }

  try {
    const body = req.method === 'POST' ? await readJson(req) : {};
    const result = await handler(body);
    json(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) {
      json(res, err.status, err.body);
      return;
    }
    // Log full detail server-side; return a generic message so internal error
    // text (paths, upstream messages, stack-adjacent details) never leaks to
    // the client.
    console.error('[conductor-api] request failed:', err);
    json(res, 500, { error: 'internal server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[conductor-api] listening on http://${HOST}:${PORT}`);
});

// --- helpers ---
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const chunk = Buffer.isBuffer(c) ? c : Buffer.from(c);
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) {
      throw new HttpError(413, {
        error: 'payload_too_large',
        message: `Request body exceeds ${MAX_REQUEST_BYTES} bytes.`,
      });
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  return JSON.parse(text);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  if (pathname.startsWith('/api/') || pathname.startsWith('/v1/')) {
    json(res, 404, { error: 'not found' });
    return;
  }

  const requested = pathname === '/' ? '/index.html' : pathname;
  const safePath = resolve(STATIC_ROOT, `.${decodeURIComponent(requested)}`);
  if (safePath !== STATIC_ROOT && !safePath.startsWith(STATIC_ROOT + sep)) {
    json(res, 403, { error: 'forbidden' });
    return;
  }

  let filePath = safePath;
  try {
    const s = await stat(filePath);
    if (!s.isFile()) throw new Error('not a file');
  } catch {
    filePath = resolve(STATIC_ROOT, 'index.html');
  }

  try {
    const s = await stat(filePath);
    if (!s.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': contentType(filePath) });
    createReadStream(filePath).pipe(res);
  } catch {
    json(res, 404, { error: 'panel build not found' });
  }
}

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

function setCors(res: ServerResponse, req: IncomingMessage) {
  // Local staff tool: reflect only localhost origins instead of a blanket
  // wildcard on an unauthenticated, state-changing API. Requests with no Origin
  // (curl, server-to-server) are unaffected and still work.
  const origin = req.headers.origin;
  if (origin && LOCALHOST_ORIGIN.test(origin)) {
    res.setHeader('access-control-allow-origin', origin);
  }
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}

function setSecurityHeaders(res: ServerResponse) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('cache-control', 'no-store');
}

function requireStr(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`missing field: ${name}`);
  return v;
}

function requirePageInput(body: Record<string, unknown>): string | number {
  const pageUrl = optionalStr(body.page_url) ?? optionalStr(body.sectionURL) ?? optionalStr(body.page);
  if (pageUrl) return pageUrl;
  const pageId = body.page_id ?? body.pageID;
  if (typeof pageId === 'number' && Number.isFinite(pageId)) return pageId;
  if (typeof pageId === 'string' && pageId.trim()) return pageId;
  throw new Error('missing field: page_url or page_id');
}

function optionalStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function optionalStringArray(v: unknown, name: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`${name} must be an array`);
  return v.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function optionalFixMode(v: unknown): FixEngineMode {
  if (v === undefined || v === null || v === '') return 'deterministic';
  if (v === 'deterministic' || v === 'pipeline') return v;
  throw new Error('fix_mode must be deterministic|pipeline');
}

function optionalDojExceptions(v: unknown): DojException[] {
  return Array.isArray(v) ? (v as DojException[]) : [];
}

function optionalWcagReview(v: unknown): WcagReview | undefined {
  return v && typeof v === 'object' ? (v as WcagReview) : undefined;
}

function requireTier(v: unknown): 1 | 2 | 3 {
  const n = Number(v);
  if (n !== 1 && n !== 2 && n !== 3) throw new Error(`tier must be 1|2|3`);
  return n;
}

function optionalTier(v: unknown): 1 | 2 | 3 | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return requireTier(v);
}

function prunePreviewSessions(now = Date.now()): void {
  for (const [token, session] of pipelinePreviewSessions) {
    if (session.expiresAt <= now) pipelinePreviewSessions.delete(token);
  }
  for (const [token, session] of targetedPreviewSessions) {
    if (session.expiresAt <= now) targetedPreviewSessions.delete(token);
  }
}

const prunePipelinePreviewSessions = prunePreviewSessions;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(typeof body.message === 'string' ? body.message : `HTTP ${status}`);
  }
}
