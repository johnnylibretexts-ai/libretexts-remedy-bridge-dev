/**
 * Minimal Node API server for the Conductor panel.
 *
 * Exposes /api/scan, /api/preview, /api/apply — thin wrappers around
 * @libretexts/remedy-core. Only runs locally for staff use; do not
 * expose to the public internet without auth.
 */
import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { scanPage, runPipeline, canonicalizeHtml } from '@libretexts/remedy-core';

const PORT = Number(process.env.CONDUCTOR_API_PORT ?? 5175);

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
};

const server = createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.method !== 'POST') { json(res, 405, { error: 'method not allowed' }); return; }

  const handler = routes[req.url ?? ''];
  if (!handler) { json(res, 404, { error: 'not found' }); return; }

  try {
    const body = await readJson(req);
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
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
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
