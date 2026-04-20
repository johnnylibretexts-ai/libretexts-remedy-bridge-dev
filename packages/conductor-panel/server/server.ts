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
  runPipeline,
  canonicalizeHtml,
  runLocalPipeline,
} from '@libretexts/remedy-core';

const PORT = Number(process.env.CONDUCTOR_API_PORT ?? 5175);

// Repo root = three dirs up from packages/conductor-panel/server/server.ts.
// Resolve from this file's URL so the server works regardless of cwd.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const FIXTURE_ROOT = resolve(REPO_ROOT, 'fixtures/local-lab');

type Handler = (body: Record<string, unknown>) => Promise<unknown>;

const routes: Record<string, Handler> = {
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

function requireTier(v: unknown): 1 | 2 | 3 {
  const n = Number(v);
  if (n !== 1 && n !== 2 && n !== 3) throw new Error(`tier must be 1|2|3`);
  return n;
}
