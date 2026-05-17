/**
 * Minimal Node API server for the Conductor panel.
 *
 * Exposes /api/scan, /api/preview, /api/apply — thin wrappers around
 * @libretexts/remedy-core. Only runs locally for staff use; do not
 * expose to the public internet without auth.
 */
import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scanPage,
  fixPage,
  runPipeline,
  canonicalizeHtml,
  runLocalPipeline,
  hashContent,
  conductorScanKeys,
  buildConductorCriteria,
  toConductorFindings,
  buildWcagReview,
  type DojException,
  type WcagReview,
} from '@libretexts/remedy-core';

const PORT = Number(process.env.CONDUCTOR_API_PORT ?? 5175);

// Repo root = three dirs up from packages/conductor-panel/server/server.ts.
// Resolve from this file's URL so the server works regardless of cwd.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const FIXTURE_ROOT = resolve(REPO_ROOT, 'fixtures/local-lab');

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
    const findingIds = optionalStringArray(body.finding_ids ?? body.findingIds, 'finding_ids');
    const result = await fixPage(page, {
      mode: 'preview',
      findingIds,
    });
    return {
      page_id: result.page.id,
      page_path: result.page.path,
      hostname: result.page.hostname,
      preview_hash: hashContent(result.before),
      before_html: result.before,
      after_html: result.after,
      diff: result.diff,
      attempted_rule_ids: result.attempted,
      applied_rule_ids: result.applied,
      noise_only_change: canonicalizeHtml(result.before) === canonicalizeHtml(result.after),
    };
  },

  '/v1/cxone/page/apply-fix': async (body) => {
    const page = requirePageInput(body);
    const findingIds = optionalStringArray(body.finding_ids ?? body.findingIds, 'finding_ids');
    const previewHash = requireStr(body.preview_hash ?? body.previewHash, 'preview_hash');
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
      applied: result.written,
      revision_summary: result.revisionSummary,
      snapshot_path: undefined,
      attempted_rule_ids: result.attempted,
      applied_rule_ids: result.applied,
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
      if (!resolved.startsWith(FIXTURE_ROOT)) {
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
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.method !== 'POST' && req.method !== 'GET') {
    json(res, 405, { error: 'method not allowed' });
    return;
  }

  const handler = routes[req.url ?? ''];
  if (!handler) { json(res, 404, { error: 'not found' }); return; }

  try {
    const body = req.method === 'POST' ? await readJson(req) : {};
    const result = await handler(body);
    json(res, 200, result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof HttpError) {
      json(res, err.status, err.body);
      return;
    }
    json(res, 500, { error: msg });
  }
});

server.listen(PORT, () => {
  console.log(`[conductor-api] listening on http://localhost:${PORT}`);
});

// --- helpers ---
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  return JSON.parse(text);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function setCors(res: ServerResponse) {
  res.setHeader('access-control-allow-origin',  '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
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

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(typeof body.message === 'string' ? body.message : `HTTP ${status}`);
  }
}
