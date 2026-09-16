#!/usr/bin/env node
/**
 * Build the REM-02 tag-restore manifest for the Biology sandbox pages.
 *
 * READ-ONLY. Anonymous GETs only, against the rendered public source book
 * (bio.libretexts.org) and the rendered sandbox pages (dev.libretexts.org).
 * Nothing here needs or uses CXone credentials.
 *
 *   node tools/build-biology-tag-manifest.mjs \
 *     --pages <current-book-scans.json | [{id,path}]> \
 *     --out fixtures/biology-tag-restore.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseRenderedTags, selectRestorableTags, sourcePathFor } from '@libretexts/remedy-core';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
if (!args.pages || !args.out) {
  console.error('usage: --pages <json> --out <manifest.json>');
  process.exit(2);
}

const SOURCE_HOST = 'https://bio.libretexts.org/';
const SANDBOX_HOST = 'https://dev.libretexts.org/';

/** Accept either the evidence scan file or a plain [{id,path}] list. */
function pageList(raw) {
  return raw.map((e) => {
    if (e.scan) return { id: e.scan.page_id, path: e.scan.page_path };
    return { id: e.id, path: e.path };
  });
}

function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

async function fetchHtml(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'remedy-tag-manifest/1' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

/**
 * CXone stamps every content element with `lt-<library>-<pageId>`. On the
 * source page that is its own id; the clone copied the classes verbatim, so
 * the sandbox page carries the *source* id — a free cross-check.
 */
function ltBioMarker(html) {
  const ids = new Set([...html.matchAll(/\blt-bio-(\d+)\b/g)].map((m) => Number(m[1])));
  if (ids.size !== 1) return null; // none, or ambiguous — treat as unavailable
  return [...ids][0];
}

const pages = pageList(JSON.parse(await readFile(args.pages, 'utf8')));
const out = { generatedAt: new Date().toISOString(), sourceBook: SOURCE_HOST, pages: [] };

for (const p of pages) {
  const sourcePath = sourcePathFor(p.path);
  const row = {
    sandboxPageId: p.id,
    sandboxPath: p.path,
    sourcePath,
    sourcePageId: null,
    crosscheck: 'unavailable',
    tags: { restore: [], omitted: [] },
    note: undefined,
  };
  try {
    const sourceHtml = await fetchHtml(SOURCE_HOST + encodePath(sourcePath));
    row.sourcePageId = ltBioMarker(sourceHtml);
    const tags = parseRenderedTags(sourceHtml);
    if (!tags) throw new Error('no #pageTagsHolder on source page');
    row.tags = selectRestorableTags(tags);

    const sandboxHtml = await fetchHtml(SANDBOX_HOST + encodePath(p.path));
    const marker = ltBioMarker(sandboxHtml);
    if (marker !== null && row.sourcePageId !== null) {
      row.crosscheck = marker === row.sourcePageId ? 'match' : 'mismatch';
    }
  } catch (err) {
    row.note = err instanceof Error ? err.message : String(err);
  }
  out.pages.push(row);
  console.error(
    `${p.id}  ${row.crosscheck.padEnd(11)}  restore=${row.tags.restore.length}  omitted=${row.tags.omitted.length}` +
      (row.note ? `  NOTE: ${row.note}` : ''),
  );
}

await mkdir(dirname(args.out), { recursive: true });
await writeFile(args.out, JSON.stringify(out, null, 2) + '\n', 'utf8');
const c = (k) => out.pages.filter((r) => r.crosscheck === k).length;
console.error(`\nwrote ${args.out}: ${out.pages.length} pages — match ${c('match')}, mismatch ${c('mismatch')}, unavailable ${c('unavailable')}`);
