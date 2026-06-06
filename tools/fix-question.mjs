/**
 * Driver: render an ADAPT question (via the adapt-a11y-scanner renderer) and run
 * remedy-core's LOCAL fix pipeline (scan -> LLM-backed strategies -> re-scan) on
 * it. The scanner CLI is detect-only; this adds the AI-fix step using the
 * OpenRouter models config from this repo's .env. No CXone writes.
 *
 *   node tools/fix-question.mjs <questionId> [assignmentId]
 *
 * Prereqs:
 *   - The adapt-a11y-scanner repo, built (`npm run build`). Located at
 *     ../adapt-a11y-scanner by default; override with ADAPT_SCANNER_DIR.
 *   - ADAPT creds in the scanner's .env (ADAPT_BASE_URL + ADAPT_TOKEN).
 *   - OpenRouter key + REMEDY_TEXT_MODELS / REMEDY_VISION_MODELS in this repo's .env.
 *   - Run from within this workspace so @libretexts/remedy-core resolves.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.resolve(HERE, '..');
const SCANNER = process.env.ADAPT_SCANNER_DIR || path.resolve(BRIDGE, '..', 'adapt-a11y-scanner');
const OUT = process.env.REMEDY_DEMO_OUT ?? os.tmpdir();

// Load both .env files into process.env (dotenv-style: strip inline #comments,
// don't clobber already-set vars). Scanner first (ADAPT creds), then this repo
// (OpenRouter key + REMEDY_TEXT_MODELS / REMEDY_VISION_MODELS fallback pools).
function loadEnv(file) {
  // `file` is not attacker-controlled: callers pass fixed paths derived from the
  // repo layout and the operator-set ADAPT_SCANNER_DIR env var. This is a local,
  // staff-run CLI driver — no remote input reaches this read. (Aikido flags the
  // readFileSync as AIK_ts_generic_path_traversal; safe in this context.)
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const v = m[2].replace(/\s+#.*$/, '').trim();
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnv(path.join(SCANNER, '.env'));
loadEnv(path.join(BRIDGE, '.env'));
process.env.DEBUG = '1'; // surface the OpenRouter fallback chain + retries

const cfgPath = path.join(SCANNER, 'dist', 'config.js');
if (!fs.existsSync(cfgPath)) {
  console.error(
    `[driver] scanner build not found at ${cfgPath}.\n` +
      `         Set ADAPT_SCANNER_DIR or run \`npm run build\` in the adapt-a11y-scanner repo.`,
  );
  process.exit(2);
}

const [qid = '1', aid] = process.argv.slice(2);

const { loadConfig } = await import(pathToFileURL(cfgPath).href);
const { AdaptRenderer } = await import(pathToFileURL(path.join(SCANNER, 'dist', 'renderer.js')).href);
let core;
try {
  core = await import('@libretexts/remedy-core');
} catch {
  console.error('[driver] @libretexts/remedy-core not resolvable — run from within this workspace.');
  process.exit(2);
}

const cfg = loadConfig();
const renderer = new AdaptRenderer(cfg);
await renderer.init();
let html, url;
try {
  ({ url, html } = await renderer.renderQuestion(qid, aid));
} finally {
  await renderer.close();
}
console.error(`[driver] rendered ${url} (${html.length} bytes)`);

const res = await core.runLocalPipeline(html, {
  cacheDir: '', // force LIVE LLM calls (no cache) so we exercise the models
  maxLlmCalls: 20,
  hostname: new URL(cfg.adaptBaseUrl).host, // images resolve off the ADAPT host
});

const tally = (fs_) => {
  const by = {};
  for (const f of fs_) by[f.ruleId] = (by[f.ruleId] || 0) + 1;
  return by;
};
const sev = (fs_, s) => fs_.filter((f) => f.severity === s).length;

console.log('\n===== AI FIX RESULT — question', qid, '=====');
console.log('renderedUrl:', url);
console.log(`BEFORE: ${sev(res.findingsBefore, 'error')} errors / ${sev(res.findingsBefore, 'warning')} warnings`);
console.log(`AFTER:  ${sev(res.findingsAfter, 'error')} errors / ${sev(res.findingsAfter, 'warning')} warnings`);
console.log('elapsedMs:', res.elapsedMs, '| bytePreserved:', res.bytePreserved, '| splices:', res.splicesApplied ?? '-');

console.log('\n-- per-rule before → after --');
const before = tally(res.findingsBefore), after = tally(res.findingsAfter);
for (const k of new Set([...Object.keys(before), ...Object.keys(after)]).values()) {
  const b = before[k] || 0, a = after[k] || 0;
  console.log(`  ${k.padEnd(28)} ${b} → ${a}${a < b ? '  ✓ fixed ' + (b - a) : ''}`);
}

console.log('\n-- strategy reports (which fixers ran) --');
for (const r of res.strategyReports || []) {
  console.log(' ', JSON.stringify(r));
}

fs.writeFileSync(path.join(OUT, `q${qid}.after.html`), res.afterHtml);
fs.writeFileSync(path.join(OUT, `q${qid}.diff`), res.diff);
console.log(`\nwrote ${path.join(OUT, `q${qid}.after.html`)} and q${qid}.diff`);
