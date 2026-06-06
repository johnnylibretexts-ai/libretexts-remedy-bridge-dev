/**
 * End-to-end demo: render an image-bearing ADAPT question (via the
 * adapt-a11y-scanner renderer) and run remedy-core's vision fix pipeline on it.
 * Rewrites the chart asset URL to a local mirror (works around Node's inability
 * to resolve *.localhost), then runs runLocalPipeline so the chart-longdesc
 * vision handler generates an accessible description.
 *
 *   node tools/demo-chart-fix.mjs <questionId>
 *
 * Prereqs:
 *   - The adapt-a11y-scanner repo, built (`npm run build`). Located at
 *     ../adapt-a11y-scanner by default; override with ADAPT_SCANNER_DIR.
 *   - SCAN-time creds in the scanner's .env; OpenRouter key in this repo's .env.
 *   - A local static mirror of the chart asset, e.g.:
 *       python3 -m http.server 8899 --bind 127.0.0.1   # serving the dir with the PNG
 *     Override the mirror with REMEDY_MIRROR_URL, output dir with REMEDY_DEMO_OUT.
 *   - Run from within this workspace so @libretexts/remedy-core resolves.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.resolve(HERE, '..');
const SCANNER = process.env.ADAPT_SCANNER_DIR || path.resolve(BRIDGE, '..', 'adapt-a11y-scanner');
const MIRROR = process.env.REMEDY_MIRROR_URL ?? 'http://127.0.0.1:8899';
const OUT = process.env.REMEDY_DEMO_OUT ?? path.join(os.tmpdir(), 'remedy-demo');
fs.mkdirSync(OUT, { recursive: true });

// Pull in the scanner's .env (ADAPT creds) and this repo's .env (OpenRouter).
function loadEnv(file) {
  // `file` is not attacker-controlled: callers pass fixed paths derived from the
  // repo layout and the operator-set ADAPT_SCANNER_DIR env var. This is a local,
  // staff-run CLI driver — no remote input reaches this read. (Aikido flags the
  // readFileSync as AIK_ts_generic_path_traversal; safe in this context.)
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
}
loadEnv(path.join(SCANNER, '.env'));
loadEnv(path.join(BRIDGE, '.env'));
process.env.DEBUG = '1';

const cfgPath = path.join(SCANNER, 'dist', 'config.js');
if (!fs.existsSync(cfgPath)) {
  console.error(
    `[demo] scanner build not found at ${cfgPath}.\n` +
      `       Set ADAPT_SCANNER_DIR or run \`npm run build\` in the adapt-a11y-scanner repo.`,
  );
  process.exit(2);
}

const qid = process.argv[2] ?? '2';
const { loadConfig } = await import(pathToFileURL(cfgPath).href);
const { AdaptRenderer } = await import(pathToFileURL(path.join(SCANNER, 'dist', 'renderer.js')).href);
let core;
try {
  core = await import('@libretexts/remedy-core');
} catch {
  console.error('[demo] @libretexts/remedy-core not resolvable — run from within this workspace.');
  process.exit(2);
}

const cfg = loadConfig();
const renderer = new AdaptRenderer(cfg);
await renderer.init();
let html, url;
try {
  ({ url, html } = await renderer.renderQuestion(qid));
} finally {
  await renderer.close();
}

// Rewrite the ADAPT-hosted chart asset to the Node-fetchable local mirror.
// Keeps "chart" in the filename so the classifier signal is preserved.
const before = html;
html = html
  .replaceAll('http://adapt.libretexts.localhost/assets/img/', `${MIRROR}/`)
  .replaceAll('/assets/img/', `${MIRROR}/`);
console.error(`[demo] rendered ${url} (${before.length} bytes); rewrote chart asset → ${MIRROR}`);

const mirrorHost = new URL(MIRROR).host;
const res = await core.runLocalPipeline(html, { cacheDir: '', maxLlmCalls: 20, hostname: mirrorHost });

const imgReport = (res.strategyReports || []).find((r) => r.strategyId === 'images');
console.log('\n===== END-TO-END VISION FIX — question', qid, '=====');
console.log('renderedUrl:', url);
console.log('images strategy:', JSON.stringify(imgReport));

const after = res.afterHtml;
const altMatch = after.match(/<img[^>]*\balt="([^"]*)"[^>]*>/i);
const detailsMatch = after.match(/<details>[\s\S]*?<p>([\s\S]*?)<\/p>[\s\S]*?<\/details>/i);
const tableRows = [...after.matchAll(/<t[dh][^>]*>([^<]*)<\/t[dh]>/gi)].map((m) => m[1].trim());
console.log('\n-- BEFORE alt:', JSON.stringify((before.match(/<img[^>]*\balt="([^"]*)"/i) || [])[1]));
console.log('-- AFTER  alt:', JSON.stringify(altMatch ? altMatch[1] : '(none)'));
console.log('-- long description:', detailsMatch ? JSON.stringify(detailsMatch[1].trim()) : '(none)');
if (tableRows.length) console.log('-- data table cells:', JSON.stringify(tableRows.slice(0, 16)));

fs.writeFileSync(path.join(OUT, 'q.before.html'), before);
fs.writeFileSync(path.join(OUT, 'q.after.html'), after);
fs.writeFileSync(path.join(OUT, 'q.result.json'), JSON.stringify({
  renderedUrl: url,
  beforeAlt: (before.match(/<img[^>]*\balt="([^"]*)"/i) || [])[1],
  afterAlt: altMatch ? altMatch[1] : null,
  longDescription: detailsMatch ? detailsMatch[1].trim() : null,
  dataTableCells: tableRows,
  imagesReport: imgReport,
}, null, 2));
console.log(`\nwrote ${OUT}/q.{before,after}.html + q.result.json`);
